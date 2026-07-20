# 문제 핵심 내용 AI 추출 (노트 제안) 설계

날짜: 2026-07-20
상태: 승인됨

## 1. 배경과 목표

주제 노트 기능(2026-07-20-topic-note-design.md)은 사용자가 직접 작성하는 것을 전제로 했다.
그러나 문제를 풀면서 매번 손으로 핵심을 정리하는 것은 번거롭다. 현재 풀고 있는 문제에서
노트에 적을 만한 핵심 내용(서비스 간 관계, 서비스 핵심 기능 등)을 AI가 추출해 보여주고,
사용자가 확인 후 노트에 추가할 수 있게 한다.

### 비범위

- 결과 영속화 없음 (DB 테이블·잡 없음 — 일회성 추출)
- 자동 추출 없음 (버튼 클릭 시에만 실행)
- 노트 자동 append 없음 (반드시 미리보기 → 사용자 확인 후 추가)

## 2. 접근 방식 결정

- **A. 동기 엔드포인트 (explain 패턴 재사용)** ← 채택
- B. 비동기 잡 (NoteTidyJob 패턴 복제) — 일회성 추출에 과함 (테이블·라우트 5개·복구 로직)
- C. NoteTidyJob에 kind 컬럼 추가 — apply 의미(replace vs append)가 달라 서비스 분기가 지저분해짐

추출 결과는 "보고 → 추가" 한 사이클로 끝나므로 영속화가 불필요하고,
`getAnswerExplanation`이 이미 동기 엔진 호출 패턴(~40초 fetch)으로 안정적으로 동작 중이다.

## 3. API

### POST `/api/questions/[id]/note-extract`

- 요청: `{ "engine": "CLAUDE" | "CODEX" | "ANTIGRAVITY" }`
- 응답: `{ "engine": string, "extracted": string }` — extracted는 마크다운
- 오류:
  - 404 `NOT_FOUND` — 문제 없음
  - 502 `NOTE_EXTRACT_FAILED` — 엔진 실행 실패
  - 502 `NOTE_EXTRACT_PARSE_ERROR` — 결과 파싱 실패
- explain과 달리 **캐시 없음**: 기존 노트 내용이 계속 바뀌므로 매번 새로 추출한다.

## 4. 서버

새 파일 `src/server/note-extract-service.ts`:

```
extractNoteFromQuestion(questionId, engine) →
  1. question 조회 (없으면 404)
  2. 해당 topicId의 TopicNote 조회 — 없으면 빈 문자열
  3. buildNoteExtractPrompt(...)로 프롬프트 생성
  4. runEngine(engine, prompt, "generation_output/note-extracts/{questionId}-{engine}/")
  5. parseNoteTidyResult(extractJsonObject(resultText))로 파싱
  6. { engine, extracted } 반환
```

라우트 `src/app/api/questions/[id]/note-extract/route.ts`는 기존 explain 라우트와 동일한
thin-handler 패턴 (zod로 engine 검증 → 서비스 호출 → JSON 응답).

## 5. Core

새 파일 `src/core/note-extract-prompt.ts`:

- `buildNoteExtractPrompt(type, payload, explanation, currentNote, resultPath): string`
- 프롬프트 지시:
  - 문제(문항·선택지·정답·해설)에서 시험 대비에 가치 있는 핵심 포인트를 추출
  - 서비스 간 관계, 서비스 핵심 기능 중심의 간결한 마크다운 bullet
  - **기존 노트(currentNote)에 이미 있는 내용은 제외** — 새로운 포인트만
  - 기존 노트에 없는 새 포인트가 없으면 빈 문자열 노트 반환 허용
  - 결과를 `{"note": "..."}` JSON으로 resultPath에 저장

결과 파싱은 기존 `parseNoteTidyResult`(`src/core/note-tidy-result.ts`)를 재사용한다
(동일한 `{"note": string}` 형태). 단, 현재 파서는 빈 note를 실패로 처리하므로
`parseNoteTidyResult(rawText, options?: { allowEmpty?: boolean })` 옵션을 추가한다.
추출에서는 `allowEmpty: true`로 호출해 "새 포인트 없음"(빈 문자열)을 정상 결과로 받는다.
기존 tidy 호출부는 변경 없음 (기본값 false).

## 6. 프론트엔드

`src/lib/api-client.ts`의 `notes` 섹션에 추가:

- `extract(questionId, engine)` → `POST /api/questions/{id}/note-extract`

`src/components/NotePanel.tsx` 확장:

- `questionId: number` prop 추가 (학습 화면이 현재 문제 id 전달)
- 패널 하단에 "✨ AI 추출" 버튼 — 엔진 select는 기존 tidy와 공유
- 흐름: 클릭 → 동기 호출 로딩 표시("추출 중…", 버튼 disabled, 약 40초) →
  초안을 마크다운 미리보기로 표시 → "노트에 추가" / "닫기"
- "노트에 추가": 현재 노트 끝에 `\n\n` 구분으로 append 후 `api.notes.save` 호출,
  성공 시 `저장했습니다 ✅`
- "닫기": 초안 폐기, 상태 초기화
- 빈 노트에서도 추출 가능 (tidy와 달리 disabled 아님)
- 추출된 새 포인트가 없으면(빈 문자열) "추가할 새 내용이 없습니다" 안내

`src/lib/api-types.ts`에 `NoteExtractDto { engine, extracted }` 추가.

## 7. 에러 처리

- 엔진 실패·파싱 실패: 502 에러 메시지를 패널에 표시, 초안 없이 재시도 가능
- 호출 중 패널을 닫으면 결과는 사라짐 (동기 방식의 의도된 트레이드오프)
- append 저장 실패 시 초안을 유지해 재시도 가능

## 8. 테스트

- `src/core/note-extract-prompt.test.ts` — 프롬프트에 문항·선택지·정답·해설·기존 노트·
  resultPath 포함 여부, 빈 노트 처리 (vitest, TDD)
- `NotePanel.test.tsx`에 추출 흐름 테스트 추가 (초안 표시, append 저장, 실패 시 재시도)
- API는 curl 수동 검증 (프로젝트 컨벤션)
