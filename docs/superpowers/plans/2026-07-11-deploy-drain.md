# 배포 드레인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배포 시 진행 중인 AI 생성 job이 끝날 때까지 기다린 뒤 서버를 재시작해, job이 고아 상태로 죽지 않게 한다.

**Architecture:** 순수 함수 모듈(`scripts/drain-lib.mjs`)과 이를 사용하는 폴링 CLI(`scripts/wait-for-generation-drain.mjs`)를 추가하고, `scripts/deploy-remote.sh`가 `npm ci` 전과 `systemctl restart` 직전에 이 CLI를 호출한다. CLI는 `.env`를 직접 파싱하고 이전 배포의 `node_modules/mariadb`로 plain SQL을 실행하므로 Prisma 생성 클라이언트나 빌드 산출물에 의존하지 않는다.

**Tech Stack:** Node.js(.mjs, top-level await), `mariadb` 드라이버(이미 dependencies에 있음), vitest, bash.

**Spec:** `docs/superpowers/specs/2026-07-11-deploy-drain-design.md`

## Global Constraints

- `master` 브랜치에서 직접 작업한다 (feature branch 금지).
- 커밋 메시지는 한국어, conventional-commit 타입 접두사는 영어 (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- Task당 커밋 1개.
- `.env` 등 시크릿 파일은 git에 넣지 않는다.
- stale 판정 규칙은 `src/server/generation/generation-service.ts`의 `getJob()`과 동일해야 한다: `2 × GENERATION_TIMEOUT_MS + 60_000ms`, `GENERATION_TIMEOUT_MS` 기본값 600,000ms.
- 드레인 최대 대기 기본 40분, `DEPLOY_DRAIN_TIMEOUT_SECONDS` 환경 변수로 조정. 초과 시 **exit 0**으로 배포를 계속 진행한다 (배포가 영원히 막히면 안 됨).
- `node_modules/mariadb`가 없으면 (최초 배포) 드레인을 건너뛰고 exit 0.

---

### Task 1: 드레인 순수 함수 모듈 (`drain-lib.mjs`)

**Files:**
- Create: `scripts/drain-lib.mjs`
- Test: `scripts/drain-lib.test.ts`

**Interfaces:**
- Consumes: 없음 (의존성 없는 순수 함수만).
- Produces (Task 2가 사용):
  - `parseEnvFile(text: string): Record<string, string>` — `.env` 본문 파싱.
  - `generationTimeoutMs(env): number` — env 객체에서 타임아웃 읽기 (기본 600,000).
  - `orphanWindowMs(env): number` — `2 × generationTimeoutMs(env) + 60_000`.
  - `staleCutoff(env, now?: Date): Date` — `now - orphanWindowMs(env)`.
  - `drainTimeoutMs(env): number` — 최대 대기 ms (기본 2,400,000).
  - `connectionConfig(env): { host, port, user, password, database }` — mariadb 접속 설정. `DATABASE_URL` 우선(단, `${` 포함 시 무시), 없으면 `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`, 둘 다 없으면 throw.
  - `ACTIVE_JOBS_SQL: string` — placeholder 2개(cutoff, cutoff)를 받는 카운트 쿼리.
  - `POLL_INTERVAL_MS: number` — 10,000.

- [x] **Step 1: 실패하는 테스트 작성**

`scripts/drain-lib.test.ts` 생성:

```ts
import { describe, expect, it } from "vitest";
import {
  ACTIVE_JOBS_SQL,
  connectionConfig,
  drainTimeoutMs,
  generationTimeoutMs,
  orphanWindowMs,
  parseEnvFile,
  staleCutoff,
} from "./drain-lib.mjs";

describe("parseEnvFile", () => {
  it("KEY=VALUE 줄을 파싱한다", () => {
    expect(parseEnvFile("DB_HOST=localhost\nDB_PORT=3307")).toEqual({
      DB_HOST: "localhost",
      DB_PORT: "3307",
    });
  });

  it("주석과 빈 줄을 무시한다", () => {
    expect(parseEnvFile("# comment\n\nDB_NAME=drillup\n")).toEqual({
      DB_NAME: "drillup",
    });
  });

  it("양쪽 따옴표를 제거한다", () => {
    expect(parseEnvFile("A=\"hello world\"\nB='single'")).toEqual({
      A: "hello world",
      B: "single",
    });
  });

  it("값 안의 =는 그대로 둔다", () => {
    expect(parseEnvFile("URL=mysql://u:p@h/db?a=1")).toEqual({
      URL: "mysql://u:p@h/db?a=1",
    });
  });
});

describe("generationTimeoutMs / orphanWindowMs", () => {
  it("기본값은 10분 / 2배+60초", () => {
    expect(generationTimeoutMs({})).toBe(600_000);
    expect(orphanWindowMs({})).toBe(1_260_000);
  });

  it("GENERATION_TIMEOUT_MS를 반영한다", () => {
    expect(orphanWindowMs({ GENERATION_TIMEOUT_MS: "60000" })).toBe(180_000);
  });

  it("잘못된 값이면 기본값을 쓴다", () => {
    expect(orphanWindowMs({ GENERATION_TIMEOUT_MS: "abc" })).toBe(1_260_000);
    expect(orphanWindowMs({ GENERATION_TIMEOUT_MS: "-5" })).toBe(1_260_000);
  });
});

describe("staleCutoff", () => {
  it("now에서 orphan window만큼 뺀 시각을 돌려준다", () => {
    const now = new Date("2026-07-11T12:00:00Z");
    expect(staleCutoff({}, now).getTime()).toBe(now.getTime() - 1_260_000);
  });
});

describe("drainTimeoutMs", () => {
  it("기본값은 40분", () => {
    expect(drainTimeoutMs({})).toBe(2_400_000);
  });

  it("DEPLOY_DRAIN_TIMEOUT_SECONDS를 반영한다", () => {
    expect(drainTimeoutMs({ DEPLOY_DRAIN_TIMEOUT_SECONDS: "60" })).toBe(60_000);
    expect(drainTimeoutMs({ DEPLOY_DRAIN_TIMEOUT_SECONDS: "0" })).toBe(0);
  });

  it("잘못된 값이면 기본값을 쓴다", () => {
    expect(drainTimeoutMs({ DEPLOY_DRAIN_TIMEOUT_SECONDS: "abc" })).toBe(2_400_000);
  });
});

describe("connectionConfig", () => {
  it("DATABASE_URL을 우선 사용한다", () => {
    expect(
      connectionConfig({ DATABASE_URL: "mysql://user:pw@dbhost:3307/drillup" }),
    ).toEqual({
      host: "dbhost",
      port: 3307,
      user: "user",
      password: "pw",
      database: "drillup",
    });
  });

  it("포트가 없으면 3306을 쓴다", () => {
    expect(connectionConfig({ DATABASE_URL: "mysql://u:p@h/db" }).port).toBe(3306);
  });

  it("${가 포함된 DATABASE_URL은 무시하고 개별 변수를 쓴다", () => {
    expect(
      connectionConfig({
        DATABASE_URL: "mysql://${DB_USER}@h/db",
        DB_HOST: "localhost",
        DB_USER: "u",
        DB_PASSWORD: "p",
        DB_NAME: "drillup",
      }),
    ).toEqual({
      host: "localhost",
      port: 3306,
      user: "u",
      password: "p",
      database: "drillup",
    });
  });

  it("접속 정보가 없으면 예외를 던진다", () => {
    expect(() => connectionConfig({})).toThrow();
  });
});

describe("ACTIVE_JOBS_SQL", () => {
  it("두 테이블의 활성 상태를 세고 placeholder가 2개다", () => {
    expect(ACTIVE_JOBS_SQL).toContain("generation_job");
    expect(ACTIVE_JOBS_SQL).toContain("generation_item_revision");
    expect(ACTIVE_JOBS_SQL).toContain("'RUNNING'");
    expect(ACTIVE_JOBS_SQL).toContain("'VERIFYING'");
    expect(ACTIVE_JOBS_SQL.split("?").length - 1).toBe(2);
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npx vitest run scripts/drain-lib.test.ts`
Expected: FAIL — `drain-lib.mjs` 모듈이 없어 import 에러.

- [x] **Step 3: 최소 구현 작성**

`scripts/drain-lib.mjs` 생성:

```js
// 배포 드레인용 순수 함수 모음.
// 주의: 이전 배포의 node_modules로 실행되므로 외부 패키지를 import하지 않는다.

export const DEFAULT_GENERATION_TIMEOUT_MS = 10 * 60 * 1000;
export const ORPHAN_GRACE_MS = 60_000;
export const DEFAULT_DRAIN_TIMEOUT_SECONDS = 40 * 60;
export const POLL_INTERVAL_MS = 10_000;

export function parseEnvFile(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// src/server/generation/run-engine.ts의 generationTimeoutMs와 같은 규칙.
export function generationTimeoutMs(env) {
  const raw = Number(env.GENERATION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GENERATION_TIMEOUT_MS;
}

// generation-service.ts getJob()의 고아 판정 window와 같은 규칙.
export function orphanWindowMs(env) {
  return 2 * generationTimeoutMs(env) + ORPHAN_GRACE_MS;
}

export function staleCutoff(env, now = new Date()) {
  return new Date(now.getTime() - orphanWindowMs(env));
}

export function drainTimeoutMs(env) {
  const raw = Number(env.DEPLOY_DRAIN_TIMEOUT_SECONDS);
  const seconds =
    Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DRAIN_TIMEOUT_SECONDS;
  return seconds * 1000;
}

// src/server/db.ts createAdapter()와 같은 우선순위: DATABASE_URL 우선, "${" 포함 시 무시.
export function connectionConfig(env) {
  const directUrl = env.DATABASE_URL;
  if (directUrl && !directUrl.includes("${")) {
    const url = new URL(directUrl);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ""),
    };
  }
  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = env;
  if (!DB_HOST || !DB_USER || DB_PASSWORD === undefined || !DB_NAME) {
    throw new Error(
      "DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME is required",
    );
  }
  return {
    host: DB_HOST,
    port: Number(env.DB_PORT ?? "3306"),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  };
}

// 고아 window 안의 활성 job만 센다. placeholder는 (cutoff, cutoff) 순서.
export const ACTIVE_JOBS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM generation_job
      WHERE status IN ('RUNNING', 'VERIFYING') AND created_at > ?)
    +
    (SELECT COUNT(*) FROM generation_item_revision
      WHERE status = 'RUNNING' AND created_at > ?)
    AS activeCount
`;
```

- [x] **Step 4: 테스트 통과 확인**

Run: `npx vitest run scripts/drain-lib.test.ts`
Expected: PASS (전체 케이스 녹색).

- [x] **Step 5: 전체 테스트·린트 확인**

Run: `npm test` 그리고 `npm run lint`
Expected: 둘 다 성공 (기존 테스트 회귀 없음).

- [x] **Step 6: 커밋**

```bash
git add scripts/drain-lib.mjs scripts/drain-lib.test.ts
git commit -m "feat: 배포 드레인용 활성 job 판정 함수 추가"
```

---

### Task 2: 드레인 CLI 스크립트 (`wait-for-generation-drain.mjs`)

**Files:**
- Create: `scripts/wait-for-generation-drain.mjs`

**Interfaces:**
- Consumes (Task 1): `parseEnvFile`, `connectionConfig`, `drainTimeoutMs`, `staleCutoff`, `ACTIVE_JOBS_SQL`, `POLL_INTERVAL_MS` — 모두 `./drain-lib.mjs`에서 import.
- Produces (Task 3이 사용): `node scripts/wait-for-generation-drain.mjs` 로 실행 가능한 CLI. 활성 job이 없거나, 최대 대기 초과이거나, `node_modules/mariadb`가 없으면 exit 0. DB 접속 실패 등 예기치 못한 오류는 비정상 종료(exit ≠ 0)로 전파해 배포를 중단시킨다.

- [x] **Step 1: CLI 스크립트 작성**

`scripts/wait-for-generation-drain.mjs` 생성:

```js
#!/usr/bin/env node
// 배포 전 활성 AI 생성 job이 끝날 때까지 대기한다.
// 이전 배포의 node_modules/mariadb로 실행되므로 빌드 산출물에 의존하지 않는다.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ACTIVE_JOBS_SQL,
  POLL_INTERVAL_MS,
  connectionConfig,
  drainTimeoutMs,
  parseEnvFile,
  staleCutoff,
} from "./drain-lib.mjs";

const root = process.cwd();

if (!existsSync(path.join(root, "node_modules", "mariadb"))) {
  console.log("[drain] node_modules/mariadb가 없어 드레인을 건너뜁니다 (최초 배포).");
  process.exit(0);
}

const envPath = path.join(root, ".env");
const fileEnv = existsSync(envPath)
  ? parseEnvFile(readFileSync(envPath, "utf-8"))
  : {};
const env = { ...fileEnv, ...process.env };

const { default: mariadb } = await import("mariadb");
const conn = await mariadb.createConnection(connectionConfig(env));
const deadline = Date.now() + drainTimeoutMs(env);

try {
  for (;;) {
    const rows = await conn.query(ACTIVE_JOBS_SQL, [staleCutoff(env), staleCutoff(env)]);
    const active = Number(rows[0]?.activeCount ?? 0);
    if (active === 0) {
      console.log("[drain] 활성 생성 job이 없습니다. 배포를 진행합니다.");
      break;
    }
    if (Date.now() >= deadline) {
      console.warn(
        `[drain] 경고: 활성 job ${active}개가 남았지만 최대 대기 시간을 초과해 배포를 계속합니다.`,
      );
      break;
    }
    console.log(`[drain] 활성 job ${active}개 — ${POLL_INTERVAL_MS / 1000}초 후 재확인합니다.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
} finally {
  await conn.end();
}
```

주의: `mariadb`는 최상단 static import가 아니라 존재 확인 **후** dynamic import여야 한다 (없으면 skip이 목적이므로).

- [x] **Step 2: 로컬 스모크 테스트**

로컬에 `.env`와 DB가 있는 상태에서 실행:

Run: `node scripts/wait-for-generation-drain.mjs`
Expected: `[drain] 활성 생성 job이 없습니다. 배포를 진행합니다.` 출력 후 exit 0.
(로컬에 진행 중 job이 있으면 `활성 job N개` 폴링 로그가 나오는 것도 정상. 로컬 DB가 없으면 접속 오류로 비정상 종료하는 것이 의도된 동작이므로, 그 경우 이 스모크 테스트는 건너뛴다.)

폴링 동작을 빠르게 확인하려면:

Run: `$env:DEPLOY_DRAIN_TIMEOUT_SECONDS = "0"; node scripts/wait-for-generation-drain.mjs`
Expected: 활성 job이 있어도 즉시 경고 후 exit 0.

- [x] **Step 3: 린트 확인**

Run: `npm run lint`
Expected: 성공.

- [x] **Step 4: 커밋**

```bash
git add scripts/wait-for-generation-drain.mjs
git commit -m "feat: 배포 전 활성 job 대기 드레인 스크립트 추가"
```

---

### Task 3: `deploy-remote.sh`에 드레인 연동

**Files:**
- Modify: `scripts/deploy-remote.sh` (현재 22행 `fi`와 24행 `npm ci` 사이, 그리고 39행 `systemctl --user restart drillup` 직전)

**Interfaces:**
- Consumes (Task 2): `node scripts/wait-for-generation-drain.mjs` (exit 0 = 진행, exit ≠ 0 = 배포 중단).
- Produces: 없음 (최종 사용자 단계).

- [x] **Step 1: 드레인 호출 2곳 추가**

`scripts/deploy-remote.sh`에서 `.env` 키 검증 블록(`if [ "$missing_env" -ne 0 ]; then ... fi`) **다음, `npm ci` 이전**에 추가:

```bash
# 진행 중인 AI 생성 job이 끝날 때까지 대기한 뒤 빌드를 시작한다.
# (빌드가 .next를 덮어쓰면 구서버가 청크를 못 찾을 수 있어 대기를 빌드 앞에 둔다)
node scripts/wait-for-generation-drain.mjs
```

그리고 `systemctl --user restart drillup` **직전**에 추가:

```bash
# 빌드하는 동안 새로 시작된 job이 있으면 재시작 전에 한 번 더 대기한다.
node scripts/wait-for-generation-drain.mjs
```

수정 후 해당 구간 전체 모습:

```bash
if [ "$missing_env" -ne 0 ]; then
  exit 1
fi

# 진행 중인 AI 생성 job이 끝날 때까지 대기한 뒤 빌드를 시작한다.
# (빌드가 .next를 덮어쓰면 구서버가 청크를 못 찾을 수 있어 대기를 빌드 앞에 둔다)
node scripts/wait-for-generation-drain.mjs

NODE_ENV=development NPM_CONFIG_PRODUCTION=false npm ci --include=dev --ignore-scripts
./node_modules/.bin/prisma generate
./node_modules/.bin/prisma migrate deploy
npm run build
```

```bash
systemctl --user daemon-reload
systemctl --user enable drillup

# 빌드하는 동안 새로 시작된 job이 있으면 재시작 전에 한 번 더 대기한다.
node scripts/wait-for-generation-drain.mjs

systemctl --user restart drillup
systemctl --user status drillup --no-pager
```

- [x] **Step 2: 셸 문법 검증**

Run (Bash tool): `bash -n scripts/deploy-remote.sh`
Expected: 출력 없음 (문법 오류 없음).

- [x] **Step 3: 전체 테스트 확인**

Run: `npm test`
Expected: PASS.

- [x] **Step 4: 커밋**

```bash
git add scripts/deploy-remote.sh
git commit -m "feat: 배포 스크립트에 활성 job 드레인 대기 추가"
```

- [ ] **Step 5: 배포로 실제 동작 확인 (수동)**

master에 push하면 GitHub Actions `Deploy` 워크플로가 실행된다. 배포 로그의 "Run remote deploy script" 단계에서 `[drain]` 로그가 출력되는지 확인한다. 활성 job이 없을 때는 즉시 통과해야 한다.
