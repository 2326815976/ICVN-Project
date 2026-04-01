import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: "ICVN Graph Studio",
  description: "基于 React、React Flow 与 Floating UI 的关系图编辑器 MVP。",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={geistSans.className + " antialiased"}>{children}</body>
    </html>
  );
}
