import { z } from "zod";
import { CAPABILITY_CODES, ROLE_CODES } from "@ward-ops/contracts";
import { idSchema, passwordSchema, scopeTypeSchema } from "./common";

export const userAssignmentSchema = z.object({
  roleCode: z.enum(ROLE_CODES),
  scopeType: scopeTypeSchema,
  scopeId: idSchema,
});

export const updateUserAssignmentsSchema = z.object({
  assignments: z.array(userAssignmentSchema).min(1).max(50),
}).superRefine((value, context) => {
  const keys = new Set<string>();
  value.assignments.forEach((assignment, index) => {
    const key = `${assignment.roleCode}|${assignment.scopeType}|${assignment.scopeId}`;
    if (keys.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assignments must be unique",
        path: ["assignments", index],
      });
    }
    keys.add(key);
  });
});

export const adminPasswordResetSchema = z.object({
  temporaryPassword: passwordSchema,
});

export const updateRoleCapabilitiesSchema = z.object({
  capabilities: z.array(z.enum(CAPABILITY_CODES)).max(CAPABILITY_CODES.length),
});

export type UserAssignmentInput = z.infer<typeof userAssignmentSchema>;
export type UpdateUserAssignmentsInput = z.infer<typeof updateUserAssignmentsSchema>;
export type AdminPasswordResetInput = z.infer<typeof adminPasswordResetSchema>;
export type UpdateRoleCapabilitiesInput = z.infer<typeof updateRoleCapabilitiesSchema>;
