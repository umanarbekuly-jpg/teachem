import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { BRAND } from "@tutor/shared";

/** Shared, data-independent logo for public pages and all role dashboards. */
export function Logo() {
  return (
    <Link href="/" className="logo" aria-label={BRAND.name + " — на главную"}>
      <span className="logo-icon" aria-hidden="true">
        <GraduationCap size={24} />
      </span>
      <span>{BRAND.name}</span>
    </Link>
  );
}
