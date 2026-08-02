import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BotBond — Bonded Agent Access",
  description:
    "Unknown agents earn scoped API access by declaring intent and locking a refundable on-chain bond.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
