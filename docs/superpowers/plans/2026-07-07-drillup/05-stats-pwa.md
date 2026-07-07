# drillup 구현 계획 5/5 — 통계 · 대시보드 · PWA · 마무리

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드(오늘 복습 수 + 주제별 진척도), 통계 화면, PWA(설치 가능), 로그아웃, README를 완성해 v1을 마감한다.

**Architecture:** 통계는 `stats-service`가 srs_state를 집계해 `StatsOverviewDto`로 반환. 문제별 정답률은 기존 `GET /api/questions`의 attempts/correctCount를 재사용. PWA는 manifest 라우트 + 최소 서비스 워커.

**Tech Stack:** Next.js, Prisma, React, Web App Manifest, sharp(아이콘 생성용 devDependency)

## Global Constraints

`00-overview.md`의 Global Constraints를 반드시 먼저 읽고 준수할 것. 선행 조건: 플랜 1~4 완료.

**시각화 규칙 (대시보드/통계 공통):**
- 진척도 스택 바 세그먼트 색: 암기 완료 = `bg-emerald-600`(#059669), 학습 중 = `bg-sky-600`(#0284c7), 미학습 = 트랙 배경(`bg-slate-800`, 중립). 이 조합은 다크 서피스(#0f172a)에서 명도 밴드·CVD 분리·대비 검증을 통과한 값이므로 임의로 바꾸지 말 것.
- 세그먼트 사이 2px 간격(`gap-0.5`)으로 색 경계가 맞닿지 않게 한다.
- 색만으로 의미를 전달하지 않는다 — 바 아래에 색 점 + 텍스트 라벨(개수 포함)을 항상 병기한다.
- 숫자·라벨 텍스트는 시리즈 색이 아닌 텍스트 톤(slate 계열)을 쓴다. 스탯 타일의 큰 숫자는 `text-slate-100`.

---

### Task 1: 통계 서비스 + API

**Files:**
- Create: `src/server/stats-service.ts`
- Create: `src/app/api/stats/overview/route.ts`

**Interfaces:**
- Consumes: `prisma`, `StatsOverviewDto`/`TopicStatsDto`(플랜 3 Task 1)
- Produces:
  - `getStatsOverview(): Promise<StatsOverviewDto>`
    - 주제별: total / unlearned(`lastReviewedAt IS NULL`) / learning(리뷰됨 & interval < 21) / mastered(리뷰됨 & interval ≥ 21) / dueCount(`dueAt <= now`)
    - `dueTotal` = 전체 dueCount 합
  - REST: `GET /api/stats/overview` → `StatsOverviewDto`

- [ ] **Step 1: 통계 서비스 작성**

`src/server/stats-service.ts`:

```ts
import type { StatsOverviewDto, TopicStatsDto } from "@/lib/api-types";
import { prisma } from "./db";

/** interval이 이 값(일) 이상이면 "암기 완료"로 분류 (설계서 §6.3) */
const MASTERED_MIN_INTERVAL_DAYS = 21;

export async function getStatsOverview(): Promise<StatsOverviewDto> {
  const now = new Date();
  // 1인용 규모(수천 문제 이하)이므로 전수 조회 후 JS 집계로 충분하다
  const topics = await prisma.topic.findMany({
    orderBy: { name: "asc" },
    include: {
      questions: {
        select: {
          srsState: {
            select: { intervalDays: true, dueAt: true, lastReviewedAt: true },
          },
        },
      },
    },
  });

  const topicStats: TopicStatsDto[] = topics.map((topic) => {
    let unlearned = 0;
    let learning = 0;
    let mastered = 0;
    let dueCount = 0;
    for (const question of topic.questions) {
      const state = question.srsState;
      if (!state || state.lastReviewedAt === null) {
        unlearned += 1;
      } else if (state.intervalDays >= MASTERED_MIN_INTERVAL_DAYS) {
        mastered += 1;
      } else {
        learning += 1;
      }
      if (state && state.dueAt <= now) dueCount += 1;
    }
    return {
      id: topic.id,
      name: topic.name,
      total: topic.questions.length,
      unlearned,
      learning,
      mastered,
      dueCount,
    };
  });

  return {
    dueTotal: topicStats.reduce((sum, t) => sum + t.dueCount, 0),
    topics: topicStats,
  };
}
```

- [ ] **Step 2: Route Handler 작성**

`src/app/api/stats/overview/route.ts`:

```ts
import { handleApiError, jsonOk } from "@/server/http";
import { getStatsOverview } from "@/server/stats-service";

export async function GET() {
  try {
    return jsonOk(await getStatsOverview());
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 3: 수동 검증**

```bash
curl.exe -s -b cookies.txt http://localhost:3000/api/stats/overview
```

Expected: `{"dueTotal":n,"topics":[{"id":1,"name":"네트워크","total":2,"unlearned":...,"learning":...,"mastered":0,"dueCount":...}, ...]}` — 플랜 4 검증에서 문제를 풀었으므로 learning ≥ 1이어야 하고, unlearned + learning + mastered = total이어야 한다.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "feat: 주제별 진척도 통계 서비스 및 API"
```

---

### Task 2: 대시보드 화면

**Files:**
- Modify: `src/app/page.tsx` (임시 홈 전체 교체)

**Interfaces:**
- Consumes: `api.stats.overview`, `StatsOverviewDto`, `TopicStatsDto`
- Produces: `/` 대시보드 — 오늘 복습 수 스탯 타일 + 복습 시작 버튼, 주제별 진척도 카드(스택 바 + 복습/연습 버튼)

- [ ] **Step 1: 대시보드 작성**

`src/app/page.tsx` 전체 교체:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { StatsOverviewDto, TopicStatsDto } from "@/lib/api-types";

function ProgressBar({ topic }: { topic: TopicStatsDto }) {
  if (topic.total === 0) return null;
  const pct = (n: number) => `${(n / topic.total) * 100}%`;
  return (
    <div className="mt-2 space-y-1">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded bg-slate-800">
        {topic.mastered > 0 && (
          <div className="bg-emerald-600" style={{ width: pct(topic.mastered) }} />
        )}
        {topic.learning > 0 && (
          <div className="bg-sky-600" style={{ width: pct(topic.learning) }} />
        )}
      </div>
      <p className="text-xs text-slate-400">
        <span className="mr-2">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-600" />
          암기 완료 {topic.mastered}
        </span>
        <span className="mr-2">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-600" />
          학습 중 {topic.learning}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-700" />
          미학습 {topic.unlearned}
        </span>
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsOverviewDto | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.stats
      .overview()
      .then(setStats)
      .catch(() => setError("통계를 불러오지 못했습니다"));
  }, []);

  if (error) return <p className="text-red-300">{error}</p>;
  if (!stats) return <p className="text-slate-400">불러오는 중…</p>;

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-800 bg-slate-900 p-5 text-center">
        <p className="text-sm text-slate-400">오늘 복습할 문제</p>
        <p className="my-1 text-4xl font-bold text-slate-100">
          {stats.dueTotal}
        </p>
        {stats.dueTotal > 0 ? (
          <Link
            href="/study?mode=srs"
            className="mt-2 inline-block rounded bg-sky-600 px-6 py-3 font-semibold"
          >
            복습 시작
          </Link>
        ) : (
          <Link
            href="/study?mode=practice"
            className="mt-2 inline-block rounded bg-slate-700 px-6 py-3"
          >
            자유 연습
          </Link>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">주제별 현황</h2>
        {stats.topics.length === 0 && (
          <p className="text-slate-400">
            아직 주제가 없습니다.{" "}
            <Link href="/import" className="text-sky-400">
              가져오기
            </Link>
            에서 첫 문제를 넣어 보세요.
          </p>
        )}
        {stats.topics.map((topic) => (
          <div key={topic.id} className="rounded border border-slate-800 p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{topic.name}</span>
              <span className="text-sm text-slate-400">
                {topic.total}문제 · 오늘 {topic.dueCount}
              </span>
            </div>
            <ProgressBar topic={topic} />
            <div className="mt-3 flex gap-2 text-sm">
              <Link
                href={`/study?mode=srs&topicId=${topic.id}`}
                className="rounded bg-slate-700 px-3 py-1.5"
              >
                복습
              </Link>
              <Link
                href={`/study?mode=practice&topicId=${topic.id}`}
                className="rounded bg-slate-800 px-3 py-1.5"
              >
                연습
              </Link>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: 수동 검증**

브라우저 `/`:

1. 오늘 복습 수가 API 값과 일치, 0보다 크면 "복습 시작" / 0이면 "자유 연습" 버튼
2. 주제 카드에 스택 바(초록=암기 완료, 파랑=학습 중, 회색 트랙=미학습)와 색 점 + 개수 라벨
3. "복습"/"연습" 버튼이 해당 주제로 필터된 학습 화면으로 이동
4. 모바일 뷰(375px)에서 레이아웃 확인

- [ ] **Step 3: 커밋**

```bash
git add src/app/page.tsx
git commit -m "feat: 대시보드(오늘 복습 수, 주제별 진척도)"
```

---

### Task 3: 통계 화면

**Files:**
- Create: `src/app/stats/page.tsx`

**Interfaces:**
- Consumes: `api.stats.overview`, `api.questions.list`, `api.topics.list`
- Produces: `/stats` — 주제별 진척도 표 + 주제 선택 시 문제별 정답률 목록

- [ ] **Step 1: 통계 화면 작성**

`src/app/stats/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { QuestionListItemDto, StatsOverviewDto } from "@/lib/api-types";

export default function StatsPage() {
  const [stats, setStats] = useState<StatsOverviewDto | null>(null);
  const [topicId, setTopicId] = useState<number | "">("");
  const [questions, setQuestions] = useState<QuestionListItemDto[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.stats
      .overview()
      .then(setStats)
      .catch(() => setError("통계를 불러오지 못했습니다"));
  }, []);

  useEffect(() => {
    api.questions
      .list(topicId === "" ? undefined : topicId)
      .then(setQuestions)
      .catch(() => setError("문제 목록을 불러오지 못했습니다"));
  }, [topicId]);

  if (error) return <p className="text-red-300">{error}</p>;
  if (!stats) return <p className="text-slate-400">불러오는 중…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">통계</h1>

      <section className="space-y-2">
        <h2 className="font-semibold">주제별 진척도</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-slate-400">
                <th className="py-2 pr-3">주제</th>
                <th className="py-2 pr-3 text-right">전체</th>
                <th className="py-2 pr-3 text-right">암기 완료</th>
                <th className="py-2 pr-3 text-right">학습 중</th>
                <th className="py-2 pr-3 text-right">미학습</th>
                <th className="py-2 text-right">오늘 복습</th>
              </tr>
            </thead>
            <tbody>
              {stats.topics.map((t) => (
                <tr key={t.id} className="border-b border-slate-800">
                  <td className="py-2 pr-3">{t.name}</td>
                  <td className="py-2 pr-3 text-right">{t.total}</td>
                  <td className="py-2 pr-3 text-right">{t.mastered}</td>
                  <td className="py-2 pr-3 text-right">{t.learning}</td>
                  <td className="py-2 pr-3 text-right">{t.unlearned}</td>
                  <td className="py-2 text-right">{t.dueCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">문제별 정답률</h2>
        <select
          value={topicId}
          onChange={(e) =>
            setTopicId(e.target.value ? Number(e.target.value) : "")
          }
          className="rounded border border-slate-700 bg-slate-900 px-3 py-2"
        >
          <option value="">전체 주제</option>
          {stats.topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {questions.length === 0 ? (
          <p className="text-slate-400">문제가 없습니다.</p>
        ) : (
          <ul className="space-y-1">
            {questions.map((q) => (
              <li
                key={q.id}
                className="flex items-center gap-3 rounded border border-slate-800 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{q.preview}</span>
                <span className="shrink-0 text-slate-400">
                  {q.attempts === 0
                    ? "미풀이"
                    : `${Math.round((q.correctCount / q.attempts) * 100)}% (${q.correctCount}/${q.attempts})`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: 수동 검증**

브라우저 `/stats`: 주제별 표의 합계가 맞는지(암기 완료+학습 중+미학습=전체), 문제별 정답률이 플랜 4에서 푼 기록과 일치하는지, 주제 필터 동작 확인.

- [ ] **Step 3: 커밋**

```bash
git add src/app/stats/page.tsx
git commit -m "feat: 통계 화면(주제별 진척도 표, 문제별 정답률)"
```

---

### Task 4: PWA + 로그아웃

**Files:**
- Create: `src/app/manifest.ts`
- Create: `public/sw.js`
- Create: `src/components/SwRegister.tsx`
- Create: `src/components/LogoutButton.tsx`
- Create: `scripts/generate-icons.mjs`
- Create: `public/icons/icon-192.png`, `public/icons/icon-512.png` (스크립트로 생성)
- Modify: `src/app/layout.tsx` (SwRegister, LogoutButton, viewport 추가)

**Interfaces:**
- Consumes: `api.auth.logout`(플랜 3 Task 1)
- Produces: 설치 가능한 PWA(manifest + 서비스 워커 + 아이콘), 네비게이션의 로그아웃 버튼

- [ ] **Step 1: manifest 라우트 작성**

`src/app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "drillup",
    short_name: "drillup",
    description: "개인용 문제은행",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
```

- [ ] **Step 2: 서비스 워커 작성**

`public/sw.js` (설치 가능 요건 충족용 최소 구현 — 오프라인 캐시는 v1 범위 외):

```js
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", () => {
  // 네트워크 통과 (오프라인 지원은 v1 범위 외)
});
```

- [ ] **Step 3: 서비스 워커 등록 컴포넌트 작성**

`src/components/SwRegister.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export default function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 등록 실패는 치명적이지 않음 (설치 기능만 비활성)
      });
    }
  }, []);
  return null;
}
```

- [ ] **Step 4: 로그아웃 버튼 작성**

`src/components/LogoutButton.tsx`:

```tsx
"use client";

import { api } from "@/lib/api-client";

export default function LogoutButton() {
  async function logout() {
    await api.auth.logout();
    window.location.href = "/login";
  }
  return (
    <button onClick={logout} className="text-slate-500 hover:text-slate-300">
      로그아웃
    </button>
  );
}
```

- [ ] **Step 5: 레이아웃에 반영**

`src/app/layout.tsx` 수정 — import 추가, `viewport` export 추가, nav 오른쪽 끝에 로그아웃, body 끝에 SwRegister:

```tsx
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
  themeColor: "#0f172a",
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
            <span className="ml-auto">
              <LogoutButton />
            </span>
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
        <SwRegister />
      </body>
    </html>
  );
}
```

- [ ] **Step 6: 아이콘 생성 스크립트 작성 및 실행**

```bash
npm i -D sharp
```

`scripts/generate-icons.mjs`:

```js
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#0f172a"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
    font-family="Arial, sans-serif" font-size="280" font-weight="bold" fill="#38bdf8">D</text>
</svg>`;

mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(`public/icons/icon-${size}.png`);
  console.log(`icon-${size}.png 생성`);
}
```

실행:

```bash
node scripts/generate-icons.mjs
```

Expected: `icon-192.png 생성`, `icon-512.png 생성`, `public/icons/`에 두 파일.

- [ ] **Step 7: 수동 검증**

`npm run dev` 상태에서:

1. `curl.exe -s http://localhost:3000/manifest.webmanifest` → JSON 반환 (middleware 공개 경로라 401이 아님)
2. `curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/sw.js` → `200`
3. 브라우저(Chrome) 개발자 도구 → Application 탭 → Manifest: 이름/아이콘 표시, "Service Workers": sw.js activated
4. 주소창에 설치 아이콘(또는 메뉴의 "앱 설치")이 나타나는지 확인
5. 네비게이션의 "로그아웃" 클릭 → `/login`으로 이동, 다시 `/` 접근 시 로그인 요구

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: PWA(manifest/서비스 워커/아이콘) 및 로그아웃 버튼"
```

---

### Task 5: README + 최종 검증

**Files:**
- Modify: `README.md` (create-next-app 기본 내용 전체 교체)

**Interfaces:**
- Consumes: 전체 완성물
- Produces: 실행/운영 방법이 담긴 README, v1 완료

- [ ] **Step 1: README 작성**

`README.md` 전체 교체:

```markdown
# drillup

개인용 문제은행 PWA. LLM으로 생성한 문제(객관식/빈칸)를 주제별로 저장하고,
SRS(간격 반복)로 반복 학습한다.

설계서: `docs/superpowers/specs/2026-07-07-drillup-design.md`

## 개발 환경 실행

필요: Node 22+, Docker Desktop

    # 1. 의존성
    npm install

    # 2. 로컬 MariaDB
    docker compose up -d

    # 3. 환경변수 — .env.example을 복사해 값 채우기
    #    DATABASE_URL / APP_PASSWORD / SESSION_SECRET
    copy .env.example .env

    # 4. 마이그레이션
    npx prisma migrate dev

    # 5. 개발 서버
    npm run dev

http://localhost:3000 접속 → APP_PASSWORD로 로그인.

## 테스트

    npm test

## 프로덕션 빌드 (오라클 클라우드 인스턴스)

    npm run build
    npx prisma migrate deploy   # 운영 DB에 마이그레이션 적용
    npm start                   # PORT=3000

환경변수는 서버의 .env에 설정한다. SESSION_SECRET은 충분히 긴 랜덤 문자열,
APP_PASSWORD는 실제 사용할 비밀번호로. HTTPS 리버스 프록시 뒤에서 운영할 것
(세션 쿠키가 production에서 Secure 속성을 갖는다).

## 사용 흐름

1. **가져오기**: 주제 생성 → "프롬프트 복사" → LLM 채팅에 붙여넣고 지시 추가
   → 출력된 JSON을 붙여넣기 → 검증/미리보기 → 저장
2. **학습**: 대시보드에서 "복습 시작"(SRS) 또는 "연습"(스케줄 무관 랜덤)
3. **통계**: 주제별 진척도(미학습/학습 중/암기 완료), 문제별 정답률
```

- [ ] **Step 2: 전체 테스트/린트/빌드**

```bash
npm test
npm run lint
npm run build
```

Expected: 전부 통과.

- [ ] **Step 3: 전체 흐름 스모크 테스트**

`npm run dev` 상태에서 순서대로:

1. 로그아웃 상태에서 `/` → `/login` 리다이렉트 → 로그인
2. `/import`에서 새 주제 + 문제 가져오기 (MCQ 1, CLOZE 1 이상)
3. 대시보드에서 오늘 복습 수 증가 확인 → "복습 시작"
4. 문제 풀이(정답/오답 각 1회 이상) → 오답 재출제 → 큐 완료 화면
5. `/stats`에서 진척도/정답률 반영 확인
6. `/questions`에서 문제 수정/삭제 동작 확인

이 6단계가 모두 통과해야 v1 완료다.

- [ ] **Step 4: 커밋**

```bash
git add README.md
git commit -m "docs: README(실행/운영/사용 흐름)"
```
