export type TaskStatus =
  | "OFFERED"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED";

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  OFFERED: ["ACCEPTED", "CANCELLED", "EXPIRED"],
  ACCEPTED: ["IN_PROGRESS", "CANCELLED", "FAILED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED", "FAILED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
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
