import { z } from "zod";
import { idSchema, isoDateSchema, optionalPaginationSchema, strictBooleanSchema } from "./common";

export const absenceKinds = [
  "ANNUAL_LEAVE",
  "MATERNITY_LEAVE",
  "PATERNITY_LEAVE",
  "COMPASSIONATE_LEAVE",
  "SICK_OFF",
  "OFFICIAL_DUTY",
  "UNPAID_LEAVE",
] as const;

export const createAbsenceSchema = z
  .object({
    employeeId: z.string().cuid(),
    kind: z.enum(absenceKinds),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    returnDate: isoDateSchema,
    reason: z.string().trim().max(2000).default(""),
    planned: strictBooleanSchema.default(false),
    documentCategory: z
      .enum([
        "SICK_SHEET",
        "MEDICAL_CERTIFICATE",
        "LEAVE_FORM",
        "LEAVE_APPROVAL",
        "RETURN_TO_WORK",
        "OTHER",
      ])
      .optional(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "End date must be after start date" })
  .refine((v) => v.returnDate > v.endDate, { message: "Return date must be after end date" })
  .refine((v) => v.kind !== "SICK_OFF" || v.reason.trim().length >= 10, {
    message: "Provide a sufficient sick-off reason",
  });

export const absenceActionSchema = z.object({
  action: z.enum(["SUBMIT", "APPROVE", "REJECT", "CANCEL"]),
  expectedVersion: z.number().int().positive(),
  reviewNote: z.string().trim().max(2000).default(""),
});

export const absenceQuerySchema = optionalPaginationSchema.extend({
  wardId: idSchema.optional(),
  status: z
    .enum(["PLANNED", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"])
    .optional(),
  employeeId: idSchema.optional(),
  fromDate: isoDateSchema.optional(),
  toDate: isoDateSchema.optional(),
});

export const documentCategorySchema = z.enum([
  "SICK_SHEET",
  "MEDICAL_CERTIFICATE",
  "LEAVE_FORM",
  "LEAVE_APPROVAL",
  "RETURN_TO_WORK",
  "OTHER",
]);

export type CreateAbsenceInput = z.infer<typeof createAbsenceSchema>;
export type AbsenceActionInput = z.infer<typeof absenceActionSchema>;
export type AbsenceQueryInput = z.infer<typeof absenceQuerySchema>;
export type DocumentCategory = z.infer<typeof documentCategorySchema>;
