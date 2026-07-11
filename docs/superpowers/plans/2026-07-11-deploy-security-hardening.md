# 배포 보안 하드닝 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도메인 + HTTPS + nginx + Oracle Cloud 운영 배포를 앞두고, 로그인 브루트포스 방어(전역 락아웃)와 HTTPS 관련 웹 보안 설정(secure 쿠키 · 보안 응답 헤더 · nginx 프록시 헤더 정규화)을 추가한다.

**Architecture:** 앱은 systemd user 유닛(`deploy/drillup.service`)이 `next start`를 포트 3000에서 단일 프로세스로 구동한다. nginx가 443에서 TLS를 종단하고 `http://127.0.0.1:3000`으로 프록시한다. 단일 프로세스라 rate limit은 외부 저장소 없이 **인메모리 모듈 상태**로 충분하다. 보안 응답 헤더는 `next.config.ts`의 `headers()`로, 프록시 헤더 정규화는 nginx 설정 파일로 처리한다.

**Tech Stack:** Next.js 16.2.10 (App Router, Route Handlers), TypeScript, Vitest, nginx.

## Global Constraints

- 작업은 `master` 브랜치에서 직접 한다. 별도 feature 브랜치·worktree를 만들지 않는다.
- 커밋 메시지는 한국어로 쓴다. conventional-commit 타입 접두사(`feat:`, `fix:`, `test:`, `chore:`, `docs:`)는 영어로 유지한다. **태스크당 커밋 1개.**
- 이 Next.js는 학습 데이터의 Next.js와 다를 수 있다. 코드 작성 전 `node_modules/next/dist/docs/` 의 관련 문서를 반드시 확인한다. (본 계획의 헤더 설정은 `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md` 로 검증됨.)
- 사용자 대상 문구의 이모지(✅/❌/🎉 등)는 유지한다.
- `.env` 등 비밀 값이 담긴 파일은 git에 넣지 않는다.
- 테스트 러너: `npm test` (vitest run). 단일 파일 실행: `npx vitest run <경로>`.

---

## Task 1: 로그인 전역 락아웃 (브루트포스 방어)

로그인 실패가 연속 N회 누적되면 M분간 **전역으로** 로그인 시도를 잠근다. IP 구분 없이 전역이라 nginx의 `X-Forwarded-For` 신뢰가 불필요하다(Task 4와 독립). 성공하면 카운터를 초기화한다. 앱이 단일 프로세스이므로 모듈 레벨 인메모리 상태로 구현한다. 프로세스 재시작 시 상태가 초기화되는 것은 허용한다(브루트포스 방어에 영향 없음).

**정책 값 (상수로 고정):**
- `MAX_FAILURES = 5` — 연속 실패 허용 횟수
- `LOCKOUT_MS = 15 * 60 * 1000` — 잠금 지속 시간(15분)

**Files:**
- Create: `src/server/login-throttle.ts`
- Create: `src/server/login-throttle.test.ts`
- Modify: `src/app/api/auth/login/route.ts`

**Interfaces:**
- Produces (`src/server/login-throttle.ts`):
  - `export function checkLockout(now?: number): { locked: boolean; retryAfterMs: number }` — 현재 잠금 상태를 반환. `locked`이 true면 `retryAfterMs`는 남은 잠금 시간(ms).
  - `export function recordFailure(now?: number): void` — 실패 1회를 기록. 임계치 도달 시 잠금 시각을 설정한다.
  - `export function recordSuccess(): void` — 실패 카운터와 잠금 상태를 초기화한다.
  - `export function resetThrottleForTest(): void` — 테스트 격리용. 모듈 상태를 초기화한다.
  - `export const MAX_FAILURES: number`, `export const LOCKOUT_MS: number`
- Consumes (`route.ts`): 위 함수들. 기존 `parseBody`, `jsonError`, `handleApiError`, `createSessionToken`, 세션 쿠키 상수는 그대로 사용.

- [ ] **Step 1: 락아웃 로직 실패 테스트 작성**

Create `src/server/login-throttle.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCKOUT_MS,
  MAX_FAILURES,
  checkLockout,
  recordFailure,
  recordSuccess,
  resetThrottleForTest,
} from "./login-throttle";

describe("login-throttle", () => {
  beforeEach(() => {
    resetThrottleForTest();
  });

  it("초기 상태는 잠기지 않음", () => {
    expect(checkLockout(0).locked).toBe(false);
  });

  it("MAX_FAILURES 미만 실패는 잠그지 않음", () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(0);
    expect(checkLockout(0).locked).toBe(false);
  });

  it("MAX_FAILURES 연속 실패 시 잠김", () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure(0);
    const state = checkLockout(0);
    expect(state.locked).toBe(true);
    expect(state.retryAfterMs).toBe(LOCKOUT_MS);
  });

  it("잠금 시간이 지나면 자동 해제", () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure(0);
    expect(checkLockout(LOCKOUT_MS).locked).toBe(false);
  });

  it("성공 시 실패 카운터가 초기화됨", () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(0);
    recordSuccess();
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(0);
    expect(checkLockout(0).locked).toBe(false);
  });

  it("잠금 중 남은 시간을 정확히 반환", () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure(1000);
    expect(checkLockout(1000 + 60_000).retryAfterMs).toBe(LOCKOUT_MS - 60_000);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/server/login-throttle.test.ts`
Expected: FAIL — `login-throttle` 모듈을 찾을 수 없음.

- [ ] **Step 3: 락아웃 로직 구현**

Create `src/server/login-throttle.ts`:

```ts
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

let failureCount = 0;
let lockedUntil = 0;

export function checkLockout(now: number = Date.now()): {
  locked: boolean;
  retryAfterMs: number;
} {
  if (lockedUntil > now) {
    return { locked: true, retryAfterMs: lockedUntil - now };
  }
  return { locked: false, retryAfterMs: 0 };
}

export function recordFailure(now: number = Date.now()): void {
  failureCount += 1;
  if (failureCount >= MAX_FAILURES) {
    lockedUntil = now + LOCKOUT_MS;
  }
}

export function recordSuccess(): void {
  failureCount = 0;
  lockedUntil = 0;
}

export function resetThrottleForTest(): void {
  failureCount = 0;
  lockedUntil = 0;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/server/login-throttle.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: 로그인 라우트에 락아웃 연동**

Modify `src/app/api/auth/login/route.ts` — 잠금 검사를 body 파싱 전에 두고, 비밀번호 오류 시 `recordFailure`, 성공 시 `recordSuccess`를 호출한다. 잠김 상태면 429로 응답한다.

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
} from "@/lib/session";
import {
  checkLockout,
  recordFailure,
  recordSuccess,
} from "@/server/login-throttle";
import { handleApiError, jsonError, parseBody } from "@/server/http";

const bodySchema = z.object({ password: z.string() });

export async function POST(req: Request) {
  try {
    const lockout = checkLockout();
    if (lockout.locked) {
      const retryAfterSec = Math.ceil(lockout.retryAfterMs / 1000);
      const res = jsonError(
        "TOO_MANY_ATTEMPTS",
        "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요 🔒",
        429,
      );
      res.headers.set("Retry-After", String(retryAfterSec));
      return res;
    }

    const { password } = await parseBody(req, bodySchema);
    if (password !== process.env.APP_PASSWORD) {
      recordFailure();
      return jsonError("INVALID_PASSWORD", "비밀번호가 올바르지 않습니다", 401);
    }

    recordSuccess();
    const token = await createSessionToken(process.env.SESSION_SECRET!);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_MS / 1000,
      path: "/",
    });
    return res;
  } catch (e) {
    return handleApiError(e);
  }
}
```

> 참고: 위 코드에는 Task 2의 `secure: process.env.NODE_ENV === "production"` 도 이미 포함되어 있다. 이 태스크에서 함께 넣고 커밋해도 되고, Task 2에서 따로 확인만 해도 된다. 중복 편집을 피하려면 여기서 함께 반영한다.

**확인됨:** `src/server/http.ts:9-15` 의 `jsonError`는 `NextResponse`를 반환하므로 위처럼 `res.headers.set("Retry-After", ...)` 를 그대로 쓸 수 있다. 추가 분기 불필요.

- [ ] **Step 6: 전체 테스트 + 빌드 확인**

Run: `npm test`
Expected: PASS (기존 테스트 + 신규 login-throttle 테스트 모두 통과).

Run: `npm run lint`
Expected: 에러 없음.

- [ ] **Step 7: 커밋**

```bash
git add src/server/login-throttle.ts src/server/login-throttle.test.ts src/app/api/auth/login/route.ts
git commit -m "feat: 로그인 전역 락아웃으로 브루트포스 방어 추가"
```

---

## Task 2: 세션 쿠키 secure 플래그

HTTPS 운영 환경에서 세션 쿠키가 평문(HTTP)으로 전송되지 않도록 `secure` 속성을 켠다. 단, 로컬 개발(`http://localhost`)에서는 브라우저가 secure 쿠키를 저장하지 않아 로그인이 깨지므로 **프로덕션에서만** 켠다(`process.env.NODE_ENV === "production"`).

**Files:**
- Modify: `src/app/api/auth/login/route.ts:20-25` (Task 1에서 이미 반영했다면 확인만)

**Interfaces:** 없음(쿠키 옵션 변경만).

- [ ] **Step 1: secure 플래그 반영 확인/추가**

`src/app/api/auth/login/route.ts`의 `res.cookies.set(SESSION_COOKIE, token, { ... })` 옵션에 다음 줄이 있는지 확인한다. Task 1을 먼저 수행했다면 이미 들어가 있다.

```ts
secure: process.env.NODE_ENV === "production",
```

전체 옵션 블록은 다음과 같아야 한다:

```ts
res.cookies.set(SESSION_COOKIE, token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: SESSION_TTL_MS / 1000,
  path: "/",
});
```

- [ ] **Step 2: 로그아웃 쿠키에도 secure 정합성 확인**

`src/app/api/auth/logout/route.ts`는 `maxAge: 0`으로 쿠키를 만료시킨다. 만료용이라 secure는 필수는 아니지만, 일부 브라우저가 secure 속성이 다른 쿠키를 별개로 취급할 수 있으므로 로그인과 동일하게 맞춘다.

```ts
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공. (로컬은 `NODE_ENV`가 production이 아니므로 secure가 꺼져 개발 로그인은 정상.)

- [ ] **Step 4: 커밋**

Task 1에서 `login/route.ts`를 이미 커밋했다면, 이 태스크에서는 `logout/route.ts` 변경만 커밋한다.

```bash
git add src/app/api/auth/logout/route.ts
git commit -m "feat: 세션 쿠키 secure 플래그를 프로덕션에서 활성화"
```

> Task 1과 Task 2를 한 세션에서 연속 수행한다면, `login/route.ts`의 secure 변경은 Task 1 커밋에 포함하고 이 태스크는 `logout/route.ts`만 다루면 커밋이 깔끔하다.

---

## Task 3: 보안 응답 헤더 (HSTS 등)

`next.config.ts`의 `headers()`로 전체 경로에 보안 응답 헤더를 추가한다. HTTPS 운영 시 SSL stripping(HSTS 부재), 클릭재킹(X-Frame-Options 부재), MIME 스니핑(X-Content-Type-Options 부재)을 막는다.

> **HSTS 주의:** `Strict-Transport-Security`는 브라우저가 해당 도메인을 지정 기간 HTTPS 전용으로 강제한다. **반드시 HTTPS(도메인 + 인증서)가 정상 동작하는 것을 확인한 뒤 배포**해야 한다. HTTP만 되는 상태에서 HSTS가 걸리면 접속이 막힌다. `preload`는 되돌리기가 매우 어려우니 초기에는 넣지 않는다(아래 값에 미포함).

**Files:**
- Modify: `src/next.config.ts` → 실제 경로는 `next.config.ts` (프로젝트 루트)
- 참고 문서: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md`

**Interfaces:** 없음.

- [ ] **Step 1: 참고 문서 확인**

Read `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md` — `async headers()`가 `{ source, headers: [{ key, value }] }[]` 배열을 반환하는 형식임을 확인한다. (이 계획은 해당 API로 검증됨.)

- [ ] **Step 2: next.config.ts에 headers() 추가**

Modify `next.config.ts` (현재는 빈 설정):

```ts
import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 3: 빌드 및 헤더 적용 확인**

Run: `npm run build && npm start` (별도 터미널에서 실행하거나 백그라운드).

Then verify (앱이 3000 포트에서 뜬 상태):

Run: `curl -sI http://localhost:3000/login`
Expected 응답 헤더에 다음이 포함:
```
strict-transport-security: max-age=63072000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
referrer-policy: strict-origin-when-cross-origin
```

> 확인 후 `npm start` 프로세스는 종료한다.

- [ ] **Step 4: 커밋**

```bash
git add next.config.ts
git commit -m "feat: 보안 응답 헤더(HSTS 등) 추가"
```

---

## Task 4: nginx 서브도메인 리버스 프록시 + TLS 인증서 (drillup.mygreed.shop)

기존 서버(146.56.170.98)에 이미 nginx + Certbot이 돌고 있고, `mygreed.shop`이 8001 포트의 다른 앱(greed)에 프록시되고 있다. drillup은 **서브도메인 `drillup.mygreed.shop`으로 기존 nginx·Certbot을 재사용**해 `127.0.0.1:3000`으로 프록시한다. 기존 인증서는 `mygreed.shop` 단일 도메인이라 서브도메인용 인증서를 **새로 발급**한다(자동 갱신은 기존 `certbot-renew.timer`가 처리하므로 추가 설정 불필요).

**역할 분담:**
- **사람(사용자)이 하는 것:** DNS에 A레코드 `drillup.mygreed.shop → 146.56.170.98` 추가. **이것만 사람이 한다.**
- **에이전트가 하는 것:** 리포에 nginx conf 초안 커밋 + 서버에 파일 배치 + Certbot 인증서 발급 + nginx 리로드. 아래 절차대로 SSH로 수행 가능.

**서버 접속:** PowerShell 프로필의 `opc` 함수와 동일한 키/호스트를 쓴다.
`ssh -i "C:\Users\lee\.ssh\ssh-key-2022-07-29.key" opc@146.56.170.98 "<명령>"`

**서버 확인된 사실 (2026-07-11 기준):**
- nginx 1.20.1, RHEL 계열 → 설정은 `/etc/nginx/conf.d/*.conf` (sites-enabled 아님).
- 기존 앱 conf: `/etc/nginx/conf.d/greed-mobile.conf` (mygreed.shop → 127.0.0.1:8001).
- Certbot 설치됨(`/usr/bin/certbot`), `certbot-renew.timer` **enabled** → 신규 인증서도 자동 갱신됨.
- 기존 인증서: `mygreed.shop` 단일 도메인(와일드카드 아님). SAN에 서브도메인 없음.
- drillup next-server가 이미 `*:3000`에서 구동 중.

**Files:**
- Create: `deploy/nginx/drillup.mygreed.shop.conf`

**Interfaces:** 없음.

- [ ] **Step 1: 선행조건 — A레코드 전파 확인**

사용자가 DNS에 `drillup.mygreed.shop → 146.56.170.98` A레코드를 추가했는지 먼저 확인한다. 전파 전에는 Certbot HTTP-01 챌린지가 실패한다.

Run (로컬): `nslookup drillup.mygreed.shop`
Expected: `146.56.170.98` 반환. 아직 안 나오면 전파를 기다렸다가 다음 단계로 진행한다.

- [ ] **Step 2: nginx conf 초안 작성 (HTTP 전용, Certbot이 이후 443 추가)**

Create `deploy/nginx/drillup.mygreed.shop.conf`. 처음엔 80 포트만 둔다 — `certbot --nginx`가 이 블록을 읽어 443 SSL 블록과 HTTP→HTTPS 리다이렉트를 자동으로 덧붙인다(기존 greed-mobile.conf가 만들어진 방식과 동일).

```nginx
# drillup 서브도메인 리버스 프록시 (drillup.mygreed.shop → 127.0.0.1:3000)
#
# 이 파일은 HTTP(80)만 정의한다.
# 서버에서 `sudo certbot --nginx -d drillup.mygreed.shop` 를 실행하면
# Certbot 이 이 블록에 443 ssl 블록과 HTTP→HTTPS 리다이렉트를 자동 삽입한다.
# (기존 /etc/nginx/conf.d/greed-mobile.conf 와 동일한 패턴)
#
# 배치 위치: /etc/nginx/conf.d/drillup.mygreed.shop.conf
server {
    listen 80;
    listen [::]:80;
    server_name drillup.mygreed.shop;

    # 생성 응답이 클 수 있으니 여유 있게
    client_max_body_size 20m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

> `X-Forwarded-For`는 기존 greed-mobile.conf와 동일하게 `$proxy_add_x_forwarded_for`(체인 보존)를 쓴다. drillup의 로그인 락아웃(Task 1)은 IP 무관 전역 방식이라 이 값에 의존하지 않으므로, 서버 설정 일관성을 우선한다.

- [ ] **Step 3: 리포 커밋**

```bash
git add deploy/nginx/drillup.mygreed.shop.conf
git commit -m "docs: drillup 서브도메인 nginx 프록시 설정 추가"
```

- [ ] **Step 4: 서버에 conf 배치**

로컬 conf를 서버로 복사한 뒤 `conf.d`로 옮긴다. `opc` 사용자는 sudo가 필요하므로 임시 위치로 복사 후 이동한다.

```bash
# 로컬에서 실행 (Git Bash / scp)
scp -i "C:/Users/lee/.ssh/ssh-key-2022-07-29.key" \
  deploy/nginx/drillup.mygreed.shop.conf \
  opc@146.56.170.98:/tmp/drillup.mygreed.shop.conf

ssh -i "C:/Users/lee/.ssh/ssh-key-2022-07-29.key" opc@146.56.170.98 \
  "sudo mv /tmp/drillup.mygreed.shop.conf /etc/nginx/conf.d/drillup.mygreed.shop.conf && sudo nginx -t && sudo systemctl reload nginx"
```

Expected: `nginx: configuration file /etc/nginx/nginx.conf test is successful` 후 reload 성공.

- [ ] **Step 5: Certbot으로 서브도메인 인증서 발급 (에이전트 수행)**

`--nginx` 플러그인으로 발급하면 Certbot이 인증서를 받고 conf에 443 블록·리다이렉트를 자동 삽입한 뒤 nginx를 리로드한다. 비대화형 실행을 위해 이메일/약관 플래그를 준다.

```bash
ssh -i "C:/Users/lee/.ssh/ssh-key-2022-07-29.key" opc@146.56.170.98 \
  "sudo certbot --nginx -d drillup.mygreed.shop --non-interactive --agree-tos -m unknown9732@gmail.com --redirect"
```

Expected: `Successfully received certificate` + `Deploying certificate` + nginx 리로드. 실패 시(대개 A레코드 미전파) Step 1로 돌아가 전파를 기다린다.

- [ ] **Step 6: 발급·자동갱신 확인**

```bash
# 인증서에 서브도메인이 포함됐는지
ssh -i "C:/Users/lee/.ssh/ssh-key-2022-07-29.key" opc@146.56.170.98 \
  "sudo certbot certificates | grep -A2 drillup"

# 자동 갱신 리허설 (기존 certbot-renew.timer 가 이 인증서도 갱신함)
ssh -i "C:/Users/lee/.ssh/ssh-key-2022-07-29.key" opc@146.56.170.98 \
  "sudo certbot renew --dry-run"
```

Expected: `certbot certificates`에 `drillup.mygreed.shop` 도메인이 뜨고, `renew --dry-run`이 성공(`Congratulations, all simulated renewals succeeded`). **별도 갱신 크론/타이머 추가는 불필요** — `certbot-renew.timer`가 이미 enabled 상태로 모든 인증서를 갱신한다.

- [ ] **Step 7: 엔드투엔드 접속 확인**

Run (로컬): `curl -sI https://drillup.mygreed.shop/login`
Expected: `HTTP/2 200` (또는 로그인 리다이렉트), 그리고 Task 3의 보안 헤더(`strict-transport-security` 등)가 응답에 포함. HTTP 접속은 HTTPS로 301 리다이렉트되는지도 확인:
Run: `curl -sI http://drillup.mygreed.shop/`
Expected: `301` → `location: https://drillup.mygreed.shop/`.

---

## 적용 순서 및 운영 주의

1. **Task 1 → 2 → 3 → 4** 순서로 진행한다. Task 1과 2는 같은 파일(`login/route.ts`)을 건드리므로 Task 1에서 secure까지 함께 반영하는 것을 권장한다.
2. **Task 4는 사용자의 A레코드 추가가 선행조건**이다. `drillup.mygreed.shop` A레코드 전파 전에는 Certbot 발급이 실패한다(Step 1에서 확인).
3. **HSTS(Task 3)는 Task 4로 HTTPS가 실제로 뜬 뒤에 유효**하다. 앱 응답 헤더라 배포 순서상 Task 3을 먼저 커밋해도 무방하지만, 도메인이 HTTPS로 접속되는 것을 Task 4 Step 7에서 확인한다. `preload`는 넣지 않았으므로 되돌리기 리스크는 낮다.
4. **평문 직접 접속(`:3000`)은 사용자가 신경 쓰지 않기로 함** — 이 계획에서 3000 포트 바인딩 제한은 다루지 않는다.
5. 이 계획은 **AI 생성 엔진의 무제한 권한 실행**(`--dangerously-skip-permissions` / `--yolo`)은 다루지 않는다. 단일 사용자 앱 전제에서 수용한 잔여 위험이며, 필요 시 별도 계획(엔진 프로세스 저권한 OS 사용자 격리)으로 다룬다.

## Self-Review 결과

- **Task 1**: 브루트포스 방어(전역 락아웃) — 커버.
- **Task 2**: secure 쿠키 — 커버.
- **Task 3**: 보안 헤더/HSTS — 커버.
- **Task 4**: 서브도메인(drillup.mygreed.shop) nginx 프록시 + Certbot 인증서 발급/자동갱신 — 커버. 사용자는 A레코드만, 나머지(conf 배치·발급·리로드·갱신 확인)는 에이전트가 SSH로 수행.
- 타입 정합성: `checkLockout`/`recordFailure`/`recordSuccess`/`resetThrottleForTest`/`MAX_FAILURES`/`LOCKOUT_MS` 시그니처가 테스트·구현·라우트에서 일치.
- 미해결 전제 없음: `jsonError`가 `NextResponse` 반환임을 `src/server/http.ts:9-15` 로 확인 완료.
