import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "drillup",
  description: "개인용 문제은행",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
          <nav className="mx-auto flex max-w-3xl items-center gap-4 overflow-x-auto whitespace-nowrap px-4 py-3 text-sm">
            <Link href="/" className="font-bold text-sky-400">
              drillup
            </Link>
            <Link href="/study?mode=srs" className="hover:text-sky-300">
              학습
            </Link>
            <Link href="/import" className="hover:text-sky-300">
              가져오기
            </Link>
            <Link href="/questions" className="hover:text-sky-300">
              문제 관리
            </Link>
            <Link href="/stats" className="hover:text-sky-300">
              통계
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
