import { Inject, Injectable, Logger } from "@nestjs/common";
import { createTransport } from "nodemailer";
import type { Transporter } from "nodemailer";
import { Prisma } from "@ward-ops/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";

const REMINDER_OFFSETS = [30, 14, 7];
const HOUR_MS = 60 * 60 * 1000;

/** Redacts an email address for logging (e.g. a***@example.com). */
function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const first = local[0] ?? "";
  return `${first}***@${domain}`;
}

function todayNairobi(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatLongDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

/**
 * Leave reminders at 30 / 14 / 7 days before the start date (legacy offsets),
 * idempotent per (absenceRequestId, reminderDays). Delivery records always
 * persist; emails are sent only when SMTP is configured, otherwise deliveries
 * remain PENDING for a later SMTP-enabled run.
 */
@Injectable()
export class AbsenceReminderService {
  private readonly logger = new Logger("AbsenceReminder");
  private readonly transporter: Transporter | null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    if (config.smtp.host) {
      this.transporter = createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth:
          config.smtp.username && config.smtp.password
            ? { user: config.smtp.username, pass: config.smtp.password }
            : undefined,
      });
    } else {
      this.transporter = null;
    }
  }

  async processReminders(meta: { sourceIp?: string; requestId?: string } = {}): Promise<number> {
    const today = todayNairobi();
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const horizon = new Date(todayDate.getTime() + 30 * 24 * HOUR_MS);

    const requests = await this.prisma.client.absenceRequest.findMany({
      where: {
        kind: { not: "SICK_OFF" },
        status: { in: ["PLANNED", "SUBMITTED", "APPROVED"] },
        startDate: { gte: todayDate, lte: horizon },
      },
      include: { employee: { select: { email: true, fullName: true } } },
    });

    let processed = 0;
    for (const request of requests) {
      const days = Math.round(
        (request.startDate.getTime() - todayDate.getTime()) / (24 * HOUR_MS),
      );
      if (!REMINDER_OFFSETS.includes(days)) continue;
      const recipient = request.employee.email;
      if (!recipient) continue;

      let deliveryId: string;
      try {
        const delivery = await this.prisma.client.reminderDelivery.create({
          data: {
            absenceRequestId: request.id,
            reminderDays: days,
            recipient,
            status: "PENDING",
          },
        });
        deliveryId = delivery.id;
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }

      const sent = await this.send(
        recipient,
        request.employee.fullName,
        request.startDate,
        days,
      );
      await this.prisma.client.reminderDelivery.update({
        where: { id: deliveryId },
        data: {
          status: sent ? "SENT" : "PENDING",
          message: sent ? null : "SMTP is not configured; reminder retained for delivery",
          sentAt: sent ? new Date() : null,
        },
      });
      processed += 1;
    }

    await this.audit.record({
      action: "ABSENCE.REMINDERS_PROCESSED",
      targetType: "ReminderDelivery",
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: `${processed} reminder deliveries created`,
    });
    return processed;
  }

  private async send(
    recipient: string,
    fullName: string,
    startDate: Date,
    days: number,
  ): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }
    try {
      await this.transporter.sendMail({
        from: this.config.smtp.from,
        to: recipient,
        subject: `Leave application reminder: ${formatLongDate(startDate)}`,
        text: `Dear ${fullName},\n\nYour planned leave begins in ${days} days. Please submit or confirm your leave application in good time.\n\nMazingiraOps`,
      });
      return true;
    } catch (error) {
      this.logger.error(`Reminder send failed for ${redactEmail(recipient)}: ${String(error)}`);
      return false;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}