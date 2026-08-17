import { Pool, PoolClient } from "pg";
import { loadEnvConfig } from "@next/env";
import { TASK_CATALOGUE } from "../lib/catalogue";
import { TaskStatus, validateTransition } from "../lib/state-machine";
import { generateToken, hashToken, verifyTokenHash } from "../lib/auth";
import { ServiceError } from "../lib/errors";

// Ensure environment variables (.env.local, .env, etc.) are loaded
loadEnvConfig(process.cwd());

// 1. Production Database Safety Enforcement
function checkProductionDbSafety() {
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
    throw new Error(
      "FATAL: DATABASE_URL environment variable is required in production. In-memory storage fallback is disabled."
    );
  }
}

// Types
export interface TaskTypeRow {
  id: string;
  code: string;
  title: string;
  description: string;
  active: boolean;
  customer_price_usd: number;
  target_payout_usd: number;
  default_sla_minutes: number;
  required_capability: string;
  result_schema: Record<string, unknown>;
  risk_level: string;
  created_at: string;
}

export interface WorkerRow {
  id: string;
  display_name: string;
  email: string | null;
  status: string;
  created_at: string;
}

export interface WorkerCapabilityRow {
  id: string;
  worker_id: string;
  capability_code: string;
  score: number;
  status: string;
  verified_at: string;
}

export interface QuoteRow {
  id: string;
  task_type_id: string;
  input_payload: Record<string, unknown>;
  quoted_price_usd: number;
  target_payout_usd: number;
  estimated_minutes: number;
  expires_at: string;
  created_at: string;
}

export interface TaskRow {
  id: string;
  quote_id: string;
  task_type_id: string;
  status: TaskStatus;
  input_payload: Record<string, unknown>;
  assigned_worker_id: string | null;
  agent_token_hash: string;
  created_at: string;
  updated_at: string;
}

export interface TaskOfferRow {
  id: string;
  task_id: string;
  worker_id: string;
  worker_token_hash: string;
  status: string;
  offered_at: string;
  responded_at: string | null;
}

export interface TaskResultRow {
  id: string;
  task_id: string;
  worker_id: string;
  result_payload: Record<string, unknown>;
  submitted_at: string;
  accepted_at: string | null;
}

export interface EventRow {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

// In-Memory Store for isolated unit testing only
class InMemoryStore {
  taskTypes = new Map<string, TaskTypeRow>();
  workers = new Map<string, WorkerRow>();
  workerCapabilities = new Map<string, WorkerCapabilityRow>();
  quotes = new Map<string, QuoteRow>();
  tasks = new Map<string, TaskRow>();
  taskOffers = new Map<string, TaskOfferRow>();
  taskResults = new Map<string, TaskResultRow>();
  events: EventRow[] = [];

  constructor() {
    this.seed();
  }

  seed() {
    for (const item of Object.values(TASK_CATALOGUE)) {
      this.taskTypes.set(item.code, {
        id: item.code,
        code: item.code,
        title: item.title,
        description: item.description,
        active: true,
        customer_price_usd: item.customer_price_usd,
        target_payout_usd: item.target_payout_usd,
        default_sla_minutes: item.default_sla_minutes,
        required_capability: item.required_capability,
        result_schema: item.result_schema,
        risk_level: item.risk_level,
        created_at: new Date().toISOString(),
      });
    }

    const mockWorkers: WorkerRow[] = [
      { id: "w_alex_ux", display_name: "Alex Rivera (Senior UX Specialist)", email: "alex@example.com", status: "ACTIVE", created_at: new Date().toISOString() },
      { id: "w_sam_arch", display_name: "Sam Chen (Principal Cloud Architect)", email: "sam@example.com", status: "ACTIVE", created_at: new Date().toISOString() },
      { id: "w_elena_fact", display_name: "Dr. Elena Rostova (Research Analyst)", email: "elena@example.com", status: "ACTIVE", created_at: new Date().toISOString() },
      { id: "w_morgan_general", display_name: "Morgan Taylor (Full-Stack Engineer)", email: "morgan@example.com", status: "ACTIVE", created_at: new Date().toISOString() },
    ];

    for (const w of mockWorkers) {
      this.workers.set(w.id, w);
    }

    const mockCaps: WorkerCapabilityRow[] = [
      { id: "wc_1", worker_id: "w_alex_ux", capability_code: "UX_CONVERSION_ANALYSIS", score: 0.98, status: "VERIFIED", verified_at: new Date().toISOString() },
      { id: "wc_2", worker_id: "w_sam_arch", capability_code: "SYSTEM_ARCHITECTURE", score: 0.99, status: "VERIFIED", verified_at: new Date().toISOString() },
      { id: "wc_3", worker_id: "w_elena_fact", capability_code: "FACT_CHECKING", score: 0.99, status: "VERIFIED", verified_at: new Date().toISOString() },
      { id: "wc_4", worker_id: "w_morgan_general", capability_code: "UX_CONVERSION_ANALYSIS", score: 0.90, status: "VERIFIED", verified_at: new Date().toISOString() },
      { id: "wc_5", worker_id: "w_morgan_general", capability_code: "SYSTEM_ARCHITECTURE", score: 0.88, status: "VERIFIED", verified_at: new Date().toISOString() },
      { id: "wc_6", worker_id: "w_morgan_general", capability_code: "FACT_CHECKING", score: 0.92, status: "VERIFIED", verified_at: new Date().toISOString() },
    ];

    for (const c of mockCaps) {
      this.workerCapabilities.set(c.id, c);
    }
  }

  reset() {
    this.taskTypes.clear();
    this.workers.clear();
    this.workerCapabilities.clear();
    this.quotes.clear();
    this.tasks.clear();
    this.taskOffers.clear();
    this.taskResults.clear();
    this.events = [];
    this.seed();
  }
}

// Global in-memory singleton
const memStore = new InMemoryStore();

// Build an event row and attach a timestamp (used inside transactional paths)
function makeEventRow(
  event: { eventType: string; entityType: string; entityId: string; payload?: Record<string, unknown> },
  now: string
): EventRow {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    event_type: event.eventType,
    entity_type: event.entityType,
    entity_id: event.entityId,
    payload: { ...(event.payload || {}), timestamp: now },
    created_at: now,
  };
}

// Neon / PostgreSQL Pool (Serverless-Safe Configuration with Validated SSL)
let pgPool: Pool | null = null;

function getPgPool(): Pool | null {
  checkProductionDbSafety();
  if (process.env.DATABASE_URL && !pgPool) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") ? false : true,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pgPool;
}

export const db = {
  get isPostgres(): boolean {
    return Boolean(process.env.DATABASE_URL);
  },

  resetMemStore() {
    memStore.reset();
  },

  // Raw query interface
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(sql, params);
      return res.rows as T[];
    }
    return [];
  },

  // Task Types
  async getAllTaskTypes(): Promise<TaskTypeRow[]> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(`SELECT * FROM task_types WHERE active = true ORDER BY code ASC`);
      return res.rows.map((r) => ({
        ...r,
        customer_price_usd: Number(r.customer_price_usd),
        target_payout_usd: Number(r.target_payout_usd),
        default_sla_minutes: Number(r.default_sla_minutes),
      }));
    }
    return Array.from(memStore.taskTypes.values()).filter((t) => t.active);
  },

  async getTaskType(code: string): Promise<TaskTypeRow | null> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(`SELECT * FROM task_types WHERE code = $1 AND active = true LIMIT 1`, [code]);
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        ...r,
        customer_price_usd: Number(r.customer_price_usd),
        target_payout_usd: Number(r.target_payout_usd),
        default_sla_minutes: Number(r.default_sla_minutes),
      };
    }
    return memStore.taskTypes.get(code) || null;
  },

  // Workers & Capabilities
  async getWorkers(): Promise<WorkerRow[]> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(`SELECT * FROM workers ORDER BY id ASC`);
      return res.rows;
    }
    return Array.from(memStore.workers.values());
  },

  async getWorker(id: string): Promise<WorkerRow | null> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(`SELECT * FROM workers WHERE id = $1 LIMIT 1`, [id]);
      return res.rows[0] || null;
    }
    return memStore.workers.get(id) || null;
  },

  async verifyWorkerCapability(workerId: string, capabilityCode: string): Promise<boolean> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(
        `SELECT 1 FROM worker_capabilities 
         WHERE worker_id = $1 AND capability_code = $2 AND status = 'VERIFIED' AND score > 0
         LIMIT 1`,
        [workerId, capabilityCode]
      );
      return res.rows.length > 0;
    }
    const cap = Array.from(memStore.workerCapabilities.values()).find(
      (c) => c.worker_id === workerId && c.capability_code === capabilityCode && c.status === "VERIFIED" && c.score > 0
    );
    return Boolean(cap);
  },

  async getWorkersByCapability(capabilityCode: string): Promise<WorkerRow[]> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(
        `SELECT w.* FROM workers w
         JOIN worker_capabilities wc ON wc.worker_id = w.id
         WHERE wc.capability_code = $1 AND w.status = 'ACTIVE' AND wc.status = 'VERIFIED'
         ORDER BY wc.score DESC`,
        [capabilityCode]
      );
      return res.rows;
    }
    const matchingWorkerIds = Array.from(memStore.workerCapabilities.values())
      .filter((c) => c.capability_code === capabilityCode && c.status === "VERIFIED")
      .map((c) => c.worker_id);

    return matchingWorkerIds
      .map((id) => memStore.workers.get(id))
      .filter((w): w is WorkerRow => Boolean(w && w.status === "ACTIVE"));
  },

  // Quotes
  async createQuote(params: {
    id: string;
    task_type_id: string;
    input_payload: Record<string, unknown>;
    quoted_price_usd: number;
    target_payout_usd: number;
    estimated_minutes: number;
    expires_at: string;
  }): Promise<QuoteRow> {
    checkProductionDbSafety();
    const pool = getPgPool();
    const createdAt = new Date().toISOString();
    const row: QuoteRow = {
      id: params.id,
      task_type_id: params.task_type_id,
      input_payload: params.input_payload,
      quoted_price_usd: params.quoted_price_usd,
      target_payout_usd: params.target_payout_usd,
      estimated_minutes: params.estimated_minutes,
      expires_at: params.expires_at,
      created_at: createdAt,
    };

    if (pool) {
      await pool.query(
        `INSERT INTO quotes (id, task_type_id, input_payload, quoted_price_usd, target_payout_usd, estimated_minutes, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          row.id,
          row.task_type_id,
          JSON.stringify(row.input_payload),
          row.quoted_price_usd,
          row.target_payout_usd,
          row.estimated_minutes,
          row.expires_at,
          row.created_at,
        ]
      );
    } else {
      memStore.quotes.set(row.id, row);
    }
    return row;
  },

  async getQuote(id: string): Promise<QuoteRow | null> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(`SELECT * FROM quotes WHERE id = $1 LIMIT 1`, [id]);
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        ...r,
        quoted_price_usd: Number(r.quoted_price_usd),
        target_payout_usd: Number(r.target_payout_usd),
        estimated_minutes: Number(r.estimated_minutes),
      };
    }
    return memStore.quotes.get(id) || null;
  },

  // Tasks (Idempotent Creation with One Transaction)
  async getTaskByQuoteId(quoteId: string): Promise<TaskRow | null> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(`SELECT * FROM tasks WHERE quote_id = $1 LIMIT 1`, [quoteId]);
      if (res.rows.length === 0) return null;
      return res.rows[0];
    }
    return Array.from(memStore.tasks.values()).find((t) => t.quote_id === quoteId) || null;
  },

  async createTask(params: {
    id: string;
    quote_id: string;
    task_type_id: string;
    input_payload: Record<string, unknown>;
  }): Promise<{ task: TaskRow; agent_token: string; offers: Array<{ worker_id: string; worker_token: string; offer_id: string }>; is_existing: boolean }> {
    checkProductionDbSafety();
    const pool = getPgPool();
    const now = new Date().toISOString();

    // Check for existing task for idempotent return (a replay must not strand the agent:
    // atomically rotate the agent token so the caller can authenticate to the existing task)
    const existing = await this.getTaskByQuoteId(params.quote_id);
    if (existing) {
      const rotatedAgentToken = await this.rotateAgentToken(existing.id);
      return {
        task: existing,
        agent_token: rotatedAgentToken || "",
        offers: [],
        is_existing: true,
      };
    }

    const agentToken = generateToken("atk");
    const agentTokenHash = hashToken(agentToken);

    const taskRow: TaskRow = {
      id: params.id,
      quote_id: params.quote_id,
      task_type_id: params.task_type_id,
      status: "OFFERED",
      input_payload: params.input_payload,
      assigned_worker_id: null,
      agent_token_hash: agentTokenHash,
      created_at: now,
      updated_at: now,
    };

    const taskType = await this.getTaskType(params.task_type_id);
    const capability = taskType?.required_capability || "";
    const qualifiedWorkers = await this.getWorkersByCapability(capability);

    const offers: Array<{ worker_id: string; worker_token: string; offer_id: string }> = [];

    if (pool) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const taskInsert = await client.query(
          `INSERT INTO tasks (id, quote_id, task_type_id, status, input_payload, assigned_worker_id, agent_token_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (quote_id) DO NOTHING
           RETURNING *`,
          [
            taskRow.id,
            taskRow.quote_id,
            taskRow.task_type_id,
            taskRow.status,
            JSON.stringify(taskRow.input_payload),
            null,
            taskRow.agent_token_hash,
            taskRow.created_at,
            taskRow.updated_at,
          ]
        );

        if (taskInsert.rows.length === 0) {
          // Idempotent replay: rotate the agent token inside the SAME transaction so
          // the replaying agent receives a usable credential for the existing task.
          const rotatedAgentToken = generateToken("atk");
          const rotatedRes = await client.query(
            `UPDATE tasks SET agent_token_hash = $1, updated_at = $2 WHERE quote_id = $3 RETURNING *`,
            [hashToken(rotatedAgentToken), now, params.quote_id]
          );
          if (rotatedRes.rows.length === 0) {
            await client.query("ROLLBACK");
            const conflictTask = await this.getTaskByQuoteId(params.quote_id);
            return {
              task: conflictTask!,
              agent_token: "",
              offers: [],
              is_existing: true,
            };
          }
          await client.query("COMMIT");
          return {
            task: rotatedRes.rows[0],
            agent_token: rotatedAgentToken,
            offers: [],
            is_existing: true,
          };
        }

        for (const worker of qualifiedWorkers) {
          const workerToken = generateToken("otk");
          const workerTokenHash = hashToken(workerToken);
          const offerId = `off_${taskRow.id}_${worker.id}`;

          await client.query(
            `INSERT INTO task_offers (id, task_id, worker_id, worker_token_hash, status, offered_at)
             VALUES ($1, $2, $3, $4, 'OFFERED', $5)
             ON CONFLICT (task_id, worker_id) DO NOTHING`,
            [offerId, taskRow.id, worker.id, workerTokenHash, now]
          );

          offers.push({ worker_id: worker.id, worker_token: workerToken, offer_id: offerId });
        }

        await client.query("COMMIT");
        return { task: taskInsert.rows[0], agent_token: agentToken, offers, is_existing: false };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } else {
      if (memStore.tasks.has(taskRow.id) || Array.from(memStore.tasks.values()).some((t) => t.quote_id === taskRow.quote_id)) {
        const conflictTask = Array.from(memStore.tasks.values()).find((t) => t.quote_id === taskRow.quote_id);
        const rotatedAgentToken = conflictTask ? await this.rotateAgentToken(conflictTask.id) : null;
        return { task: conflictTask!, agent_token: rotatedAgentToken || "", offers: [], is_existing: true };
      }

      memStore.tasks.set(taskRow.id, taskRow);

      for (const worker of qualifiedWorkers) {
        const workerToken = generateToken("otk");
        const workerTokenHash = hashToken(workerToken);
        const offerId = `off_${taskRow.id}_${worker.id}`;

        const offerRow: TaskOfferRow = {
          id: offerId,
          task_id: taskRow.id,
          worker_id: worker.id,
          worker_token_hash: workerTokenHash,
          status: "OFFERED",
          offered_at: now,
          responded_at: null,
        };
        memStore.taskOffers.set(`${taskRow.id}_${worker.id}`, offerRow);
        offers.push({ worker_id: worker.id, worker_token: workerToken, offer_id: offerId });
      }

      return { task: taskRow, agent_token: agentToken, offers, is_existing: false };
    }
  },

  async getTask(id: string): Promise<TaskRow | null> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(`SELECT * FROM tasks WHERE id = $1 LIMIT 1`, [id]);
      if (res.rows.length === 0) return null;
      return res.rows[0];
    }
    return memStore.tasks.get(id) || null;
  },

  // Token Verification
  async verifyAgentToken(taskId: string, agentToken: string): Promise<boolean> {
    checkProductionDbSafety();
    if (!agentToken) return false;
    const task = await this.getTask(taskId);
    if (!task || !task.agent_token_hash) return false;
    return verifyTokenHash(agentToken, task.agent_token_hash);
  },

  // Rotate the agent task token: generates a new opaque token, stores only its
  // hash, and returns the raw token to the caller. Previous tokens are revoked.
  async rotateAgentToken(taskId: string): Promise<string | null> {
    checkProductionDbSafety();
    const token = generateToken("atk");
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(
        `UPDATE tasks SET agent_token_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
        [hashToken(token), taskId]
      );
      return res.rows.length > 0 ? token : null;
    }
    const task = memStore.tasks.get(taskId);
    if (!task) return null;
    task.agent_token_hash = hashToken(token);
    task.updated_at = new Date().toISOString();
    return token;
  },

  // Ops/test seam: set the stored agent token hash directly (used to repair or
  // revoke access; a NULL/empty value makes the task fail closed with 401).
  async setAgentTokenHash(taskId: string, tokenHash: string | null): Promise<boolean> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(
        `UPDATE tasks SET agent_token_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
        [tokenHash, taskId]
      );
      return res.rows.length > 0;
    }
    const task = memStore.tasks.get(taskId);
    if (!task) return false;
    task.agent_token_hash = tokenHash || "";
    task.updated_at = new Date().toISOString();
    return true;
  },

  async verifyWorkerToken(taskId: string, workerId: string, workerToken: string): Promise<boolean> {
    checkProductionDbSafety();
    if (!workerToken) return false;
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(
        `SELECT worker_token_hash FROM task_offers WHERE task_id = $1 AND worker_id = $2 LIMIT 1`,
        [taskId, workerId]
      );
      if (res.rows.length === 0) return false;
      return verifyTokenHash(workerToken, res.rows[0].worker_token_hash);
    }
    const offer = memStore.taskOffers.get(`${taskId}_${workerId}`) ||
                  Array.from(memStore.taskOffers.values()).find((o) => o.task_id === taskId && o.worker_id === workerId);
    if (!offer) return false;
    return verifyTokenHash(workerToken, offer.worker_token_hash);
  },

  // Resolve a worker's identity from an opaque per-offer worker token alone.
  async getWorkerIdByOfferToken(taskId: string, workerToken: string): Promise<string | null> {
    checkProductionDbSafety();
    if (!workerToken) return null;
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(
        `SELECT worker_id, worker_token_hash FROM task_offers WHERE task_id = $1`,
        [taskId]
      );
      for (const row of res.rows) {
        if (verifyTokenHash(workerToken, row.worker_token_hash)) return row.worker_id;
      }
      return null;
    }
    const offers = Array.from(memStore.taskOffers.values()).filter((o) => o.task_id === taskId);
    for (const offer of offers) {
      if (verifyTokenHash(workerToken, offer.worker_token_hash)) return offer.worker_id;
    }
    return null;
  },

  // Rotate a worker offer token: generates a fresh opaque credential, stores
  // only its hash, and returns the raw token. Only reachable through the
  // internal worker-delivery channel. Previously delivered tokens are revoked.
  async rotateWorkerOfferToken(taskId: string, workerId: string): Promise<string | null> {
    checkProductionDbSafety();
    const token = generateToken("otk");
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(
        `UPDATE task_offers SET worker_token_hash = $1 WHERE task_id = $2 AND worker_id = $3 RETURNING id`,
        [hashToken(token), taskId, workerId]
      );
      return res.rows.length > 0 ? token : null;
    }
    const offer = memStore.taskOffers.get(`${taskId}_${workerId}`) ||
                  Array.from(memStore.taskOffers.values()).find((o) => o.task_id === taskId && o.worker_id === workerId);
    if (!offer) return null;
    offer.worker_token_hash = hashToken(token);
    return token;
  },

  async getOffersForTask(taskId: string): Promise<TaskOfferRow[]> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(`SELECT * FROM task_offers WHERE task_id = $1 ORDER BY offered_at ASC`, [taskId]);
      return res.rows;
    }
    return Array.from(memStore.taskOffers.values()).filter((o) => o.task_id === taskId);
  },

  // Task Acceptance (Atomic Single Transaction: verify token -> capability -> claim -> mark offer -> event)
  async acceptTask(
    taskId: string,
    workerId: string,
    workerToken?: string,
    event?: { eventType: string; entityType: string; entityId: string; payload?: Record<string, unknown> }
  ): Promise<{ success: boolean; task?: TaskRow; error?: string; code?: number }> {
    checkProductionDbSafety();
    const pool = getPgPool();
    const now = new Date().toISOString();

    // Task existence check first
    const task = await this.getTask(taskId);
    if (!task) {
      return { success: false, error: `Task '${taskId}' not found`, code: 404 };
    }

    // Capability gate: an incapable worker must receive WORKER_CAPABILITY_REQUIRED (403).
    // This is reachable even without a credential because offers only exist for
    // capability-qualified workers; the token below remains mandatory to claim.
    const taskType = await this.getTaskType(task.task_type_id);
    const hasCapability = await this.verifyWorkerCapability(workerId, taskType?.required_capability || "");
    if (!hasCapability) {
      return {
        success: false,
        error: `Worker '${workerId}' does not possess the required verified capability: '${taskType?.required_capability}'`,
        code: 403,
      };
    }

    // Identity MUST come from the opaque per-offer worker token (no worker_id fallback)
    if (!workerToken) {
      return { success: false, error: "Worker offer token is required", code: 401 };
    }

    const validToken = await this.verifyWorkerToken(taskId, workerId, workerToken);
    if (!validToken) {
      return { success: false, error: "Invalid worker offer token for this worker", code: 401 };
    }

    const eventRow = event ? makeEventRow(event, now) : null;

    if (pool) {
      const client: PoolClient = await pool.connect();
      try {
        await client.query("BEGIN");

        const res = await client.query(
          `UPDATE tasks
           SET status = 'ACCEPTED', assigned_worker_id = $1, updated_at = $2
           WHERE id = $3 AND status = 'OFFERED' AND assigned_worker_id IS NULL
           RETURNING *`,
          [workerId, now, taskId]
        );

        if (res.rows.length === 0) {
          await client.query("ROLLBACK");
          const existing = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [taskId]);
          if (existing.rows.length === 0) return { success: false, error: `Task ${taskId} not found`, code: 404 };
          const t = existing.rows[0];
          if (t.assigned_worker_id && t.assigned_worker_id !== workerId) {
            return { success: false, error: "Task already accepted by another worker", code: 409 };
          }
          return { success: false, error: `Task cannot be accepted from status '${t.status}'`, code: 400 };
        }

        await client.query(
          `UPDATE task_offers
           SET status = 'ACCEPTED', responded_at = $1
           WHERE task_id = $2 AND worker_id = $3`,
          [now, taskId, workerId]
        );

        if (eventRow) {
          await client.query(
            `INSERT INTO events (id, event_type, entity_type, entity_id, payload, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              eventRow.id,
              eventRow.event_type,
              eventRow.entity_type,
              eventRow.entity_id,
              JSON.stringify(eventRow.payload),
              eventRow.created_at,
            ]
          );
        }

        await client.query("COMMIT");
        return { success: true, task: res.rows[0] };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } else {
      const memTask = memStore.tasks.get(taskId);
      if (!memTask) return { success: false, error: `Task ${taskId} not found`, code: 404 };

      if (memTask.assigned_worker_id && memTask.assigned_worker_id !== workerId) {
        return { success: false, error: "Task already accepted by another worker", code: 409 };
      }

      if (memTask.status !== "OFFERED") {
        return { success: false, error: `Task cannot be accepted from status '${memTask.status}'`, code: 400 };
      }

      validateTransition(memTask.status, "ACCEPTED");

      memTask.status = "ACCEPTED";
      memTask.assigned_worker_id = workerId;
      memTask.updated_at = now;

      const offerKey = `${taskId}_${workerId}`;
      const offer = memStore.taskOffers.get(offerKey);
      if (offer) {
        offer.status = "ACCEPTED";
        offer.responded_at = now;
      }

      if (eventRow) {
        memStore.events.push(eventRow);
      }

      return { success: true, task: { ...memTask } };
    }
  },

  // Start Task
  async startTask(
    taskId: string,
    workerId: string,
    workerToken?: string
  ): Promise<{ success: boolean; task?: TaskRow; error?: string; code?: number }> {
    checkProductionDbSafety();
    const pool = getPgPool();
    const now = new Date().toISOString();

    if (!workerToken) {
      return { success: false, error: "Worker offer token is required", code: 401 };
    }
    const validToken = await this.verifyWorkerToken(taskId, workerId, workerToken);
    if (!validToken) {
      return { success: false, error: "Invalid worker token for this worker", code: 401 };
    }

    if (pool) {
      const res = await pool.query(
        `UPDATE tasks
         SET status = 'IN_PROGRESS', updated_at = $1
         WHERE id = $2 AND assigned_worker_id = $3 AND status = 'ACCEPTED'
         RETURNING *`,
        [now, taskId, workerId]
      );

      if (res.rows.length === 0) {
        const existing = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [taskId]);
        if (existing.rows.length === 0) return { success: false, error: "Task not found", code: 404 };
        const t = existing.rows[0];
        if (t.assigned_worker_id !== workerId) return { success: false, error: "Worker not assigned to this task", code: 403 };
        return { success: false, error: `Cannot start task from status '${t.status}'`, code: 400 };
      }

      return { success: true, task: res.rows[0] };
    } else {
      const task = memStore.tasks.get(taskId);
      if (!task) return { success: false, error: "Task not found", code: 404 };
      if (task.assigned_worker_id !== workerId) return { success: false, error: "Worker not assigned to this task", code: 403 };

      validateTransition(task.status, "IN_PROGRESS");

      task.status = "IN_PROGRESS";
      task.updated_at = now;

      return { success: true, task: { ...task } };
    }
  },

  // 2. Transactional Result Submission (Strict Atomic BEGIN / COMMIT / ROLLBACK)
  async submitTaskResult(params: {
    id: string;
    taskId: string;
    workerId: string;
    workerToken?: string;
    resultPayload: Record<string, unknown>;
  }): Promise<{ success: boolean; task?: TaskRow; result?: TaskResultRow; error?: string; code?: number }> {
    checkProductionDbSafety();
    const pool = getPgPool();
    const now = new Date().toISOString();

    if (!params.workerToken) {
      return { success: false, error: "Worker offer token is required", code: 401 };
    }
    const validToken = await this.verifyWorkerToken(params.taskId, params.workerId, params.workerToken);
    if (!validToken) {
      return { success: false, error: "Invalid worker token for this worker", code: 401 };
    }

    if (pool) {
      const client: PoolClient = await pool.connect();
      try {
        await client.query("BEGIN");

        // 1. Atomically verify worker assignment & transition task state from IN_PROGRESS to COMPLETED
        const taskUpdateRes = await client.query(
          `UPDATE tasks
           SET status = 'COMPLETED', updated_at = $1
           WHERE id = $2 AND assigned_worker_id = $3 AND status = 'IN_PROGRESS'
           RETURNING *`,
          [now, params.taskId, params.workerId]
        );

        if (taskUpdateRes.rows.length === 0) {
          await client.query("ROLLBACK");
          // Determine exact reason for conflict
          const existing = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [params.taskId]);
          if (existing.rows.length === 0) return { success: false, error: "Task not found", code: 404 };
          const t = existing.rows[0];

          if (t.assigned_worker_id !== params.workerId) {
            return { success: false, error: "Worker is not assigned to this task", code: 403 };
          }
          if (t.status === "COMPLETED") {
            return { success: false, error: "Task result already submitted", code: 409 };
          }
          return { success: false, error: `Cannot submit result for task in status '${t.status}'`, code: 400 };
        }

        // 2. Insert result payload with UNIQUE(task_id) constraint
        const resultRes = await client.query(
          `INSERT INTO task_results (id, task_id, worker_id, result_payload, submitted_at, accepted_at)
           VALUES ($1, $2, $3, $4, $5, $5)
           ON CONFLICT (task_id) DO NOTHING
           RETURNING *`,
          [params.id, params.taskId, params.workerId, JSON.stringify(params.resultPayload), now]
        );

        if (resultRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return { success: false, error: "Task result already submitted", code: 409 };
        }

        // 3. Atomically persist task lifecycle events within the SAME database transaction
        const evtSubmittedId = `evt_${Date.now()}_sub_${Math.random().toString(36).substring(2, 7)}`;
        const evtCompletedId = `evt_${Date.now()}_cmp_${Math.random().toString(36).substring(2, 7)}`;

        await client.query(
          `INSERT INTO events (id, event_type, entity_type, entity_id, payload, created_at)
           VALUES ($1, 'task_submitted', 'task', $2, $3, $4),
                  ($5, 'task_completed', 'task', $2, $6, $4)`,
          [
            evtSubmittedId,
            params.taskId,
            JSON.stringify({ worker_id: params.workerId, result_id: params.id, timestamp: now }),
            now,
            evtCompletedId,
            JSON.stringify({ worker_id: params.workerId, result_id: params.id, status: "COMPLETED", timestamp: now }),
          ]
        );

        await client.query("COMMIT");

        return {
          success: true,
          task: taskUpdateRes.rows[0],
          result: resultRes.rows[0],
        };
      } catch (err: any) {
        await client.query("ROLLBACK");
        if (err.code === "23505") { // unique violation
          return { success: false, error: "Task result already submitted", code: 409 };
        }
        throw err;
      } finally {
        client.release();
      }
    } else {
      const task = memStore.tasks.get(params.taskId);
      if (!task) return { success: false, error: "Task not found", code: 404 };

      if (task.assigned_worker_id !== params.workerId) {
        return { success: false, error: "Worker is not assigned to this task", code: 403 };
      }

      if (task.status === "COMPLETED" || memStore.taskResults.has(params.taskId)) {
        return { success: false, error: "Task result already submitted", code: 409 };
      }

      if (task.status !== "IN_PROGRESS") {
        return { success: false, error: `Cannot submit result for task in status '${task.status}'`, code: 400 };
      }

      validateTransition(task.status, "COMPLETED");

      const resultRow: TaskResultRow = {
        id: params.id,
        task_id: params.taskId,
        worker_id: params.workerId,
        result_payload: params.resultPayload,
        submitted_at: now,
        accepted_at: now,
      };

      memStore.taskResults.set(params.taskId, resultRow);
      task.status = "COMPLETED";
      task.updated_at = now;

      return {
        success: true,
        task: { ...task },
        result: { ...resultRow },
      };
    }
  },

  // Get Result
  async getTaskResult(taskId: string): Promise<TaskResultRow | null> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(`SELECT * FROM task_results WHERE task_id = $1 LIMIT 1`, [taskId]);
      return res.rows[0] || null;
    }
    return memStore.taskResults.get(taskId) || null;
  },

  // Events
  async logEvent(params: {
    id: string;
    eventType: string;
    entityType: string;
    entityId: string;
    payload?: Record<string, unknown>;
  }): Promise<EventRow> {
    checkProductionDbSafety();
    const pool = getPgPool();
    const now = new Date().toISOString();
    const row: EventRow = {
      id: params.id,
      event_type: params.eventType,
      entity_type: params.entityType,
      entity_id: params.entityId,
      payload: params.payload || {},
      created_at: now,
    };

    if (pool) {
      await pool.query(
        `INSERT INTO events (id, event_type, entity_type, entity_id, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.id, row.event_type, row.entity_type, row.entity_id, JSON.stringify(row.payload), row.created_at]
      );
    } else {
      memStore.events.push(row);
    }
    return row;
  },

  async getEvents(entityId?: string): Promise<EventRow[]> {
    checkProductionDbSafety();
    const pool = getPgPool();
    if (pool) {
      const sql = entityId
        ? `SELECT * FROM events WHERE entity_id = $1 ORDER BY created_at ASC`
        : `SELECT * FROM events ORDER BY created_at DESC LIMIT 100`;
      const res = await pool.query(sql, entityId ? [entityId] : []);
      return res.rows;
    }
    if (entityId) {
      return memStore.events.filter((e) => e.entity_id === entityId);
    }
    return [...memStore.events].reverse().slice(0, 100);
  },
};
