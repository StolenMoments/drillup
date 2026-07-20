# 주제별 학습 노트 설계

날짜: 2026-07-20

## 1. 배경과 목표

AIP-C01 문제를 풀면서 문제에 나오는 서비스 간 관계·핵심 기능 같은 요점을 **사용자가 직접** 간결한 노트로 쌓아 나가고 싶다. 쓰다 보면 같은 내용을 또 적거나 장황해지므로, 원할 때 **AI 정리 버튼**으로 중복 제거·재구성한 초안을 받아 비교 후 반영한다.

핵심 결정 (브레인스토밍 확정):

- 노트 작성 주체는 **사용자 본인** (AI 자동 추출 아님)
- 그릇은 **주제(Topic)당 마크다운 문서 1개**
- 작성·열람 위치는 **풀이 화면의 노트 패널** (별도 노트 페이지 없음)
- 중복 정리는 **AI 정리 버튼** — 기존 CLI 엔진 인프라 재사용, 반영 전 미리보기

## 2. 비스코프 (YAGNI)

- 노트 버전 히스토리 / 실행 취소 — 반영 전 미리보기 + source_hash 가드로 유실 위험이 없음
- 별도 노트 열람 페이지, 노트 검색, 노트 내보내기
- 문제 컨텍스트 프리필 ("이 문제에서 추가" 버튼) — 필요해지면 추후
- 노트 자동 저장 — 명시적 저장 버튼만

## 3. 데이터 모델 (prisma/schema.prisma)

### `topic_note` — 주제당 노트 1개

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | Int PK autoincrement | |
| `topic_id` | Int FK → topic, `@unique` | onDelete: Cascade |
| `content` | TEXT | 마크다운 원문 |
| `created_at` / `updated_at` | DateTime | 기존 관례 동일 |

### `note_tidy_job` — AI 정리 잡 (ChoiceHardeningJob 패턴 축소판)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | Int PK autoincrement | |
| `topic_id` | Int FK → topic | onDelete: Cascade |
| `source_hash` | CHAR(64) | 잡 시작 시점 노트 content의 SHA-256 |
| `engine` | `GenerationEngine` | 기존 enum 재사용 (CLAUDE/CODEX/ANTIGRAVITY) |
| `status` | 새 enum `NoteTidyJobStatus` | RUNNING / SUCCEEDED / FAILED |
| `preview` | TEXT nullable | AI 정리 초안 (반영 전까지 여기만 존재) |
| `error_message` | TEXT nullable | |
| `created_at` / `finished_at` | DateTime | |

`source_hash`는 반영 시점 충돌 가드: 잡 시작 후 사용자가 노트를 수정했다면 반영을 거부해 사용자 편집이 AI 초안에 덮어써지는 사고를 막는다.

## 4. API

Route Handler는 얇게 (zod 파싱 → 서비스 호출 → JSON 응답). 오류 형식 `{ "error": { "code", "message" } }` 통일.

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/topics/[id]/note` | 노트 조회. 없으면 `content: ""`, `updatedAt: null` (404 아님). 응답에 `activeTidyJob: { id, status } \| null` 포함 — RUNNING이거나, SUCCEEDED인데 아직 반영/폐기되지 않은 최신 잡 (§7 참고) |
| `PUT /api/topics/[id]/note` | 노트 저장 (upsert). body: `{ content: string }` |
| `POST /api/topics/[id]/note/tidy` | AI 정리 잡 시작. body: `{ engine }`. 해당 주제에 RUNNING 잡 존재 시 409. 빈 노트면 400 |
| `GET /api/note-tidy-jobs/[id]` | 잡 상태·초안 조회 (프론트 폴링용) |
| `POST /api/note-tidy-jobs/[id]/apply` | 초안을 노트에 반영. source_hash 불일치 시 409, SUCCEEDED 아닌 잡이면 409 |
| `POST /api/note-tidy-jobs/[id]/dismiss` | 초안 폐기 |

프론트는 `src/lib/api-client.ts` 경유(`api.notes.*`), DTO는 `src/lib/api-types.ts`에 추가.

## 5. 서버 구성

- `src/server/note-service.ts` — 노트 조회/저장, 잡 시작·조회·반영·폐기. 반영/폐기는 ChoiceHardeningJob의 apply/dismiss 흐름을 따른다.
- `src/server/note-tidy-runner.ts` — 잡 실행: 노트 content로 프롬프트 생성 → `runEngine` 호출 → 결과 파싱 → 잡 SUCCEEDED(preview 저장) 또는 FAILED(error_message 저장). 잡 시작 API가 fire-and-forget으로 호출 (기존 러너 패턴 동일).
- 출력 디렉터리는 기존 관례를 따라 `generation_output/` 하위 사용.

## 6. core (순수 TS, 단위 테스트 대상)

- `src/core/note-tidy-prompt.ts` — `buildNoteTidyPrompt(content: string): string`
  - 지시 핵심: **중복 제거·간결화·재구성만** 수행. 새로운 사실 추가 금지, 중복 통합 외 내용 삭제 금지, 마크다운 구조 유지, 한국어 유지. 결과는 `{"note": "..."}` JSON 하나만 출력.
- `src/core/note-tidy-result.ts` — `parseNoteTidyResult(raw: string)` : zod로 `{ note: string }` 파싱 (앞뒤 잡음 제거 포함, 기존 결과 파서 관례 참고). 빈 문자열 note는 실패 처리.

## 7. UI (풀이 화면 노트 패널)

- `src/app/study/page.tsx` 상단에 **"📝 노트" 버튼** 추가. 누르면 **바텀 시트 패널** 오픈 (모바일 PWA 우선). 풀이 진행 상태는 유지.
- 대상 주제는 **현재 문제의 주제**: `StudyQuestionDto`에 `topicId` 필드를 추가한다 (study-service의 큐 응답에 포함 — 전 주제 학습 모드에서도 문제마다 올바른 노트가 열림).
- 패널 컴포넌트: `src/components/NotePanel.tsx`
  - **보기 모드**: `react-markdown`으로 렌더링 (신규 의존성, 필요 시 remark-gfm)
  - **편집 모드**: textarea + "저장" 버튼. 저장 성공 시 ✅ 피드백
  - **AI 정리**: 엔진 선택 → 시작 → 진행 중 표시(잡 폴링) → 성공 시 "현재 노트 ↔ 정리 초안" 토글 비교 → "반영" 또는 "폐기". 실패 시 오류 메시지 ❌ + 재시도
  - 패널을 닫아도 RUNNING 잡은 계속 진행. 패널을 다시 열면 해당 주제의 미완료(RUNNING) 또는 미처리(SUCCEEDED·초안 존재) 잡을 조회해 이어서 보여준다 — 이를 위해 `GET /api/topics/[id]/note` 응답에 활성 잡 요약(`activeTidyJob: { id, status } | null`)을 포함한다.

## 8. 오류 처리

- 엔진 실패·타임아웃(기존 `generationTimeoutMs` 재사용) → 잡 FAILED, error_message 표시, 재시도 가능. 원본 노트는 어떤 실패에도 변경되지 않는다.
- apply 시 source_hash 불일치 → 409, 패널에서 "노트가 그 사이 수정되어 반영할 수 없습니다 ❌" 안내 후 폐기·재실행 유도.
- 편집 중 저장 실패(네트워크 등) → 오류 메시지 표시, textarea 내용 유지.

## 9. 테스트·검증

- vitest 단위 테스트: `note-tidy-prompt`, `note-tidy-result` (core만 — 프로젝트 관례).
- 서비스 계층은 curl 기반 수동 검증 절차를 구현 플랜에 명시 (노트 upsert, 잡 시작→폴링→반영, source_hash 충돌 409 재현).
- UI는 수동 확인: 풀이 화면에서 패널 열기 → 편집·저장 → AI 정리 → 비교 → 반영.
