import { Pool } from "pg";
import { loadEnvConfig } from "@next/env";
import { TASK_CATALOGUE } from "../lib/catalogue";
import { TaskStatus, validateTransition } from "../lib/state-machine";
import { generateToken, hashToken, verifyTokenHash } from "../lib/auth";

// Ensure environment variables (.env.local, .env, etc.) are loaded
loadEnvConfig(process.cwd());

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

// In-Memory Store for isolated testing or fallback
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
    // Seed task types
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

    // Seed mock workers
    const mockWorkers: WorkerRow[] = [
      { id: "w_alex_ux", display_name: "Alex Rivera (Senior UX Specialist)", email: "alex@example.com", status: "ACTIVE", created_at: new Date().toISOString() },
      { id: "w_sam_arch", display_name: "Sam Chen (Principal Cloud Architect)", email: "sam@example.com", status: "ACTIVE", created_at: new Date().toISOString() },
      { id: "w_elena_fact", display_name: "Dr. Elena Rostova (Research Analyst)", email: "elena@example.com", status: "ACTIVE", created_at: new Date().toISOString() },
      { id: "w_morgan_general", display_name: "Morgan Taylor (Full-Stack Engineer)", email: "morgan@example.com", status: "ACTIVE", created_at: new Date().toISOString() },
    ];

    for (const w of mockWorkers) {
      this.workers.set(w.id, w);
    }

    // Seed worker capabilities
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

// Neon / PostgreSQL Pool
let pgPool: Pool | null = null;

function getPgPool(): Pool | null {
  if (process.env.DATABASE_URL && !pgPool) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
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
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(sql, params);
      return res.rows;
    }
    return [];
  },

  // Task Types
  async getAllTaskTypes(): Promise<TaskTypeRow[]> {
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
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(`SELECT * FROM workers ORDER BY id ASC`);
      return res.rows;
    }
    return Array.from(memStore.workers.values());
  },

  async getWorker(id: string): Promise<WorkerRow | null> {
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(`SELECT * FROM workers WHERE id = $1 LIMIT 1`, [id]);
      return res.rows[0] || null;
    }
    return memStore.workers.get(id) || null;
  },

  async verifyWorkerCapability(workerId: string, capabilityCode: string): Promise<boolean> {
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

  // Tasks (Idempotent & Auth Token Generation)
  async getTaskByQuoteId(quoteId: string): Promise<TaskRow | null> {
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
    const pool = getPgPool();
    const now = new Date().toISOString();

    // Check for existing task for idempotent return
    const existing = await this.getTaskByQuoteId(params.quote_id);
    if (existing) {
      return {
        task: existing,
        agent_token: "", // not re-exposed on idempotent read unless requested
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

    // Find qualified workers
    const taskType = await this.getTaskType(params.task_type_id);
    const capability = taskType?.required_capability || "";
    const qualifiedWorkers = await this.getWorkersByCapability(capability);

    const offers: Array<{ worker_id: string; worker_token: string; offer_id: string }> = [];

    if (pool) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Insert task with UNIQUE(quote_id) enforcement
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

        // If duplicate conflict occurred concurrently, fetch and return existing
        if (taskInsert.rows.length === 0) {
          await client.query("ROLLBACK");
          const conflictTask = await this.getTaskByQuoteId(params.quote_id);
          return {
            task: conflictTask!,
            agent_token: "",
            offers: [],
            is_existing: true,
          };
        }

        // Insert task offers for each qualified worker
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
      // In-Memory atomic insertion
      if (memStore.tasks.has(taskRow.id) || Array.from(memStore.tasks.values()).some((t) => t.quote_id === taskRow.quote_id)) {
        const conflictTask = Array.from(memStore.tasks.values()).find((t) => t.quote_id === taskRow.quote_id);
        return { task: conflictTask!, agent_token: "", offers: [], is_existing: true };
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
    if (!agentToken) return false;
    const task = await this.getTask(taskId);
    if (!task || !task.agent_token_hash) return false;
    return verifyTokenHash(agentToken, task.agent_token_hash);
  },

  async verifyWorkerToken(taskId: string, workerId: string, workerToken: string): Promise<boolean> {
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

  async getOffersForTask(taskId: string): Promise<TaskOfferRow[]> {
    const pool = getPgPool();
    if (pool) {
      const res = await pool.query(`SELECT * FROM task_offers WHERE task_id = $1 ORDER BY offered_at ASC`, [taskId]);
      return res.rows;
    }
    return Array.from(memStore.taskOffers.values()).filter((o) => o.task_id === taskId);
  },

  // Task Acceptance (Capability Verified, Token Authenticated, Atomic Concurrency Safe)
  async acceptTask(
    taskId: string,
    workerId: string,
    workerToken?: string
  ): Promise<{ success: boolean; task?: TaskRow; error?: string; code?: number }> {
    const pool = getPgPool();
    const now = new Date().toISOString();

    const task = await this.getTask(taskId);
    if (!task) {
      return { success: false, error: `Task '${taskId}' not found`, code: 404 };
    }

    // 1. Verify Worker Capability
    const taskType = await this.getTaskType(task.task_type_id);
    const hasCapability = await this.verifyWorkerCapability(workerId, taskType?.required_capability || "");
    if (!hasCapability) {
      return {
        success: false,
        error: `Worker '${workerId}' does not possess the required verified capability: '${taskType?.required_capability}'`,
        code: 403,
      };
    }

    // 2. Verify Worker Offer Token if token auth is provided
    if (workerToken) {
      const validToken = await this.verifyWorkerToken(taskId, workerId, workerToken);
      if (!validToken) {
        return { success: false, error: "Invalid worker offer token", code: 401 };
      }
    }

    if (pool) {
      // 3. Atomic state transition in PostgreSQL
      const res = await pool.query(
        `UPDATE tasks
         SET status = 'ACCEPTED', assigned_worker_id = $1, updated_at = $2
         WHERE id = $3 AND status = 'OFFERED' AND assigned_worker_id IS NULL
         RETURNING *`,
        [workerId, now, taskId]
      );

      if (res.rows.length === 0) {
        const existing = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [taskId]);
        if (existing.rows.length === 0) return { success: false, error: `Task ${taskId} not found`, code: 404 };
        const t = existing.rows[0];
        if (t.assigned_worker_id && t.assigned_worker_id !== workerId) {
          return { success: false, error: "Task already accepted by another worker", code: 409 };
        }
        return { success: false, error: `Task cannot be accepted from status '${t.status}'`, code: 400 };
      }

      // Update existing offer row
      await pool.query(
        `UPDATE task_offers
         SET status = 'ACCEPTED', responded_at = $1
         WHERE task_id = $2 AND worker_id = $3`,
        [now, taskId, workerId]
      );

      return { success: true, task: res.rows[0] };
    } else {
      // In-Memory atomic transition
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

      return { success: true, task: { ...memTask } };
    }
  },

  // Start Task
  async startTask(
    taskId: string,
    workerId: string,
    workerToken?: string
  ): Promise<{ success: boolean; task?: TaskRow; error?: string; code?: number }> {
    const pool = getPgPool();
    const now = new Date().toISOString();

    if (workerToken) {
      const validToken = await this.verifyWorkerToken(taskId, workerId, workerToken);
      if (!validToken) {
        return { success: false, error: "Invalid worker token", code: 401 };
      }
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

  // Submit Result & Complete Task (Atomic Duplicate Prevention)
  async submitTaskResult(params: {
    id: string;
    taskId: string;
    workerId: string;
    workerToken?: string;
    resultPayload: Record<string, unknown>;
  }): Promise<{ success: boolean; task?: TaskRow; result?: TaskResultRow; error?: string; code?: number }> {
    const pool = getPgPool();
    const now = new Date().toISOString();

    if (params.workerToken) {
      const validToken = await this.verifyWorkerToken(params.taskId, params.workerId, params.workerToken);
      if (!validToken) {
        return { success: false, error: "Invalid worker token", code: 401 };
      }
    }

    if (pool) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Atomic check and transition from IN_PROGRESS to COMPLETED
        const taskUpdateRes = await client.query(
          `UPDATE tasks
           SET status = 'COMPLETED', updated_at = $1
           WHERE id = $2 AND assigned_worker_id = $3 AND status = 'IN_PROGRESS'
           RETURNING *`,
          [now, params.taskId, params.workerId]
        );

        if (taskUpdateRes.rows.length === 0) {
          await client.query("ROLLBACK");
          // Check reason for failure
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

        // Insert result row
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

        await client.query("COMMIT");
        return {
          success: true,
          task: taskUpdateRes.rows[0],
          result: resultRes.rows[0],
        };
      } catch (err: any) {
        await client.query("ROLLBACK");
        if (err.code === "23505") { // unique constraint violation
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
