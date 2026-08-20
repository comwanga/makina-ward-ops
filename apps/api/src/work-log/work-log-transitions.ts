import type { WorkLogAction, WorkLogStatus } from "@ward-ops/contracts";

export const WORK_LOG_ACTIONS = ["SUBMIT", "APPROVE", "REJECT"] as const;

const TRANSITIONS: Partial<Record<WorkLogStatus, Partial<Record<WorkLogAction, WorkLogStatus>>>> = {
  DRAFT: { SUBMIT: "SUBMITTED" },
  SUBMITTED: { APPROVE: "APPROVED", REJECT: "REJECTED" },
};

export function nextWorkLogStatus(
  status: WorkLogStatus,
  action: WorkLogAction,
): WorkLogStatus | null {
  return TRANSITIONS[status]?.[action] ?? null;
}
