import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  attendanceQuerySchema,
  checkInSchema,
  createAttendanceSessionSchema,
  manualAttendanceSchema,
  rosterQuerySchema,
} from "@ward-ops/validation";
import { Public } from "../common/public.decorator";
import { RequireCapability } from "../authorization/capability.decorator";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { AttendanceService } from "./attendance.service";

@Controller("attendance")
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @RequireCapability("ATTENDANCE_MANAGE")
  @Post("sessions")
  createSession(
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = createAttendanceSessionSchema.parse(body);
    return this.attendance.createSession(auth!, input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @RequireCapability("ATTENDANCE_READ")
  @Get("sessions")
  listSessions(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = attendanceQuerySchema.parse(query);
    return this.attendance.listSessions(auth!, input);
  }

  @RequireCapability("ATTENDANCE_READ")
  @Get("sessions/:id")
  getSession(@Param("id") id: string, @CurrentUser() auth: AuthContext | undefined) {
    return this.attendance.getSession(auth!, id);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("sessions/:token/check-in")
  checkIn(@Param("token") token: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const input = checkInSchema.parse({ ...(body as object), sessionToken: token });
    return this.attendance.checkIn(input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @RequireCapability("ATTENDANCE_MANAGE")
  @Post("manual")
  manual(
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = manualAttendanceSchema.parse(body);
    return this.attendance.manual(auth!, input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @RequireCapability("ATTENDANCE_READ")
  @Get()
  listAttendance(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = attendanceQuerySchema.parse(query);
    return this.attendance.listAttendance(auth!, input);
  }

  @RequireCapability("ATTENDANCE_READ")
  @Get("roster")
  roster(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = rosterQuerySchema.parse(query);
    return this.attendance.roster(auth!, input);
  }
}