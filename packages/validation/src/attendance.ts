import { z } from "zod";
import { idSchema, isoDateSchema, optionalPaginationSchema, strictBooleanSchema } from "./common";

export const SESSION_DURATIONS = [30, 60, 120, 240, 480] as const;

export const createAttendanceSessionSchema = z.object({
  wardId: idSchema,
  workDate: isoDateSchema.optional(),
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
  phoneLast4: z.string().trim().regex(/^\d{4}$/, "Enter the last four digits of your phone number"),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

export const manualAttendanceSchema = z.object({
  sessionId: idSchema,
  employeeId: idSchema,
  status: z.enum(["PRESENT", "ABSENT", "OFF_DUTY", "SICK_OFF"]),
  reason: z.string().trim().min(5),
  workDate: isoDateSchema,
});

export const correctAttendanceSchema = z.object({
  sessionId: idSchema,
  status: z.enum(["PRESENT", "LATE", "ABSENT", "OFF_DUTY", "SICK_OFF"]),
  reason: z.string().trim().min(5).max(2000),
});

export const attendanceQuerySchema = optionalPaginationSchema.extend({
  wardId: idSchema.optional(),
  sessionId: idSchema.optional(),
  employeeId: idSchema.optional(),
  workDate: isoDateSchema.optional(),
  status: z.enum(["PRESENT", "LATE", "ABSENT", "OFF_DUTY", "SICK_OFF", "LEAVE", "OFFICIAL_DUTY"]).optional(),
  active: strictBooleanSchema.optional(),
});

export const rosterQuerySchema = z.object({
  wardId: idSchema,
  workDate: isoDateSchema.optional(),
  sessionId: idSchema.optional(),
});

export type CreateAttendanceSessionInput = z.infer<typeof createAttendanceSessionSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;
export type ManualAttendanceInput = z.infer<typeof manualAttendanceSchema>;
export type CorrectAttendanceInput = z.infer<typeof correctAttendanceSchema>;
export type AttendanceQueryInput = z.infer<typeof attendanceQuerySchema>;
export type RosterQueryInput = z.infer<typeof rosterQuerySchema>;
