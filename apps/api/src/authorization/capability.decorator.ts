import { SetMetadata } from "@nestjs/common";
import type { CapabilityCode } from "@ward-ops/contracts";

export const REQUIRED_CAPABILITIES_KEY = "ward_ops.requiredCapabilities";

/** Restricts a route to authenticated users holding every listed capability. */
export const RequireCapability = (...codes: CapabilityCode[]) =>
  SetMetadata(REQUIRED_CAPABILITIES_KEY, codes);