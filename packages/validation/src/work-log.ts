import { z } from "zod";
import { idSchema } from "./common";

export const createWorkLogSchema = z
  .object({
    wardId: z.string().cuid(),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    activity: z.string().trim().min(3).max(160),
    location: z.string().trim().min(3).max(160),
    areasRoads: z.string().trim().min(3),
    description: z.string().trim().min(3),
    numberOfTrips: z.coerce.number().int().min(0).default(0),
    wasteTransferInvolved: z.coerce.boolean().default(false),
    truckId: z.string().trim().toUpperCase().default(""),
    backhoeId: z.string().trim().toUpperCase().default(""),
    staffCount: z.coerce.number().int().min(0).default(0),
    challenges: z.string().trim().max(2000).optional().nullable(),
    cleanupDone: z.coerce.boolean().default(false),
    cleanupStakeholders: z.string().trim().max(2000).default(""),
    climateTeamCount: z.coerce.number().int().min(0).default(0),
    completionStatus: z.enum(["COMPLETE", "INCOMPLETE"]).default("COMPLETE"),
    outstandingWork: z.string().trim().max(2000).default(""),
  })
  .refine((v) => !v.truckId || /^T-\d+$/.test(v.truckId), {
    message: "Truck identification must use the format T-161",
  })
  .refine((v) => !v.backhoeId || /^BH\d+$/.test(v.backhoeId), {
    message: "Backhoe identification must use the format BH13",
  })
  .refine(
    (v) => !v.wasteTransferInvolved || (v.numberOfTrips >= 1 && (!!v.truckId || !!v.backhoeId)),
    { message: "Waste transfer requires at least one trip and a truck or backhoe identification number" },
  )
  .refine((v) => !v.cleanupDone || (v.cleanupStakeholders.trim() || v.climateTeamCount > 0), {
    message: "Record the cleanup stakeholders or the number of Climate Works team members",
  })
  .refine((v) => v.completionStatus !== "INCOMPLETE" || v.outstandingWork.trim().length >= 5, {
    message: "Describe the outstanding work for an incomplete activity",
  });

export const workLogActionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reviewNote: z.string().trim().max(2000).default(""),
});

export const workLogQuerySchema = z.object({
  wardId: idSchema.optional(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["SUBMITTED", "APPROVED", "REJECTED"]).optional(),
});

export type CreateWorkLogInput = z.infer<typeof createWorkLogSchema>;
export type WorkLogActionInput = z.infer<typeof workLogActionSchema>;
export type WorkLogQueryInput = z.infer<typeof workLogQuerySchema>;
