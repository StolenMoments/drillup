# drillup 구현 계획 — 개요 및 실행 안내

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설계서(`docs/superpowers/specs/2026-07-07-drillup-design.md`)에 정의된 개인용 문제은행 PWA를 구현한다.

**Architecture:** Next.js(App Router) 단일 코드베이스. 도메인 로직은 `src/core/`(순수 TS), DB 접근은 `src/server/`(서비스 계층), Route Handler는 얇은 어댑터. 프론트는 `src/lib/api-client.ts` 단일 경유. 추후 REST 백엔드 분리를 대비한 구조.

**Tech Stack:** Next.js 15+ (App Router, TypeScript), React, Tailwind CSS, MariaDB 11, Prisma, zod, vitest

## 계획 문서 목록 (실행 순서 — 반드시 순서대로)

| # | 문서 | 내용 | 완료 시 상태 |
|---|---|---|---|
| 1 | `01-foundation.md` | 스캐폴드, DB 스키마, 세션/인증, 레이아웃 | 로그인 가능한 빈 앱 |
| 2 | `02-domain-core.md` | core 모듈: 채점, SRS 엔진, import 검증, 프롬프트 템플릿 | 테스트 통과하는 도메인 로직 |
| 3 | `03-content-management.md` | API 클라이언트, 주제 CRUD, 가져오기, 문제 관리 | 문제를 넣고 관리 가능 |
| 4 | `04-study.md` | 학습 큐, 리뷰 제출, 학습 화면(MCQ/CLOZE) | SRS/연습 학습 가능 |
| 5 | `05-stats-pwa.md` | 통계, 대시보드, PWA, README | v1 완성 |

각 문서는 그 자체로 동작·검증 가능한 소프트웨어를 산출한다. 문서 내 태스크도 순서대로 실행한다.

## Global Constraints (모든 태스크에 암묵 적용)

- **Node 22+, npm 사용.** 패키지 매니저 변경 금지.
- **TypeScript strict 모드** (create-next-app 기본값 유지). `any` 사용 금지 — payload 캐스팅은 `as unknown as T` 형태만 허용.
- **`src/core/`는 순수 TS**: Next.js, Prisma, Node 전용 API를 import하지 않는다. (zod는 허용 — 브라우저/서버 양쪽에서 사용)
- **`src/server/`는 Next.js를 import하지 않는다** (Prisma, core만 사용). 단 `src/server/http.ts`는 Route Handler 어댑터 유틸이므로 예외적으로 `next/server` 허용.
- **Route Handler는 얇게**: 요청 파싱(zod) → 서비스 호출 → JSON 응답. 비즈니스 로직 금지.
- **화면 코드는 fetch 직접 호출 금지** — `src/lib/api-client.ts`의 `api` 객체만 사용. (유일한 예외: `/login` 페이지 — 401 리다이렉트 루프 방지 목적, 플랜 1 Task 4 참고)
- **서버 컴포넌트에서 `src/server/` 서비스 직접 호출 금지** — 데이터가 필요한 페이지는 클라이언트 컴포넌트 + api-client로 구현.
- **문제 payload의 키는 snake_case** (`answer_index`, `blanks`, `distractors`) — LLM import JSON과 DB 저장 형식을 동일하게 유지.
- **UI 문구는 한국어.**
- **API 오류 응답 형식 통일**: `{ "error": { "code": string, "message": string } }`
- **커밋은 conventional commits** (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). 태스크마다 커밋.
- **테스트는 vitest**, 테스트 파일은 대상 파일 옆에 `*.test.ts`.
- **환경변수**: `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`(사용자가 직접 입력) + 이를 조합한 `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, (선택) `NEXT_PUBLIC_API_BASE_URL`. `.env`는 커밋 금지, `.env.example`만 커밋.
- **DB 접속 정보는 `.env`가 유일한 진실의 원천** — 코드·문서 어디에도 특정 호스트/계정을 하드코딩하지 않는다. DB 확인이 필요한 검증 절차는 `npx prisma studio` 또는 `npx prisma db execute`를 사용한다(특정 DB 배포 형태를 가정하는 명령 금지).

## 설계서 대비 의도적 단순화 (버그 아님)

- `GET /api/questions`의 `page` 파라미터는 구현하지 않는다 (1인용 규모, 필요 시 추후 추가).
- 진척도 분류에서 "미학습"은 `srs_state.last_reviewed_at IS NULL`로 판정한다 (연습 모드 이력은 SRS 상태를 건드리지 않으므로 SRS 기준 미학습으로 본다).
- `ease_factor`는 스키마상 DECIMAL(3,2)이며 Prisma가 `Decimal` 객체로 반환하므로, 서비스에서 core로 넘길 때 반드시 `Number(...)`로 변환한다.
- 가져오기 화면의 미리보기는 읽기 전용 요약 렌더링이다 (설계서의 "풀이 화면과 같은 렌더링"의 단순화 — 정답 표시 포함이 목적에 더 맞음).
- 서비스 계층(`src/server/`)의 자동 테스트는 두지 않는다 — 상태 전이·채점 로직이 전부 core에 있어 단위 테스트로 커버되고, DB 글루는 각 플랜의 curl 기반 수동 검증 절차로 확인한다.

## 전체 파일 구조 지도 (완성 시점)

```
drillup/
  docker-compose.yml            # (선택) 쓸 MariaDB가 없을 때만 — 접속 정보의 원천은 항상 .env
  prisma/schema.prisma
  public/sw.js                  # PWA 서비스 워커
  public/icons/icon-{192,512}.png
  scripts/generate-icons.mjs
  src/
    middleware.ts               # 인증 가드 (src/ 디렉터리 사용 시 이 위치)
    core/                       # 순수 도메인 로직 (프레임워크 무관)
      types.ts                  # McqPayload, ClozePayload 등
      grading.ts                # gradeMcq, gradeCloze
      srs.ts                    # applyAnswer (SM-2 단순화)
      import-schema.ts          # zod 스키마, parseImportJson
      prompt-template.ts        # buildGenerationPrompt
      random.ts                 # shuffle (Fisher–Yates)
    server/                     # 서비스 계층 (Prisma + core)
      db.ts                     # PrismaClient 싱글턴
      errors.ts                 # ServiceError
      http.ts                   # jsonOk/jsonError/handleApiError/parseBody
      topic-service.ts
      question-service.ts
      import-service.ts
      study-service.ts          # getStudyQueue, submitReview
      stats-service.ts
    lib/
      session.ts                # HMAC 세션 토큰 (Web Crypto — Edge/Node 겸용)
      api-types.ts              # 프론트-백 공유 DTO 타입 (전체 정의)
      api-client.ts             # typed fetch 클라이언트 (단일 통로)
    components/
      McqCard.tsx  ClozeCard.tsx  ResultPanel.tsx  SwRegister.tsx
    app/
      layout.tsx  page.tsx(대시보드)  globals.css  manifest.ts
      login/page.tsx
      study/page.tsx
      import/page.tsx
      questions/page.tsx  questions/[id]/page.tsx
      stats/page.tsx
      api/auth/login/route.ts  api/auth/logout/route.ts
      api/topics/route.ts  api/topics/[id]/route.ts
      api/questions/route.ts  api/questions/[id]/route.ts
      api/import/route.ts
      api/study/queue/route.ts
      api/reviews/route.ts
      api/stats/overview/route.ts
```

## 사전 준비 (실행 환경)

- 접속 가능한 MariaDB 서버와 그 접속 정보(IP/ID/PW/DB명) — 로컬 설치·원격 인스턴스·도커 등 무엇이든 가능. 사용자가 `.env`에 직접 입력한다(플랜 1 Task 2). 쓸 DB가 없을 때만 선택적으로 docker-compose 사용(이 경우 Docker Desktop 필요).
- Node 22+ / npm 확인: `node -v`, `npm -v`
- 검증 명령의 `curl`은 Windows PowerShell에서 `curl.exe`를 의미한다 (별칭 `curl`은 Invoke-WebRequest이므로 반드시 `curl.exe`로 실행).

## 핵심 도메인 규칙 요약 (설계서 §6 — 구현 시 진실의 원천)

- **SRS 정답**: `repetitions += 1`; interval은 1회차 1일 → 2회차 3일 → 이후 `round(interval × ease_factor)`; EF 유지; `due_at = now + interval일`.
- **SRS 오답**: `repetitions = 0`, `interval = 0`, `EF = max(1.3, EF − 0.2)`, `lapses += 1`, `due_at 변경 없음`(과거 그대로 → 세션 내 재출제 대상 유지).
- **연습(PRACTICE) 모드**: SRS 상태 변경 없음, `review_log`만 기록.
- **CLOZE 정답 판정**: 모든 빈칸이 정답과 일치(양끝 공백 trim 후 비교)해야 정답.
- **진척도**: 미학습 = `last_reviewed_at IS NULL` / 학습 중 = 리뷰됨 & interval < 21 / 암기 완료 = 리뷰됨 & interval ≥ 21.
- **출제 응답에 정답 미포함** — 채점은 서버(`POST /api/reviews`)에서.
