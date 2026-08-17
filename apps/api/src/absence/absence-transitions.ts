import type { AbsenceAction, AbsenceStatus } from "@ward-ops/contracts";
import { ABSENCE_ACTIONS, ABSENCE_STATUSES } from "@ward-ops/contracts";

export type { AbsenceAction, AbsenceStatus };

/**
 * Explicit absence state machine (§18 of the spec). No workflow engine; a
 * small, auditable transition table. APPROVED/REJECTED/CANCELLED are terminal
 * and only move via an explicit, audited correction.
 */
const TRANSITIONS: Record<AbsenceStatus, Partial<Record<AbsenceAction, AbsenceStatus>>> = {
  PLANNED: { SUBMIT: "SUBMITTED", CANCEL: "CANCELLED" },
  SUBMITTED: { APPROVE: "APPROVED", REJECT: "REJECTED", CANCEL: "CANCELLED" },
  APPROVED: {},
  REJECTED: {},
  CANCELLED: {},
};

export function nextAbsenceStatus(
  status: AbsenceStatus,
  action: AbsenceAction,
): AbsenceStatus | null {
  return TRANSITIONS[status]?.[action] ?? null;
}

export function isAbsenceStatus(value: string): value is AbsenceStatus {
  return (ABSENCE_STATUSES as readonly string[]).includes(value);
}

export function isAbsenceAction(value: string): value is AbsenceAction {
  return (ABSENCE_ACTIONS as readonly string[]).includes(value);
}