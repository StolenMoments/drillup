import type { Metadata, Viewport } from "next";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import SwRegister from "@/components/SwRegister";
import "./globals.css";

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
    <html lang="ko">
      <body>
        <header className="sticky top-0 z-10 border-b border-[color:var(--border)] bg-[oklch(0.18_0.025_252_/_0.9)] backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto whitespace-nowrap px-4 py-3 text-sm">
            <Link
              href="/"
              className="mr-3 rounded-lg px-2 py-1 font-bold text-[color:var(--brand)]"
            >
              drillup
            </Link>
            <Link href="/study?mode=srs" className="rounded-lg px-3 py-2 text-[color:var(--muted)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text)]">
              학습
            </Link>
            <Link href="/import" className="rounded-lg px-3 py-2 text-[color:var(--muted)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text)]">
              가져오기
            </Link>
            <Link href="/generate" className="rounded-lg px-3 py-2 text-[color:var(--muted)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text)]">
              AI 생성
            </Link>
            <Link href="/questions" className="rounded-lg px-3 py-2 text-[color:var(--muted)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text)]">
              문제 관리
            </Link>
            <Link href="/stats" className="rounded-lg px-3 py-2 text-[color:var(--muted)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text)]">
              통계
            </Link>
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
