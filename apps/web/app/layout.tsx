import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Точка роста — обучение с тьютором",
    template: "%s · Точка роста",
  },
  description:
    "Найдите своего тьютора, учитесь в удобном темпе и следите за прогрессом.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
