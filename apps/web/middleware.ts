import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/staff",
  "/attendance",
  "/absences",
  "/worklogs",
  "/access-requests",
  "/reports",
  "/audit",
  "/account",
];

export function middleware(request: NextRequest) {
  if (
    PROTECTED_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix)) &&
    !request.cookies.has("ward_session")
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/staff/:path*",
    "/attendance/:path*",
    "/absences/:path*",
    "/worklogs/:path*",
    "/access-requests/:path*",
    "/reports/:path*",
    "/audit/:path*",
    "/account/:path*",
  ],
};
