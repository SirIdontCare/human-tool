import { db } from "@/db";
import { CreateTaskRequestSchema, AcceptTaskRequestSchema, StartTaskRequestSchema, SubmitTaskResultRequestSchema, validateTaskResult } from "@/lib/schemas";
import { ServiceError } from "@/lib/errors";
import { logEvent } from "@/lib/events";

export interface CreateTaskOutput {
  task_id: string;
  quote_id: string;
  task_type: string;
  status: string;
  customer_price_usd: number;
  estimated_minutes: number;
  agent_token?: string;
  worker_task_url: string;
  offers?: Array<{ worker_id: string; worker_url: string }>;
  created_at: string;
  is_existing?: boolean;
}

export interface TaskStateResponse {
  id: string;
  quote_id: string;
  task_type: string;
  title: string;
  description?: string;
  status: string;
  input_payload: Record<string, unknown>;
  customer_price_usd: number;
  estimated_minutes: number;
  required_capability?: string;
  assigned_worker_id: string | null;
  created_at: string;
  updated_at: string;
  compensation_usd?: number;
}

export async function createTaskFromQuote(input: unknown, origin: string = ""): Promise<CreateTaskOutput> {
  const parseResult = CreateTaskRequestSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ServiceError("Invalid request payload", "INVALID_INPUT", 400, parseResult.error.format());
  }

  const { quote_id } = parseResult.data;

  // 1. Fetch quote
  const quote = await db.getQuote(quote_id);
  if (!quote) {
    throw new ServiceError(`Quote '${quote_id}' not found`, "TASK_NOT_FOUND", 404);
  }

  // 2. Check quote expiration
  if (new Date(quote.expires_at).getTime() < Date.now()) {
    throw new ServiceError("Quote has expired", "QUOTE_EXPIRED", 400, { quote_id, expires_at: quote.expires_at });
  }

  // 3. Create task atomically (idempotent replays are handled inside db.createTask,
  // which rotates the agent token so the replaying agent is never stranded)
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // 4. Create task atomically
  const createRes = await db.createTask({
    id: taskId,
    quote_id: quote.id,
    task_type_id: quote.task_type_id,
    input_payload: quote.input_payload,
  });

  if (createRes.is_existing) {
    return {
      task_id: createRes.task.id,
      quote_id: createRes.task.quote_id,
      task_type: createRes.task.task_type_id,
      status: createRes.task.status,
      customer_price_usd: quote.quoted_price_usd,
      estimated_minutes: quote.estimated_minutes,
      agent_token: createRes.agent_token,
      worker_task_url: `${origin}/tasks/${createRes.task.id}`,
      created_at: createRes.task.created_at,
      is_existing: true,
    };
  }

  // Log lifecycle events
  await logEvent("task_created", "task", createRes.task.id, {
    quote_id: quote.id,
    task_type: createRes.task.task_type_id,
    status: createRes.task.status,
    customer_price_usd: quote.quoted_price_usd,
  });

  for (const offer of createRes.offers) {
    await logEvent("task_offered", "task", createRes.task.id, {
      worker_id: offer.worker_id,
      target_payout_usd: quote.target_payout_usd,
      sla_minutes: quote.estimated_minutes,
    });
  }

  const workerTaskUrl = `${origin}/tasks/${createRes.task.id}`;

  return {
    task_id: createRes.task.id,
    quote_id: createRes.task.quote_id,
    task_type: createRes.task.task_type_id,
    status: createRes.task.status,
    customer_price_usd: quote.quoted_price_usd,
    estimated_minutes: quote.estimated_minutes,
    agent_token: createRes.agent_token,
    worker_task_url: workerTaskUrl,
    offers: createRes.offers.map((o) => ({
      worker_id: o.worker_id,
      worker_url: `${origin}/tasks/${createRes.task.id}?worker_id=${o.worker_id}`,
    })),
    created_at: createRes.task.created_at,
    is_existing: false,
  };
}

export async function getTaskState(
  taskId: string,
  agentToken?: string,
  workerToken?: string
): Promise<TaskStateResponse> {
  const task = await db.getTask(taskId);
  if (!task) {
    throw new ServiceError(`Task '${taskId}' not found`, "TASK_NOT_FOUND", 404);
  }

  // Fail-closed authorization: a valid agent token OR a valid per-offer worker token is required.
  const isAgent = Boolean(agentToken && (await db.verifyAgentToken(taskId, agentToken)));
  const workerId = isAgent ? null : workerToken ? await db.getWorkerIdByOfferToken(taskId, workerToken) : null;

  if (!isAgent && !workerId) {
    throw new ServiceError("Unauthorized: valid agent or worker task token required", "UNAUTHORIZED", 401);
  }

  const taskType = await db.getTaskType(task.task_type_id);
  const quote = await db.getQuote(task.quote_id);

  const base: TaskStateResponse = {
    id: task.id,
    quote_id: task.quote_id,
    task_type: task.task_type_id,
    title: taskType?.title || task.task_type_id,
    description: taskType?.description,
    status: task.status,
    input_payload: task.input_payload,
    customer_price_usd: quote?.quoted_price_usd ?? taskType?.customer_price_usd ?? 0,
    estimated_minutes: quote?.estimated_minutes ?? taskType?.default_sla_minutes ?? 30,
    required_capability: taskType?.required_capability,
    assigned_worker_id: task.assigned_worker_id,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };

  if (workerId) {
    // WORKER-ONLY FIELDS: guaranteed compensation, derived server-side from the
    // internal target payout. Never exposed to agents.
    return {
      ...base,
      compensation_usd: quote?.target_payout_usd ?? taskType?.target_payout_usd ?? 0,
    };
  }

  return base;
}

export async function acceptTask(taskId: string, input: unknown, workerToken?: string) {
  const parseResult = AcceptTaskRequestSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ServiceError("Invalid request payload", "INVALID_INPUT", 400, parseResult.error.format());
  }

  const { worker_id } = parseResult.data;

  const worker = await db.getWorker(worker_id);
  if (!worker) {
    throw new ServiceError(`Worker '${worker_id}' not found`, "WORKER_NOT_AUTHORIZED", 404);
  }

  const acceptRes = await db.acceptTask(taskId, worker_id, workerToken, {
    eventType: "task_accepted",
    entityType: "task",
    entityId: taskId,
    payload: {
      worker_id,
      worker_name: worker.display_name,
      status: "ACCEPTED",
    },
  });
  if (!acceptRes.success || !acceptRes.task) {
    const code = acceptRes.code === 403
      ? "WORKER_CAPABILITY_REQUIRED"
      : acceptRes.code === 409
      ? "TASK_ALREADY_ACCEPTED"
      : acceptRes.code === 401
      ? "WORKER_NOT_AUTHORIZED"
      : "INVALID_STATE";
    throw new ServiceError(acceptRes.error || "Failed to accept task", code, acceptRes.code || 400);
  }

  return {
    task_id: acceptRes.task.id,
    status: acceptRes.task.status,
    assigned_worker_id: acceptRes.task.assigned_worker_id,
    updated_at: acceptRes.task.updated_at,
  };
}

export async function startTask(taskId: string, input: unknown, workerToken?: string) {
  const parseResult = StartTaskRequestSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ServiceError("Invalid request payload", "INVALID_INPUT", 400, parseResult.error.format());
  }

  const { worker_id } = parseResult.data;

  if (!workerToken) {
    throw new ServiceError("Worker offer token is required", "WORKER_NOT_AUTHORIZED", 401);
  }

  const startRes = await db.startTask(taskId, worker_id, workerToken);
  if (!startRes.success || !startRes.task) {
    const code = startRes.code === 401 || startRes.code === 403 ? "WORKER_NOT_AUTHORIZED" : "INVALID_STATE";
    throw new ServiceError(startRes.error || "Failed to start task", code, startRes.code || 400);
  }

  await logEvent("task_started", "task", taskId, {
    worker_id,
    status: startRes.task.status,
  });

  return {
    task_id: startRes.task.id,
    status: startRes.task.status,
    assigned_worker_id: startRes.task.assigned_worker_id,
    updated_at: startRes.task.updated_at,
  };
}

export async function submitTaskResult(taskId: string, input: unknown, workerToken?: string) {
  const parseResult = SubmitTaskResultRequestSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ServiceError("Invalid request payload", "INVALID_INPUT", 400, parseResult.error.format());
  }

  const { worker_id, result_payload } = parseResult.data;

  if (!workerToken) {
    throw new ServiceError("Worker offer token is required", "WORKER_NOT_AUTHORIZED", 401);
  }

  const task = await db.getTask(taskId);
  if (!task) {
    throw new ServiceError(`Task '${taskId}' not found`, "TASK_NOT_FOUND", 404);
  }

  const resultValidation = validateTaskResult(task.task_type_id, result_payload);
  if (!resultValidation.success) {
    throw new ServiceError(
      `Malformed result payload for task type '${task.task_type_id}'`,
      "INVALID_INPUT",
      400,
      resultValidation.error.format()
    );
  }

  const resultId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const submitRes = await db.submitTaskResult({
    id: resultId,
    taskId,
    workerId: worker_id,
    workerToken,
    resultPayload: resultValidation.data as Record<string, unknown>,
  });

  if (!submitRes.success || !submitRes.task || !submitRes.result) {
    const code = submitRes.code === 409
      ? "RESULT_ALREADY_SUBMITTED"
      : submitRes.code === 403 || submitRes.code === 401
      ? "WORKER_NOT_AUTHORIZED"
      : "INVALID_STATE";
    throw new ServiceError(submitRes.error || "Failed to submit task result", code, submitRes.code || 400);
  }

  return {
    task_id: submitRes.task.id,
    status: submitRes.task.status,
    result: submitRes.result.result_payload,
    submitted_at: submitRes.result.submitted_at,
  };
}

export async function getTaskResult(taskId: string, agentToken?: string) {
  const task = await db.getTask(taskId);
  if (!task) {
    throw new ServiceError(`Task '${taskId}' not found`, "TASK_NOT_FOUND", 404);
  }

  // Fail-closed: a missing stored hash, missing token, or unverifiable token is
  // always UNAUTHORIZED. Never falls through to public access.
  if (!task.agent_token_hash || !agentToken || !(await db.verifyAgentToken(taskId, agentToken))) {
    throw new ServiceError("Unauthorized: Invalid or missing agent task token", "UNAUTHORIZED", 401);
  }

  if (task.status !== "COMPLETED") {
    throw new ServiceError(
      `Task result is not ready. Current status: ${task.status}`,
      "RESULT_NOT_READY",
      400,
      { task_id: taskId, status: task.status }
    );
  }

  const result = await db.getTaskResult(taskId);
  if (!result) {
    throw new ServiceError(`Result for task '${taskId}' not found`, "TASK_NOT_FOUND", 404);
  }

  await logEvent("result_retrieved", "task_result", result.id, {
    task_id: taskId,
    worker_id: result.worker_id,
  });

  return {
    task_id: task.id,
    task_type: task.task_type_id,
    status: task.status,
    result: result.result_payload,
    submitted_at: result.submitted_at,
    accepted_at: result.accepted_at,
  };
}
