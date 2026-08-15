import { z } from "zod";
import { idSchema } from "./common";

export const SESSION_DURATIONS = [30, 60, 120, 240, 480] as const;

export const createAttendanceSessionSchema = z.object({
  wardId: idSchema,
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  activity: z.string().trim().min(1).max(160),
  location: z.string().trim().min(1).max(160),
  durationMinutes: z
    .number()
    .int()
    .refine((v) => (SESSION_DURATIONS as readonly number[]).includes(v), {
      message: "Duration must be one of 30, 60, 120, 240 or 480 minutes",
    }),
});

export const checkInSchema = z.object({
  sessionToken: z.string().min(16),
  employeeNumber: z.string().trim().regex(/^(?:19|20)\d{9}$/),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

export const manualAttendanceSchema = z.object({
  employeeId: idSchema,
  status: z.enum(["PRESENT", "ABSENT", "OFF_DUTY", "SICK_OFF"]),
  reason: z.string().trim().min(5),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const attendanceQuerySchema = z.object({
  wardId: idSchema.optional(),
  sessionId: idSchema.optional(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const rosterQuerySchema = z.object({
  wardId: idSchema,
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type CreateAttendanceSessionInput = z.infer<typeof createAttendanceSessionSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;
export type ManualAttendanceInput = z.infer<typeof manualAttendanceSchema>;
export type AttendanceQueryInput = z.infer<typeof attendanceQuerySchema>;
export type RosterQueryInput = z.infer<typeof rosterQuerySchema>;
