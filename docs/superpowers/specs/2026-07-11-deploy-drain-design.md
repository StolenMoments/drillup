# 배포 드레인 설계 (2026-07-11)

## 문제

AI 생성 job은 별도 큐 없이 Next.js 서버 프로세스 안에서 fire-and-forget으로 실행된다
(`src/server/generation/generation-service.ts`의 `void runJob(...)` / `void runKeywordTagJob(...)` /
`void runItemRevision(...)`). 배포 시 `scripts/deploy-remote.sh`가 `systemctl --user restart drillup`을
실행하면 systemd가 Node 프로세스와 자식 CLI 엔진 프로세스를 모두 종료한다. DB에
`RUNNING`/`VERIFYING`으로 남은 job은 이후 `getJob()`의 stale 판정에 걸려 FAILED 처리된다(고아 상태).

## 목표

배포가 진행 중인 job을 죽이지 않는다. restart 전에 활성 job이 끝날 때까지 기다려,
기존 job이 구버전 코드에서 끝까지 정상 완료되게 한다.

## 선택한 접근: 배포 드레인

검토한 대안:

- **A. 배포 드레인 (선택)** — 배포 스크립트가 활성 job 종료를 기다린 뒤 재시작. 가장 단순, AI 비용 낭비 없음.
- B. 서버 기동 시 재개 — 배포는 즉시, 새 서버가 RUNNING/VERIFYING job을 재실행. AI 호출 비용 이중 지출, 재개 로직 필요.
- C. 워커 프로세스 분리 — 구조적으로 올바르나 개인 프로젝트 규모 대비 작업량 과다.

## 구성 요소

### 1. `scripts/wait-for-generation-drain.mjs` (신규)

서버에서 실행되는 드레인 스크립트.

- `.env`를 직접 파싱해 DB 접속 정보(`DATABASE_URL` 또는 `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`)를 읽는다.
- 이전 배포의 `node_modules`에 있는 `mariadb` 패키지로 plain SQL 카운트 쿼리를 실행한다.
  Prisma 생성 클라이언트에 의존하지 않으므로 스키마 세대와 무관하게 동작한다.
- 대기 대상: `generation_job`에서 `status IN ('RUNNING','VERIFYING')`, `generation_item_revision`에서
  `status = 'RUNNING'`인 행 중 **stale하지 않은 것**만.
- **stale 판정은 `getJob()`과 동일한 규칙**: `created_at`이 `2 × GENERATION_TIMEOUT_MS + 60초`
  (기본 타임아웃 10분 → 1,260초)보다 오래된 행은 이미 죽은 고아로 간주하고 기다리지 않는다.
  `GENERATION_TIMEOUT_MS`는 `.env`에서 읽으며 미설정 시 600,000ms.
- 10초 간격 폴링. 최대 대기 시간 기본 40분, `DEPLOY_DRAIN_TIMEOUT_SECONDS` 환경 변수로 조정.
  초과 시 경고를 출력하고 exit 0으로 배포를 계속 진행한다(배포가 영원히 막히는 것 방지).
- `node_modules/mariadb`가 없으면(최초 배포) 드레인을 건너뛴다.
- 테스트 가능성을 위해 stale window 계산과 `.env` 파싱을 순수 함수로 분리한다.

### 2. `scripts/deploy-remote.sh` 수정

드레인을 두 번 호출한다.

- **1차: `npm ci`/`build` 이전.** 긴 대기가 발생하는 구간을 여기에 둬서, job이 도는 동안 구서버의
  `.next`와 `node_modules`를 건드리지 않은 채로 유지한다(빌드를 먼저 하면 구서버가 새 `.next`
  청크를 못 찾는 문제가 생길 수 있음).
- **2차: `systemctl restart` 직전.** 빌드하는 몇 분 사이에 새로 시작된 job을 잡아내는 재확인.
  평소엔 즉시 통과한다.

## 동작 흐름

```
rsync → [드레인 대기] → npm ci → prisma generate/migrate → build → [드레인 재확인] → restart
```

## 한계 (수용)

- 배포가 아닌 서버 크래시·재부팅으로 죽는 job은 여전히 고아가 되며, 기존 stale 판정이 FAILED로 정리한다.
- 드레인 재확인과 restart 사이 수 초의 레이스는 1인 사용 환경이라 무시한다.
- 드레인 대기 중 새 job 생성을 막지 않는다(사용자가 배포 타이밍을 직접 통제).

## 테스트

- stale window 계산, `.env` 파싱, 카운트 쿼리 조건 구성은 순수 함수로 분리해 단위 테스트한다.
- 실제 폴링 루프와 deploy-remote.sh 연동은 서버 배포로 확인한다.
