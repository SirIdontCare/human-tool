export type TaskStatus =
  | "CREATED"
  | "OFFERED"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "REJECTED"
  | "FAILED";

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  CREATED: ["OFFERED", "ACCEPTED", "CANCELLED", "EXPIRED"],
  OFFERED: ["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"],
  ACCEPTED: ["IN_PROGRESS", "FAILED", "CANCELLED"],
  IN_PROGRESS: ["SUBMITTED", "FAILED", "CANCELLED"],
  SUBMITTED: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  REJECTED: [],
  FAILED: [],
};

export class InvalidStateTransitionError extends Error {
  constructor(public currentStatus: TaskStatus, public targetStatus: TaskStatus) {
    super(`Invalid task state transition from '${currentStatus}' to '${targetStatus}'`);
    this.name = "InvalidStateTransitionError";
  }
}

export function canTransition(current: TaskStatus, target: TaskStatus): boolean {
  const allowed = VALID_TRANSITIONS[current] || [];
  return allowed.includes(target);
}

export function validateTransition(current: TaskStatus, target: TaskStatus): void {
  if (!canTransition(current, target)) {
    throw new InvalidStateTransitionError(current, target);
  }
}
