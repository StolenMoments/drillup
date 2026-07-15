"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type NavItem = {
  href: string;
  label: string;
  basePath: string;
  brand?: boolean;
};

const navItems: NavItem[] = [
  { href: "/", label: "drillup", basePath: "/", brand: true },
  { href: "/study?mode=srs", label: "학습", basePath: "/study" },
  { href: "/import", label: "가져오기", basePath: "/import" },
  { href: "/generate", label: "AI 생성", basePath: "/generate" },
  { href: "/questions", label: "문제 목록", basePath: "/questions" },
  { href: "/hardening", label: "선지 검토", basePath: "/hardening" },
  { href: "/keywords", label: "키워드", basePath: "/keywords" },
  { href: "/stats", label: "통계", basePath: "/stats" },
] as const;

function isActivePath(pathname: string, basePath: string): boolean {
  if (basePath === "/") {
    return pathname === "/";
  }

  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export default function AppNav() {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let ignore = false;
    function refresh() {
      try {
        void api.hardenJobs.pendingCount().then(({ count }) => {
          if (!ignore) setPendingCount(count);
        }).catch(() => {
          // 배지는 부가 정보 — 조회 실패는 조용히 무시한다
        });
      } catch {
        // 배지는 부가 정보 — 조회 실패는 조용히 무시한다
      }
    }
    void refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      ignore = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pathname]);

  return (
    <>
      {navItems.map((item) => {
        const active = isActivePath(pathname, item.basePath);
        const baseClass =
          "relative rounded-lg px-3 py-2 transition-colors duration-150 after:absolute after:inset-x-2 after:-bottom-[3px] after:h-px after:rounded-full after:transition-colors after:duration-150";
        const inactiveClass =
          "text-[color:var(--muted)] after:bg-transparent hover:bg-[color:var(--surface)] hover:text-[color:var(--text)]";
        const activeClass =
          "bg-[color:var(--brand-soft)] text-[color:var(--text)] after:bg-[color:var(--brand)]";
        const brandClass = item.brand ? "mr-3 font-bold" : "";

        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`${baseClass} ${active ? activeClass : inactiveClass} ${brandClass}`}
          >
            {item.label}
            {item.basePath === "/hardening" && pendingCount > 0 && (
              <span className="ml-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[color:var(--brand)] px-1.5 text-xs font-bold text-white">
                {pendingCount}
              </span>
            )}
          </a>
        );
      })}
    </>
  );
}
