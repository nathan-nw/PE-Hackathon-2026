import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "@fontsource-variable/tiktok-sans";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Admin and operations dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistMono.variable} h-full scroll-smooth antialiased`}
      data-theme="light"
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
