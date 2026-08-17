import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "ward_ops.isPublic";

/** Marks a route as reachable without an authenticated session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);