# 로그인 제한 DoS 방지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전역 로그인 락아웃을 IP별 지수 backoff로 교체하고 nginx 로그인 경로에 IP별 요청 제한을 적용한다.

**Architecture:** 앱은 nginx가 덮어쓰는 `X-Real-IP`별로 메모리 상태를 관리하되 올바른 비밀번호를 먼저 판별해 정상 로그인을 절대 차단하지 않는다. nginx는 `$binary_remote_addr` 공유 zone으로 `/api/auth/login`만 제한하며, 저장소 설정을 현재 Certbot TLS 설정까지 포함한 배포 가능한 원본으로 맞춘다.

**Tech Stack:** Next.js 16.2.10 Route Handlers, TypeScript, Vitest 4.1.10, nginx 1.20.1, systemd user service

## Global Constraints

- `master`에서 직접 작업하며 branch나 worktree를 만들지 않는다.
- 코드 작성 전 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`의 Web `Request` API 사용법을 따른다.
- 테스트를 먼저 실패시킨 뒤 최소 구현을 작성한다.
- 사용자 대상 한국어 문구와 가벼운 이모지를 유지한다.
- 비밀 파일을 읽거나 git에 추가하지 않는다.
- 커밋 메시지는 영문 conventional-commit 접두사와 한국어 설명을 사용한다.
- 기존 미추적 `docs/superpowers/plans/2026-07-11-deploy-security-hardening.md`는 마지막 문서 커밋에 포함한다.

---

### Task 1: IP별 지수 backoff 모듈

**Files:**
- Modify: `src/server/login-throttle.test.ts`
- Modify: `src/server/login-throttle.ts`

**Interfaces:**
- Produces: `checkLockout(clientKey: string, now?: number): { locked: boolean; retryAfterMs: number }`
- Produces: `recordFailure(clientKey: string, now?: number): { retryAfterMs: number }`
- Produces: `recordSuccess(clientKey: string): void`
- Produces: `clientKeyFromRequest(req: Request): string`
- Produces: `resetThrottleForTest(): void`, `throttleEntryCountForTest(): number`

- [ ] **Step 1: IP 격리·backoff·정리 실패 테스트 작성**

`src/server/login-throttle.test.ts`를 IP A/B 격리, `1/2/4/8/16/30초` 증가, IP별 성공 초기화, 30분 만료, 10,000개 상한, `X-Real-IP`와 `unknown` fallback을 검증하도록 교체한다. 핵심 assertion은 다음과 같다.

```ts
expect(recordFailure("203.0.113.1", 0).retryAfterMs).toBe(1_000);
expect(checkLockout("203.0.113.1", 500)).toEqual({ locked: true, retryAfterMs: 500 });
expect(checkLockout("203.0.113.2", 500).locked).toBe(false);
recordSuccess("203.0.113.1");
expect(checkLockout("203.0.113.1", 500).locked).toBe(false);
```

- [ ] **Step 2: RED 확인**

Run: `npx vitest run src/server/login-throttle.test.ts`

Expected: 기존 함수가 client key를 받지 않고 IP별 상태를 분리하지 않아 FAIL.

- [ ] **Step 3: 최소 구현 작성**

`Map<string, { failureCount: number; blockedUntil: number; lastSeenAt: number }>`을 사용한다. 상수는 `BACKOFF_BASE_MS = 1_000`, `BACKOFF_MAX_MS = 30_000`, `ENTRY_TTL_MS = 30 * 60 * 1000`, `MAX_ENTRIES = 10_000`으로 둔다. `node:net`의 `isIP()`로 단일 `X-Real-IP`만 인정한다. 각 공개 함수 진입 시 만료 항목을 정리하고, 삽입 후 상한 초과분은 가장 오래된 항목부터 제거한다.

- [ ] **Step 4: GREEN 확인**

Run: `npx vitest run src/server/login-throttle.test.ts`

Expected: 모든 login-throttle 테스트 PASS.

- [ ] **Step 5: 커밋**

```powershell
git add src/server/login-throttle.ts src/server/login-throttle.test.ts
git commit -m "fix: 로그인 제한을 IP별 backoff로 변경"
```

### Task 2: 올바른 비밀번호 우선 처리

**Files:**
- Create: `src/app/api/auth/login/route.test.ts`
- Modify: `src/app/api/auth/login/route.ts`

**Interfaces:**
- Consumes: Task 1의 `clientKeyFromRequest`, `checkLockout`, `recordFailure`, `recordSuccess`
- Preserves: 기존 오류 JSON 형식, 세션 쿠키 옵션, 성공 응답 `{ ok: true }`

- [ ] **Step 1: Route Handler 실패 테스트 작성**

`vi.stubEnv("APP_PASSWORD", "correct-password")`, `vi.stubEnv("SESSION_SECRET", "test-secret")`, `vi.setSystemTime(0)`을 사용한다. 같은 IP의 첫 오답은 401, 즉시 재오답은 429와 `Retry-After: 1`, 다른 IP 오답은 401, 제한된 첫 IP의 정답은 200인 것을 실제 `POST(new Request(...))` 호출로 검증한다.

- [ ] **Step 2: RED 확인**

Run: `npx vitest run src/app/api/auth/login/route.test.ts`

Expected: 현재 전역 선행 `checkLockout()` 호출 또는 새 함수 signature 불일치로 FAIL.

- [ ] **Step 3: 최소 Route Handler 변경**

요청 시작 시 client key를 구하고 body를 파싱한다. 비밀번호가 맞으면 `recordSuccess(clientKey)` 후 세션을 발급한다. 오답일 때만 `checkLockout(clientKey)`를 검사해 429를 반환하고, 허용된 오답은 `recordFailure(clientKey)` 후 기존 401을 반환한다. 429에는 `Math.ceil(retryAfterMs / 1000)` 값을 `Retry-After`로 설정한다.

- [ ] **Step 4: GREEN 및 회귀 확인**

Run: `npx vitest run src/app/api/auth/login/route.test.ts src/server/login-throttle.test.ts`

Expected: 두 파일 모두 PASS.

- [ ] **Step 5: 커밋**

```powershell
git add src/app/api/auth/login/route.ts src/app/api/auth/login/route.test.ts
git commit -m "fix: 정상 로그인이 제한 상태를 우회하도록 수정"
```

### Task 3: nginx 로그인 전용 rate limit

**Files:**
- Modify: `deploy/nginx/drillup.mygreed.shop.conf`

**Interfaces:**
- Produces: `limit_req_zone $binary_remote_addr zone=drillup_login:10m rate=10r/m;`
- Produces: exact location `/api/auth/login` with `limit_req zone=drillup_login burst=5 nodelay`, `limit_req_status 429`

- [ ] **Step 1: 설정 검증 스크립트가 실패하는지 확인**

Run:

```powershell
$conf = Get-Content -Raw deploy/nginx/drillup.mygreed.shop.conf
if ($conf -notmatch 'limit_req_zone.+drillup_login' -or $conf -notmatch 'location = /api/auth/login' -or $conf -notmatch 'limit_req_status 429') { throw 'login rate limit missing' }
```

Expected: `login rate limit missing`로 FAIL.

- [ ] **Step 2: 저장소 nginx 설정을 배포 가능한 전체 설정으로 변경**

현재 운영 설정의 Certbot 443 블록과 80→443 redirect를 보존한다. 파일 최상단에 zone을 정의하고 443 server 안에 exact login location을 추가한다. exact location은 일반 location과 같은 `proxy_pass`, `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, `proxy_read_timeout`을 포함한다.

- [ ] **Step 3: 로컬 정적 검증 통과 확인**

Step 1 명령을 다시 실행한다.

Expected: exit 0.

- [ ] **Step 4: 앱 전체 검증**

Run: `npm test`; Expected: 0 failures.

Run: `npm run lint`; Expected: 0 errors.

Run: `npm run build`; Expected: exit 0.

- [ ] **Step 5: 커밋**

```powershell
git add deploy/nginx/drillup.mygreed.shop.conf
git commit -m "fix: nginx 로그인 요청을 IP별로 제한"
```

### Task 4: 기존 보안 계획 문서 포함 및 push

**Files:**
- Add: `docs/superpowers/plans/2026-07-11-deploy-security-hardening.md`
- Add: `docs/superpowers/plans/2026-07-11-login-throttle-hardening.md`

- [ ] **Step 1: 비밀 및 diff 확인**

Run: `git diff --check`; Expected: 출력 없음.

Run: `git status --short`; Expected: 의도한 두 문서 외 예상하지 못한 변경 없음.

- [ ] **Step 2: 문서 커밋**

```powershell
git add docs/superpowers/plans/2026-07-11-deploy-security-hardening.md docs/superpowers/plans/2026-07-11-login-throttle-hardening.md
git commit -m "docs: 배포 보안 강화 계획 정리"
```

- [ ] **Step 3: 최종 검증 및 push**

Run: `npm test`; Expected: 0 failures.

Run: `npm run lint`; Expected: 0 errors.

Run: `npm run build`; Expected: exit 0.

Run: `git push origin master`; Expected: push 성공.

### Task 5: 운영 nginx 반영과 확인

**Files:**
- Source: `deploy/nginx/drillup.mygreed.shop.conf`
- Remote: `/etc/nginx/conf.d/drillup.mygreed.shop.conf`

- [ ] **Step 1: 운영 설정 백업 및 임시 파일 전송**

`scp`로 `/tmp/drillup.mygreed.shop.conf`에 전송하고 운영 파일을 timestamp가 붙은 `/tmp` 백업으로 복사한다.

- [ ] **Step 2: 원자적 설치 전 설정 검사**

임시 파일을 `/etc/nginx/conf.d/drillup.mygreed.shop.conf.candidate`로 설치하고 기존 `.conf`와 교체해 `sudo nginx -t`를 실행한다. 실패하면 즉시 백업을 복원하고 다시 `nginx -t`를 확인한다.

- [ ] **Step 3: reload 및 서비스 상태 확인**

Run remote: `sudo systemctl reload nginx && systemctl --user is-active drillup && sudo systemctl is-active nginx`

Expected: `active` 두 줄과 성공 exit code.

- [ ] **Step 4: 공개 경로 비파괴 검증**

Run: `curl.exe -sS -o NUL -w "%{http_code}" https://drillup.mygreed.shop/login`

Expected: `200`. 운영 비밀번호 오답 반복 요청은 보내지 않는다.
