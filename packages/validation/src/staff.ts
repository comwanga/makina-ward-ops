import { z } from "zod";
import { employeeNumberSchema, idSchema, kenyanPhoneSchema } from "./common";

export const createEmployeeSchema = z.object({
  employeeNumber: employeeNumberSchema,
  fullName: z.string().trim().min(3).max(120),
  phone: kenyanPhoneSchema,
  email: z.string().trim().toLowerCase().email().max(160).optional().nullable(),
  designation: z.string().trim().min(2).max(80).default("Green Army Staff"),
  residence: z.string().trim().max(160).optional().nullable(),
  rosterStatus: z.enum(["ON_DUTY", "ANNUAL_LEAVE"]).default("ON_DUTY"),
  wardId: idSchema,
});

export const updateEmployeeSchema = createEmployeeSchema
  .omit({ wardId: true })
  .partial();

export const createEmployeeAssignmentSchema = z.object({
  wardId: idSchema,
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type CreateEmployeeAssignmentInput = z.infer<typeof createEmployeeAssignmentSchema>;
