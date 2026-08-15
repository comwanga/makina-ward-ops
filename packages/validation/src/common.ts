import { z } from "zod";

export const idSchema = z.string().cuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const isoDateSchema = z.coerce.date().transform((d) => d.toISOString().slice(0, 10));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(160);

export const passwordSchema = z.string().min(12).max(300);

/**
 * 11-digit, year-prefixed Employee ID, e.g. 20230464669.
 */
export const employeeNumberSchema = z
  .string()
  .trim()
  .regex(/^(?:19|20)\d{9}$/, "Employee ID must be 11 digits and start with a four-digit year");

/**
 * Kenyan phone number, normalized to +254 or 0-prefixed form.
 */
export const kenyanPhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^0-9+]/g, ""))
  .pipe(z.string().regex(/^(?:\+254|0)\d{9}$/, "Enter a valid Kenyan phone number"));

export const scopeTypeSchema = z.enum(["COUNTY", "SUBCOUNTY", "WARD"]);
