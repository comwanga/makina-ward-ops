import { z } from "zod";
import { idSchema } from "./common";

export const evidenceStageSchema = z.enum(["BEFORE", "DURING", "AFTER"]);

export const evidenceListSchema = z.object({
  workLogId: idSchema,
});

export const evidenceMetaSchema = z.object({
  stage: evidenceStageSchema,
  caption: z.string().trim().max(2000).default(""),
});

export type EvidenceStageInput = z.infer<typeof evidenceStageSchema>;
export type EvidenceListInput = z.infer<typeof evidenceListSchema>;
export type EvidenceMetaInput = z.infer<typeof evidenceMetaSchema>;
