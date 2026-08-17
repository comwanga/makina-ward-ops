import Image from "next/image";
import { BRANDING } from "@/lib/branding";

interface BrandLogoProps {
  size?: number;
  priority?: boolean;
}

export function BrandLogo({ size = 48, priority = false }: BrandLogoProps) {
  return (
    <Image
      src={BRANDING.logo}
      alt="Nairobi City County"
      width={size}
      height={size}
      priority={priority}
      className="brand-logo"
    />
  );
}
