import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "问间 · 问题纸片盒",
  description: "让问题有位置，让想法有联系，保留每一次观点的变化。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
