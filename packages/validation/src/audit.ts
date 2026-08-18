import { z } from "zod";
import { paginationSchema } from "./common";

export const auditQuerySchema = paginationSchema.extend({
  action: z.string().trim().min(1).max(120).optional(),
});

export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
