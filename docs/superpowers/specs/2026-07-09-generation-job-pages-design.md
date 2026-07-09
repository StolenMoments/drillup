# AI 생성 작업 목록·상세 페이지 설계

날짜: 2026-07-09
상태: 승인됨
선행 문서: `2026-07-08-ai-generation-design.md`, `2026-07-08-generation-verify-dedup-design.md`, `2026-07-09-topic-reference-generation-design.md`

## 1. 목표

AI 문제 생성은 이미 백그라운드 잡으로 동작하지만, 현재 `/generate` 한 페이지가 폼
입력·진행 폴링·미리보기·저장을 전부 담당해 **사용자가 생성이 끝날 때까지 그 페이지에
머물러야** 한다. localStorage로 활성 잡을 1개만 추적하므로 여러 잡을 병렬로 굴리거나
과거 잡을 다시 열어볼 수도 없다.

생성 시작과 결과 확인을 분리한다.

- **폼**은 잡을 시작만 하고 곧바로 상세로 넘긴다 — 대기 불필요.
- **작업 목록** 페이지에서 모든 잡의 상태를 한눈에 본다.
- **상세** 페이지에서 완료된 잡의 내용을 확인하고 **최종 승인(저장)** 한다.

핵심 결정 사항:

- **페이지 구조**: 목록 우선. `/generate` = 목록(랜딩), `/generate/new` = 폼,
  `/generate/[id]` = 상세·승인
- **승인 상태 추적**: `status` enum을 늘리지 않고 `GenerationJob`에 `approvedAt`·
  `savedCount` 컬럼 추가 → 부분 저장·재저장을 자연스럽게 수용
- **목록 범위·관리**: 최근 50개 최신순, 페이지네이션 없음. 개별 잡 삭제 제공
- **승인 방식**: 프론트가 문제 payload를 다시 보내지 않고, 승인 전용 엔드포인트에
  **선택 인덱스만** 전송 → 서버가 저장 + 승인 기록을 함께 처리
- **localStorage 활성-잡 메커니즘 제거** — 잡이 DB 목록의 1급 개체가 되므로 불필요

설계 원칙 유지(플랜 00-overview의 Global Constraints):

- 잡 조회·승인·삭제 로직은 `src/server/generation/` (서비스 계층, Next import 금지)
- Route Handler는 얇게 (zod 파싱 → 서비스 호출 → JSON 응답)
- 화면은 `src/lib/api-client.ts`의 `api` 객체만 사용, 서버 컴포넌트에서 서비스 직접
  호출 금지 (데이터 페이지는 클라이언트 컴포넌트 + api-client)
- 저장은 새 삽입 경로를 만들지 않고 기존 `import-service`를 재사용 — DB 삽입 단일 경로

## 2. 전체 흐름

```
/generate/new  폼 입력 → api.generate.create() → router.push(`/generate/${id}`)
  ▼
/generate/[id] 상세
  │ RUNNING/VERIFYING → 진행 표시 + 3초 폴링
  │ SUCCEEDED         → 미리보기(검증 배지·체크박스) → 승인 → api.generate.approve(id, indices)
  │ FAILED            → 오류 + 다시 시도
  ▼
/generate      작업 목록 (최근 50, 최신순)
  │ 진행 중 잡이 하나라도 있으면 3초 폴링으로 목록 갱신
  │ 각 행: #id · 주제 · 엔진 · 상태 배지 · 생성시각 · (SUCCEEDED면 저장됨 N개/미저장)
  │ 행 클릭 → 상세, 행별 삭제 버튼(확인 후) → api.generate.remove(id)
```

기존 잡 실행 파이프라인(`generation-service.runJob`, `run-engine`, 검증·dedup)은
변경하지 않는다. 이 설계는 **잡의 생명주기 조회·표시·승인·삭제 표층**만 다룬다.

## 3. 데이터 모델 (Prisma)

`GenerationJob`에 컬럼 2개 추가. enum·다른 모델 변경 없음.

```prisma
model GenerationJob {
  // ...기존 필드...
  approvedAt DateTime? @map("approved_at")            // 최근 저장(승인) 시각
  savedCount Int       @default(0) @map("saved_count") // 누적 저장 문제 수
}
```

- `status` enum(`RUNNING/VERIFYING/SUCCEEDED/FAILED`)은 그대로. 승인은 별도 상태가
  아니라 `approvedAt` 기록으로 표현한다 → 같은 잡에서 일부만 저장하거나 나중에 더
  저장하는 흐름을 상태 전이 없이 수용.
- 마이그레이션은 컬럼 추가뿐이라 기존 잡 데이터에 영향 없음(`approvedAt` null,
  `savedCount` 0으로 채워짐).

## 4. API 설계

엔드포인트 3개 추가. 기존 `POST /api/generate`, `GET /api/generate/[id]`는 유지하되
상세 DTO에 필드 2개를 더한다.

### ① `GET /api/generate` — 작업 목록 (신규)

```
응답: 200 { jobs: GenerationJobSummaryDto[] }  // 최신순, 최대 50
```

경량 요약만 반환한다. 항목별 문제 내용(`result`)·`rawOutput`은 목록에서 제외하고
상세에서만 싣는다. `topicName`을 위해 서비스에서 topic 관계를 조인한다.

### ② `POST /api/generate/[id]/approve` — 승인(저장) (신규)

```
요청: { indices: number[] }   // 저장할 항목 인덱스 (job.result 기준)
응답: 200 { savedCount: number, job: GenerationJobDto }
오류: 404 JOB_NOT_FOUND / 409 JOB_NOT_APPROVABLE / 400 INVALID_ITEMS
```

- 서버가 `job.result`에서 해당 인덱스의 `ok=true` 항목만 골라 **기존 import-service로
  저장**한다. 프론트는 문제 payload를 다시 보내지 않는다.
- 저장 성공 후 `approvedAt = now`, `savedCount += 저장 수`를 같은 서비스 호출에서
  갱신 → "저장은 됐는데 승인 기록 실패" 어긋남 제거.
- `indices`에 유효하지 않거나 `ok=false`인 항목이 섞이면 400 `INVALID_ITEMS`.
- 잡 상태가 `SUCCEEDED`가 아니면 409 `JOB_NOT_APPROVABLE`.

### ③ `DELETE /api/generate/[id]` — 삭제 (신규)

```
응답: 200 { ok: true }
오류: 404 JOB_NOT_FOUND / 409 JOB_RUNNING
```

- `RUNNING`/`VERIFYING` 잡은 409 `JOB_RUNNING`으로 거부("진행 중인 작업은 삭제할 수
  없습니다"). 멈춘 잡은 `getJob`의 고아 타임아웃 판정이 터미널 상태로 정리한 뒤 삭제
  가능해진다.
- 잡 행 삭제 + 온디스크 `generation_output/jobs/<id>/` 디렉터리 정리(있으면).

### DTO (`src/lib/api-types.ts`)

```ts
export interface GenerationJobSummaryDto {
  id: number;
  topicId: number;
  topicName: string;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  status: GenerationStatusDto;
  itemCount: number | null;   // SUCCEEDED일 때 총 항목 수, 아니면 null
  savedCount: number;
  approvedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}
```

기존 `GenerationJobDto`(상세)에 `approvedAt: string | null`, `savedCount: number`
추가. api-client에 다음을 추가하고 화면은 이 함수만 사용:

- `api.generate.list()` → `GenerationJobSummaryDto[]`
- `api.generate.approve(id, indices)` → `{ savedCount, job }`
- `api.generate.remove(id)` → `{ ok }`

## 5. 서비스 계층 (`src/server/generation/generation-service.ts` 확장)

- `listJobs()` — 최근 50개 `findMany`(topic 조인, `orderBy createdAt desc`).
  `SUCCEEDED`면 `result` 배열 길이로 `itemCount` 계산, 그 외 null. `toSummaryDto`로
  변환.
- `approveJob(id, indices)` — 잡 로드 → `SUCCEEDED` 확인 → `result`에서 인덱스별
  `ok=true` 항목 수집(하나라도 무효면 400) → `import-service`로 저장 →
  `approvedAt`·`savedCount` UPDATE → 갱신된 상세 DTO 반환.
- `deleteJob(id)` — 잡 로드 → `RUNNING`/`VERIFYING`이면 409 → 행 삭제 →
  `jobOutputDir(id)` 디렉터리 재귀 삭제(실패는 무시, best-effort).
- 기존 `toDto`는 `approvedAt`·`savedCount`를 포함하도록 확장.

`createJob`/`runJob`/`getJob`은 그대로. 고아 타임아웃 정리 로직도 그대로 둔다.

## 6. 화면

모두 클라이언트 컴포넌트 + api-client 경유. UI 문구 한국어, 답안 결과 이모지 유지.

### `/generate` — 작업 목록 (랜딩)

- 상단: 제목 + "새 생성" 버튼(→ `/generate/new`).
- 목록 행: `#id · 주제명 · 엔진→검증엔진 · 상태 배지 · 생성시각`.
  - RUNNING/VERIFYING: ⏳ 진행 배지
  - SUCCEEDED: ✅ + (`approvedAt` 있으면 `저장됨 N개`, 없으면 `미저장`)
  - FAILED: ❌ + 오류 요약 1줄
- 행 클릭 → `/generate/[id]`. 행별 삭제 버튼(confirm 후 `api.generate.remove`).
- 진행 중(RUNNING/VERIFYING) 잡이 하나라도 있으면 3초 간격으로 `api.generate.list()`
  재호출해 갱신. 없으면 폴링 중단.
- 빈 목록: "아직 생성한 작업이 없습니다 — 새 생성으로 시작하세요" 안내.

### `/generate/new` — 생성 폼

현재 `/generate`의 입력부를 그대로 이동한다(주제 선택/새 주제 추가, 참고 자료 파일
체크박스, 엔진·검증 엔진 라디오, 추가 지시 textarea). "생성 시작" →
`api.generate.create()` 성공 시 `router.push('/generate/${created.id}')`. 인페이지
폴링·미리보기·저장·localStorage 로직은 여기서 제거된다.

### `/generate/[id]` — 상세·승인

- 상단 "← 목록" 링크.
- **RUNNING/VERIFYING**: 진행 상태 + 경과 시간, 3초 폴링(현재 로직 재사용). 상태가
  터미널로 바뀌면 폴링 중단하고 아래 뷰로 전환.
- **FAILED**: ❌ + `errorMessage`. "다시 시도"는 `/generate/new`로 이동(같은 조건을
  재입력) — 잡 입력을 상세 DTO에 싣지 않으므로 폼 프리필은 하지 않는다(YAGNI).
- **SUCCEEDED**: 현재의 미리보기 카드 UI 그대로 — 검증 배지(✅ 통과 / ⚠️ 의견 /
  검증 안 됨), 항목별 체크박스(기본: `ok && verdict!=="fail"` 선택), 검증 코멘트,
  오류 항목 빨간 카드, `verifyWarning` 배너.
  - `approvedAt`이 있으면 상단에 "⚠️ 이미 N개 저장함 (시각)" 배너, 저장 버튼 클릭 시
    재저장 confirm.
  - 저장 → `api.generate.approve(id, [선택 인덱스])` → "✅ N개 문제를 저장했습니다" +
    상세 재조회로 배지 갱신.

### 리팩터링

현재 단일 `src/app/generate/page.tsx`를 세 페이지로 분해한다: 입력 폼 →
`generate/new/page.tsx`, 진행 폴링·미리보기·승인 → `generate/[id]/page.tsx`, 목록 →
`generate/page.tsx`. `QuestionPreview`는 이미 공용 컴포넌트라 그대로 재사용. 네비의
"AI 생성" 링크는 목록(`/generate`)을 가리킨 채 유지.

## 7. 오류 처리

| 상황 | 처리 |
|---|---|
| 진행 중(RUNNING/VERIFYING) 잡 삭제 시도 | 409 `JOB_RUNNING`, "진행 중인 작업은 삭제할 수 없습니다" |
| approve 시 잡이 SUCCEEDED 아님 | 409 `JOB_NOT_APPROVABLE` |
| approve의 indices에 무효/`ok=false` 항목 | 400 `INVALID_ITEMS` |
| 존재하지 않는 잡 상세/승인/삭제 | 404 `JOB_NOT_FOUND` |
| 목록/상세 폴링 일시 오류 | 다음 주기 재시도(현행과 동일) |
| 승인 저장 중 import 실패 | import-service 오류를 그대로 전파, `approvedAt` 미갱신 |

## 8. 테스트

vitest, core 단위 테스트만 자동화(프로젝트 규약: 서비스 계층은 수동 검증). 이번
변경의 핵심은 서비스 계층(목록·승인·삭제)과 화면 분해라 신규 core 순수 로직이 없어
자동 테스트 추가는 없다. 기존 `prompt-template`/`verify-schema` 등 core 테스트는 변경
없이 통과해야 한다.

수동 검증(브라우저 + curl):

1. `/generate/new`에서 잡 생성 → 상세로 자동 이동, 진행 폴링 확인
2. `/generate` 목록에서 해당 잡이 진행 배지로 보이고 완료 시 자동 갱신
3. 상세에서 일부 항목 선택 후 승인 → "✅ N개 저장", 목록에 `저장됨 N개` 반영,
   `approvedAt`·`savedCount` DB 확인(`npx prisma studio`)
4. 같은 잡 재저장 시 경고 confirm 뜨고 `savedCount` 누적
5. 진행 중 잡 삭제 시 409, 완료 잡 삭제 시 목록에서 사라지고
   `generation_output/jobs/<id>/` 정리 확인
```
