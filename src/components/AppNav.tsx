"use client";

import { usePathname } from "next/navigation";

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
          </a>
        );
      })}
    </>
  );
}
