import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import AppNav from "@/components/AppNav";
import LogoutButton from "@/components/LogoutButton";
import SwRegister from "@/components/SwRegister";
import "./globals.css";

const nanumSquare = localFont({
  src: [
    {
      path: "./fonts/NanumSquareL.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "./fonts/NanumSquareR.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/NanumSquareB.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "./fonts/NanumSquareEB.woff2",
      weight: "800",
      style: "normal",
    },
  ],
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
  variable: "--font-nanum-square",
});

export const metadata: Metadata = {
  title: "drillup",
  description: "개인용 문제은행",
};

export const viewport: Viewport = {
  themeColor: "#151f31",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={nanumSquare.variable}>
      <body>
        <header className="sticky top-0 z-10 border-b border-[color:var(--border)] bg-[oklch(0.18_0.025_252_/_0.9)] backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto whitespace-nowrap px-4 py-3 text-sm">
            <AppNav />
            <span className="ml-auto">
              <LogoutButton />
            </span>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">{children}</main>
        <SwRegister />
      </body>
    </html>
  );
}
