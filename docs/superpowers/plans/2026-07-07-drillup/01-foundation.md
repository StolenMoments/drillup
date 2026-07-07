# drillup 구현 계획 1/5 — 프로젝트 기반 (스캐폴드 · DB · 인증)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Next.js 프로젝트 스캐폴드, MariaDB 스키마, 단일 비밀번호 인증을 갖춘 "로그인 가능한 빈 앱"을 만든다.

**Architecture:** create-next-app 기반 스캐폴드에 Prisma(MariaDB), Web Crypto 기반 HMAC 세션 토큰, Next.js middleware 인증 가드를 얹는다.

**Tech Stack:** Next.js 15+, TypeScript, Tailwind CSS, Prisma, MariaDB 11 (docker), vitest

## Global Constraints

`00-overview.md`의 Global Constraints를 반드시 먼저 읽고 준수할 것.

---

### Task 1: Next.js 스캐폴드 + vitest 설정

**Files:**
- Create: 프로젝트 루트 전체 (create-next-app이 생성)
- Create: `vitest.config.ts`
- Modify: `package.json` (test 스크립트)

**Interfaces:**
- Consumes: 없음 (최초 태스크)
- Produces: `@/*` → `src/*` 경로 별칭, `npm test` = `vitest run`, `npm run dev` 개발 서버

- [ ] **Step 1: create-next-app 실행**

프로젝트 루트(`C:\work\drillup`, 기존에 `docs/`와 `.git`만 존재)에서:

```bash
npx create-next-app@latest . --ts --eslint --tailwind --app --src-dir --import-alias "@/*" --turbopack --yes
```

Expected: `package.json`, `src/app/`, `tsconfig.json` 등이 생성된다. (`docs`는 create-next-app의 충돌 허용 목록에 있어 문제없다. 만약 대화형 프롬프트가 뜨면 위 플래그와 동일한 값을 선택한다.)

- [ ] **Step 2: 개발 서버 기동 확인**

```bash
npm run dev
```

Expected: `http://localhost:3000` 접속 시 Next.js 기본 페이지가 뜬다. 확인 후 서버 종료(Ctrl+C).

- [ ] **Step 3: 의존성 설치**

```bash
npm i zod
npm i -D vitest
```

Expected: `package.json`의 dependencies에 `zod`, devDependencies에 `vitest` 추가.

- [ ] **Step 4: vitest 설정 파일 작성**

`vitest.config.ts` (프로젝트 루트):

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

- [ ] **Step 5: package.json에 test 스크립트 추가**

`package.json`의 `scripts`에 추가:

```json
"test": "vitest run"
```

- [ ] **Step 6: 테스트 러너 동작 확인**

```bash
npm test
```

Expected: `No test files found` 류의 메시지와 함께 종료(테스트가 아직 없으므로 정상). exit code가 1이면 `vitest.config.ts`에 `test: { passWithNoTests: true }`를 추가한다.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "chore: Next.js 스캐폴드 및 vitest 설정"
```

---

### Task 2: 로컬 MariaDB + Prisma 스키마

**Files:**
- Create: `docker-compose.yml`
- Create: `prisma/schema.prisma`
- Create: `src/server/db.ts`
- Create: `.env` (커밋 금지), `.env.example`

**Interfaces:**
- Consumes: 없음
- Produces:
  - Prisma 모델 `Topic`, `Question`, `SrsState`, `ReviewLog`, enum `QuestionType('MCQ'|'CLOZE')`, `ReviewMode('SRS'|'PRACTICE')`
  - `import { prisma } from "@/server/db"` — PrismaClient 싱글턴

- [ ] **Step 1: docker-compose.yml 작성**

```yaml
services:
  db:
    image: mariadb:11
    environment:
      MARIADB_ROOT_PASSWORD: root
      MARIADB_DATABASE: drillup
      MARIADB_USER: drillup
      MARIADB_PASSWORD: drillup
    ports:
      - "3306:3306"
    volumes:
      - drillup-db:/var/lib/mysql

volumes:
  drillup-db:
```

- [ ] **Step 2: DB 기동**

```bash
docker compose up -d
docker compose ps
```

Expected: `db` 서비스 상태가 `running` (초기화에 수 초 소요될 수 있음).

- [ ] **Step 3: Prisma 설치 및 초기화**

```bash
npm i -D prisma
npm i @prisma/client
npx prisma init --datasource-provider mysql
```

Expected: `prisma/schema.prisma`와 `.env`가 생성된다.

- [ ] **Step 4: .env 및 .env.example 작성**

`.env` (create-next-app의 .gitignore가 `.env*`를 무시하는지 확인 — 무시 목록에 없으면 `.env`를 .gitignore에 추가):

```
DATABASE_URL="mysql://drillup:drillup@localhost:3306/drillup"
APP_PASSWORD="dev-password"
SESSION_SECRET="dev-secret-change-me-0123456789abcdef"
```

`.env.example` (커밋 대상):

```
DATABASE_URL="mysql://drillup:drillup@localhost:3306/drillup"
APP_PASSWORD=""
SESSION_SECRET=""
```

- [ ] **Step 5: Prisma 스키마 작성**

`prisma/schema.prisma` 전체를 다음으로 교체:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum QuestionType {
  MCQ
  CLOZE
}

enum ReviewMode {
  SRS
  PRACTICE
}

model Topic {
  id          Int        @id @default(autoincrement())
  name        String     @unique @db.VarChar(100)
  description String?    @db.Text
  createdAt   DateTime   @default(now()) @map("created_at")
  questions   Question[]

  @@map("topic")
}

model Question {
  id          Int          @id @default(autoincrement())
  topicId     Int          @map("topic_id")
  type        QuestionType
  payload     Json
  explanation String?      @db.Text
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @updatedAt @map("updated_at")
  topic       Topic        @relation(fields: [topicId], references: [id], onDelete: Cascade)
  srsState    SrsState?
  reviewLogs  ReviewLog[]

  @@map("question")
}

model SrsState {
  questionId     Int       @id @map("question_id")
  easeFactor     Decimal   @default(2.5) @map("ease_factor") @db.Decimal(3, 2)
  intervalDays   Int       @default(0) @map("interval_days")
  repetitions    Int       @default(0)
  lapses         Int       @default(0)
  dueAt          DateTime  @default(now()) @map("due_at")
  lastReviewedAt DateTime? @map("last_reviewed_at")
  question       Question  @relation(fields: [questionId], references: [id], onDelete: Cascade)

  @@map("srs_state")
}

model ReviewLog {
  id         Int        @id @default(autoincrement())
  questionId Int        @map("question_id")
  mode       ReviewMode
  isCorrect  Boolean    @map("is_correct")
  answer     Json?
  createdAt  DateTime   @default(now()) @map("created_at")
  question   Question   @relation(fields: [questionId], references: [id], onDelete: Cascade)

  @@map("review_log")
}
```

- [ ] **Step 6: 마이그레이션 실행**

```bash
npx prisma migrate dev --name init
```

Expected: `prisma/migrations/..._init/` 생성, "Your database is now in sync" 메시지, Prisma Client 생성.

- [ ] **Step 7: 테이블 생성 확인**

```bash
docker compose exec db mariadb -udrillup -pdrillup drillup -e "SHOW TABLES;"
```

Expected 출력에 `topic`, `question`, `srs_state`, `review_log`, `_prisma_migrations` 5개 테이블.

- [ ] **Step 8: PrismaClient 싱글턴 작성**

`src/server/db.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat: MariaDB docker-compose 및 Prisma 스키마(topic/question/srs_state/review_log)"
```

---

### Task 3: 세션 토큰 모듈 (TDD)

**Files:**
- Create: `src/lib/session.ts`
- Test: `src/lib/session.test.ts`

**Interfaces:**
- Consumes: 없음 (Web Crypto — Node 22와 Edge 런타임 양쪽에서 전역 `crypto` 사용 가능)
- Produces:
  - `SESSION_COOKIE: string` — 쿠키 이름 `"drillup_session"`
  - `SESSION_TTL_MS: number` — 90일(ms)
  - `createSessionToken(secret: string, now?: number): Promise<string>` — `"<만료시각ms>.<hmac-hex>"` 형식
  - `verifySessionToken(secret: string, token: string, now?: number): Promise<boolean>`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  createSessionToken,
  verifySessionToken,
} from "./session";

const SECRET = "test-secret";

describe("session token", () => {
  it("생성한 토큰은 같은 시크릿으로 검증에 성공한다", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(SECRET, token)).toBe(true);
  });

  it("다른 시크릿으로 서명된 토큰은 실패한다", async () => {
    const token = await createSessionToken("other-secret");
    expect(await verifySessionToken(SECRET, token)).toBe(false);
  });

  it("만료된 토큰은 실패한다", async () => {
    const past = Date.now() - SESSION_TTL_MS - 1000;
    const token = await createSessionToken(SECRET, past);
    expect(await verifySessionToken(SECRET, token)).toBe(false);
  });

  it("형식이 깨진 토큰은 실패한다", async () => {
    expect(await verifySessionToken(SECRET, "garbage")).toBe(false);
    expect(await verifySessionToken(SECRET, "123.abc")).toBe(false);
    expect(await verifySessionToken(SECRET, "")).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/lib/session.test.ts
```

Expected: FAIL — `Cannot find module './session'` 또는 이에 준하는 오류.

- [ ] **Step 3: 구현**

`src/lib/session.ts`:

```ts
const encoder = new TextEncoder();

export const SESSION_COOKIE = "drillup_session";
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90일

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(
  secret: string,
  now: number = Date.now(),
): Promise<string> {
  const expiresAt = now + SESSION_TTL_MS;
  return `${expiresAt}.${await hmacHex(secret, String(expiresAt))}`;
}

export async function verifySessionToken(
  secret: string,
  token: string,
  now: number = Date.now(),
): Promise<boolean> {
  const [expStr, sig] = token.split(".");
  if (!expStr || !sig) return false;
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  return (await hmacHex(secret, expStr)) === sig;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/session.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/session.ts src/lib/session.test.ts
git commit -m "feat: HMAC 세션 토큰 생성/검증 모듈"
```

---

### Task 4: 인증 API + middleware + 로그인 화면 + 레이아웃

**Files:**
- Create: `src/server/errors.ts`
- Create: `src/server/http.ts`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/middleware.ts`
- Create: `src/app/login/page.tsx`
- Modify: `src/app/layout.tsx` (전체 교체)
- Modify: `src/app/page.tsx` (전체 교체 — 임시 홈, 05에서 대시보드로 재작성)
- Modify: `src/app/globals.css` (스캐폴드 생성물 정리)

**Interfaces:**
- Consumes: `SESSION_COOKIE`, `SESSION_TTL_MS`, `createSessionToken`, `verifySessionToken` (Task 3)
- Produces:
  - `class ServiceError extends Error { code: string; status: number }` — 서비스 계층 공용 오류
  - `jsonOk(data: unknown, status?: number): NextResponse`
  - `jsonError(code: string, message: string, status: number): NextResponse`
  - `handleApiError(e: unknown): NextResponse`
  - `parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T>` — 실패 시 `ServiceError(400)`
  - `POST /api/auth/login` `{ password }` → 200 `{ ok: true }` + 세션 쿠키 / 401
  - `POST /api/auth/logout` → 200 `{ ok: true }` + 쿠키 삭제
  - 이후 모든 화면/API는 middleware로 보호됨 (미인증 시 화면은 `/login` 리다이렉트, API는 401 JSON)

- [ ] **Step 1: 서비스 오류 클래스 작성**

`src/server/errors.ts`:

```ts
export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
```

- [ ] **Step 2: HTTP 어댑터 유틸 작성**

`src/server/http.ts`:

```ts
import { NextResponse } from "next/server";
import type { z } from "zod";
import { ServiceError } from "./errors";

export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function jsonError(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function handleApiError(e: unknown): NextResponse {
  if (e instanceof ServiceError) return jsonError(e.code, e.message, e.status);
  console.error(e);
  return jsonError("INTERNAL", "서버 오류가 발생했습니다", 500);
}

export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ServiceError("BAD_REQUEST", "요청 본문이 올바른 JSON이 아닙니다", 400);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ServiceError("VALIDATION", detail, 400);
  }
  return result.data;
}
```

- [ ] **Step 3: 로그인/로그아웃 API 작성**

`src/app/api/auth/login/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
} from "@/lib/session";
import { handleApiError, jsonError, parseBody } from "@/server/http";

const bodySchema = z.object({ password: z.string() });

export async function POST(req: Request) {
  try {
    const { password } = await parseBody(req, bodySchema);
    if (password !== process.env.APP_PASSWORD) {
      return jsonError("INVALID_PASSWORD", "비밀번호가 올바르지 않습니다", 401);
    }
    const token = await createSessionToken(process.env.SESSION_SECRET!);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_TTL_MS / 1000,
      path: "/",
    });
    return res;
  } catch (e) {
    return handleApiError(e);
  }
}
```

`src/app/api/auth/logout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}
```

- [ ] **Step 4: middleware 작성**

`src/middleware.ts` (주의: `src/` 디렉터리를 쓰는 프로젝트이므로 middleware도 `src/` 바로 아래):

```ts
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/login",
  "/manifest.webmanifest",
  "/sw.js",
  "/icons",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.next();
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const authorized =
    !!token &&
    (await verifySessionToken(process.env.SESSION_SECRET ?? "", token));
  if (authorized) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다" } },
      { status: 401 },
    );
  }
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
```

- [ ] **Step 5: globals.css 정리**

`src/app/globals.css`를 다음으로 교체 (스캐폴드의 데모 스타일 제거, Tailwind 유지 — Tailwind v4 형식):

```css
@import "tailwindcss";

body {
  -webkit-tap-highlight-color: transparent;
}
```

(스캐폴드가 Tailwind v3 형식(`@tailwind base;` 등)으로 생성됐다면 그 3줄만 남기고 나머지 데모 스타일을 삭제한다.)

- [ ] **Step 6: 루트 레이아웃 작성**

`src/app/layout.tsx` 전체 교체:

```tsx
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
```

- [ ] **Step 7: 임시 홈 페이지 작성**

`src/app/page.tsx` 전체 교체 (플랜 5에서 대시보드로 재작성 예정):

```tsx
export default function HomePage() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-bold">drillup</h1>
      <p className="text-slate-400">
        대시보드는 준비 중입니다. 상단 메뉴를 이용하세요.
      </p>
    </div>
  );
}
```

- [ ] **Step 8: 로그인 페이지 작성**

`src/app/login/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setPending(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError("비밀번호가 올바르지 않습니다");
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-16 max-w-xs space-y-4">
      <h1 className="text-center text-xl font-bold">drillup 로그인</h1>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="비밀번호"
        autoFocus
        className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending || password.length === 0}
        className="w-full rounded bg-sky-600 py-2 font-semibold disabled:opacity-50"
      >
        로그인
      </button>
    </form>
  );
}
```

참고: 로그인 페이지는 api-client(플랜 3에서 작성)가 아직 없으므로 fetch를 직접 사용한다. 플랜 3 완료 후에도 이 페이지는 그대로 둔다(401 리다이렉트 루프 방지 목적의 의도된 예외).

- [ ] **Step 9: 수동 검증**

```bash
npm run dev
```

브라우저에서 확인:
1. `http://localhost:3000/` 접속 → `/login`으로 리다이렉트됨
2. 잘못된 비밀번호 입력 → "비밀번호가 올바르지 않습니다" 표시
3. `.env`의 `APP_PASSWORD` 값(`dev-password`) 입력 → `/`로 이동, 임시 홈과 상단 네비게이션 표시

API 검증 (새 터미널에서):

```bash
curl.exe -i http://localhost:3000/api/topics
```

Expected: `401` + `{"error":{"code":"UNAUTHORIZED","message":"로그인이 필요합니다"}}` (엔드포인트가 아직 없어도 middleware가 먼저 차단하므로 401이 정상)

```bash
curl.exe -i -c cookies.txt -H "Content-Type: application/json" -d "{\"password\":\"dev-password\"}" http://localhost:3000/api/auth/login
```

Expected: `200` + `Set-Cookie: drillup_session=...` 헤더 + `{"ok":true}`

- [ ] **Step 10: 빌드 및 lint 확인**

```bash
npm run lint
npm run build
```

Expected: 오류 없음. (lint 경고는 허용, 오류는 수정할 것)

- [ ] **Step 11: 커밋**

```bash
git add -A
git commit -m "feat: 단일 비밀번호 인증(로그인 API/middleware/로그인 화면) 및 기본 레이아웃"
```
