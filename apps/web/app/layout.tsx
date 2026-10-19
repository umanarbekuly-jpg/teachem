import type { CSSProperties } from "react";
import { BRAND } from "@tutor/shared";
import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — обучение с тьютором`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" style={{
      "--brand-logo": BRAND.colors.logo,
      "--brand-logo-foreground": BRAND.colors.logoForeground,
      "--primary": BRAND.colors.primary,
      "--primary-hover": BRAND.colors.primaryHover,
      "--ink": BRAND.colors.ink,
      "--muted": BRAND.colors.muted,
      "--line": BRAND.colors.line,
      "--bg": BRAND.colors.background,
    } as CSSProperties}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
