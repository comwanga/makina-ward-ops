import { z } from "zod";
import { ROLE_CODES, SCOPE_TYPES } from "@ward-ops/contracts";
import { emailSchema, idSchema, passwordSchema, scopeTypeSchema } from "./common";

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(300),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(300),
  newPassword: passwordSchema,
});

export const bootstrapSchema = z.object({
  setupToken: z.string().min(1, "Setup token is required"),
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
});

export const accessRequestSchema = z.object({
  displayName: z.string().trim().min(2, "Display name is required").max(120),
  email: emailSchema,
  password: passwordSchema,
  reason: z.string().trim().min(5, "A short reason is required").max(2000),
  requestedScope: scopeTypeSchema,
  requestedScopeId: idSchema,
});

export const accessRequestDecisionSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    roleCode: z.enum(ROLE_CODES).optional(),
    scopeType: z.enum(SCOPE_TYPES).optional(),
    scopeId: idSchema.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine(
    (value) => {
      if (value.action === "approve") {
        if (value.roleCode === undefined) return false;
        if (value.scopeType === undefined || value.scopeId === undefined) {
          return value.scopeType === undefined && value.scopeId === undefined;
        }
        return true;
      }
      return true;
    },
    {
      message:
        "Approval requires roleCode and a scope (or none to inherit the request's requested scope)",
    },
  );

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type BootstrapInput = z.infer<typeof bootstrapSchema>;
export type AccessRequestInput = z.infer<typeof accessRequestSchema>;
export type AccessRequestDecisionInput = z.infer<typeof accessRequestDecisionSchema>;
