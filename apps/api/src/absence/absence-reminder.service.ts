import { Inject, Injectable, Logger } from "@nestjs/common";
import { createTransport } from "nodemailer";
import type { Transporter } from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";

const REMINDER_OFFSETS = [30, 14, 7];
const HOUR_MS = 60 * 60 * 1000;
const CLAIM_STALE_MS = 15 * 60 * 1000;

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

      const claim = await this.prisma.client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reminder:${request.id}:${days}`}))`;
        let delivery = await tx.reminderDelivery.findUnique({
          where: { absenceRequestId_reminderDays: { absenceRequestId: request.id, reminderDays: days } },
        });
        const created = !delivery;
        if (!delivery) {
          delivery = await tx.reminderDelivery.create({
            data: { absenceRequestId: request.id, reminderDays: days, recipient, status: "PENDING" },
          });
        }
        if (delivery.status === "SENT") return null;
        if (!this.transporter) {
          if (created) {
            await tx.reminderDelivery.update({
              where: { id: delivery.id },
              data: { message: "SMTP is not configured; reminder retained for delivery" },
            });
          }
          return created ? { deliveryId: delivery.id, send: false } : null;
        }
        const claimedAt = delivery.message?.startsWith("SENDING:")
          ? Date.parse(delivery.message.slice("SENDING:".length))
          : Number.NaN;
        if (!Number.isNaN(claimedAt) && Date.now() - claimedAt < CLAIM_STALE_MS) return null;
        await tx.reminderDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "FAILED",
            message: `SENDING:${new Date().toISOString()}`,
          },
        });
        return { deliveryId: delivery.id, send: true };
      });
      if (!claim) continue;
      if (claim.send) {
        const sent = await this.send(recipient, request.employee.fullName, request.startDate, days);
        await this.prisma.client.reminderDelivery.update({
          where: { id: claim.deliveryId },
          data: {
            status: sent ? "SENT" : "FAILED",
            message: sent ? null : "Delivery failed; retry pending",
            sentAt: sent ? new Date() : null,
          },
        });
      }
      processed += 1;
    }

    if (processed > 0) {
      await this.audit.record({
        action: "ABSENCE.REMINDERS_PROCESSED",
        targetType: "ReminderDelivery",
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: `${processed} reminder deliveries created or attempted`,
      });
    }
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
