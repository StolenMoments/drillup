# AI 생성 문제 교차 검증 + 중복 방지 설계

날짜: 2026-07-08
상태: 승인됨
선행 문서: `2026-07-08-ai-generation-design.md` (기존 /generate 파이프라인)

## 1. 목표

기존 AI 문제 생성(`/generate`) 파이프라인에 두 가지를 추가한다.

1. **교차 검증**: 생성 CLI가 만든 문제를, 화면에서 선택한 다른 엔진의 CLI를 다시 호출해 검증한다. 기준은 ① 정답 정확성(정답이 사실적으로 맞는가, answer_index가 실제 정답 보기를 가리키는가) ② 문제 품질(질문 명확성, 보기 중 복수 정답 소지, 해설 타당성).
2. **중복 방지**: 같은 주제의 기존 DB 문제 목록을 생성 프롬프트에 포함해 중복 출제를 예방한다(프롬프트 예방만, 코드 레벨 차단 없음).

핵심 결정 사항:

- **구조**: 별도 검증 잡을 만들지 않고 기존 `GenerationJob` 단일 잡을 2단계로 확장 (`RUNNING → VERIFYING → SUCCEEDED/FAILED`)
- **검증 실행**: 생성 직후 자동. 검증 엔진은 화면 라디오로 선택 (기본값: 생성 엔진과 다른 것, 같은 엔진 선택도 허용)
- **불합격 처리**: 자동 제외하지 않음. 미리보기에 검증 사유와 함께 표시하고 기본 체크만 해제 — 최종 판단은 사람
- **검증 실패는 잡 실패가 아님**: 검증 CLI가 죽어도 생성 결과는 SUCCEEDED로 마무리하고 전 항목 "검증 미수행" 표시
- **중복 방지 범위**: 프롬프트 예방만. 검증 단계 판정 기준에 중복은 포함하지 않고, 저장 시점 코드 차단도 하지 않음

## 2. 데이터 모델과 상태 흐름

`GenerationJob`에 추가 (새 모델 없음):

```prisma
// GenerationStatus enum에 VERIFYING 추가
enum GenerationStatus {
  RUNNING
  VERIFYING
  SUCCEEDED
  FAILED
}

model GenerationJob {
  // ...기존 필드...
  verifyEngine  GenerationEngine @map("verify_engine")
  verifyWarning String?          @map("verify_warning") @db.Text
}
```

상태 흐름:

```
RUNNING    생성 CLI 실행 중
VERIFYING  생성 결과 파싱 성공, 항목 저장 완료, 검증 CLI 실행 중
SUCCEEDED  검증 병합 완료 (검증 실패 시에도 unverified로 마무리)
FAILED     생성 자체가 실패했을 때만
```

`result`에 저장하는 항목 구조 확장:

```ts
// 스키마 유효 항목
{ index: number, ok: true, question: unknown,
  verdict: "pass" | "fail" | "unverified",
  verdictComment: string | null }  // fail이면 사유, pass여도 의견 있으면 저장
// 스키마 무효 항목 (기존과 동일, 검증 대상 아님)
{ index: number, ok: false, errors: string[] }
```

## 3. 검증 CLI 단계 (`runJob` 확장)

생성 결과 파싱이 성공하면:

1. 잡을 `VERIFYING`으로 업데이트하고 항목을 저장 (이 시점 verdict는 전부 `unverified`)
2. 검증 프롬프트 조립 — `src/core/prompt-template.ts`에 `buildCliVerifyPrompt` 추가:
   - 주제명 + 유효 항목들의 전체 내용(질문·보기·정답·해설)을 index 번호와 함께 나열
   - 판정 기준: ① 정답이 사실적으로 정확한가, answer_index가 실제 정답 보기와 일치하는가 ② 질문이 명확한가, 보기 중 복수 정답 소지는 없는가, 해설이 타당한가
   - 출력 규격: 아래 JSON을 `verify-result.json` 경로에 UTF-8 파일로만 저장 (stdout 출력 금지 — 생성 단계와 같은 파일 기반 방식)

     ```json
     { "verdicts": [{ "index": 0, "verdict": "pass", "comment": "간결한 사유" }] }
     ```

3. 기존 `runEngine`을 검증 엔진으로 재사용 — 출력 파일명만 다름. 잡 디렉터리(`generation_output/jobs/<jobId>/`)에 `verify-prompt.md`, `verify-result.json`, `verify-stdout.log`, `verify-stderr.log` 추가
4. 검증 결과 파싱 — `src/core/verify-schema.ts` (순수 TS): 관용적 JSON 추출(`extractJsonObject`) 재사용 → verdicts 배열 검증. index가 유효 항목과 안 맞거나 누락된 항목은 `unverified`로 남김
5. verdict를 항목에 병합(`mergeVerdicts(items, verdicts)` 순수 함수)해 `SUCCEEDED` 업데이트. 검증 CLI 실패/타임아웃/파싱 불가면 전 항목 `unverified` + 잡에 `verifyWarning` 메시지 저장 후 역시 `SUCCEEDED`

타임아웃은 생성과 검증 각각 독립 적용 (같은 `GENERATION_TIMEOUT_MS`, 기본 10분).

`getJob`의 고아 잡 안전망 확장: `RUNNING`/`VERIFYING` 모두 대상, 기준 시간은 `createdAt`으로부터 타임아웃 2배 + 유예. 판정 결과는 상태에 따라 다름 —

- `RUNNING` 고아 → FAILED ("시간 초과 또는 서버 재시작으로 중단")
- `VERIFYING` 고아 → 생성 결과는 이미 저장돼 있으므로 SUCCEEDED + 전 항목 `unverified` + `verifyWarning`

## 4. 중복 방지 (프롬프트 예방)

`createJob`에서 같은 주제의 기존 문제를 조회해 생성 프롬프트에 포함한다.

- **문제 요약**: `src/core/question-summary.ts` 순수 함수. mcq는 질문 텍스트, cloze는 `{{n}}` 빈칸을 정답 단어로 채운 문장으로 payload를 한 줄 요약
- **예산 제한**: 최신순 최대 100개, 요약 합계 8,000자 초과 시 그 앞에서 절단. 목록이 잘렸으면 프롬프트에 "이 외에도 기존 문제가 더 있음"을 명시
- **프롬프트 지시**: `buildCliGenerationPrompt`에 "## 기존 문제 (중복 금지)" 섹션 추가 — "아래 목록과 질문 내용이 같거나 표현만 바꾼 문제는 출제하지 말 것. 이번에 생성하는 문제들끼리도 중복 금지." 기존 문제가 0개면 배치 내 중복 금지 지시만 남김

## 5. API·DTO

API 개수는 그대로 2개.

- `POST /api/generate` 요청에 `verifyEngine: "CLAUDE" | "CODEX" | "ANTIGRAVITY"` 추가 (zod enum, 필수)
- `GenerationJobDto`에 추가:

```ts
verifyEngine: GenerationEngineDto;
verifyWarning: string | null;
// items의 ok:true 항목에 추가:
verdict: "pass" | "fail" | "unverified";
verdictComment: string | null;
```

- `GenerationStatusDto`에 `"VERIFYING"` 추가
- `items`는 기존과 동일하게 SUCCEEDED일 때만 채움 (VERIFYING 중에는 null — 화면은 진행 표시만 하면 됨)

## 6. 화면 (`/generate`)

- 2단계에 **검증 엔진 라디오** 추가. 기본값: 생성 엔진이 claude면 codex, 그 외엔 claude. 생성 엔진 변경 시 검증 기본값도 이 규칙으로 갱신하되, 사용자가 직접 바꾼 뒤에는 유지. 같은 엔진 선택도 허용
- 진행 표시: `RUNNING` → "생성 중... (경과 N초)", `VERIFYING` → "검증 중... (경과 N초)". 폴링 로직 그대로 (3초 간격, 두 상태 모두 계속 폴링)
- 미리보기 카드 배지:
  - `pass` → 기본 체크, ✅ "검증 통과" 배지 (+ comment 있으면 회색 보조 텍스트)
  - `fail` → **기본 체크 해제**, ⚠️ 배지 + 검증 사유를 카드 안 노란 박스로 표시. 체크해서 저장은 가능 (최종 판단은 사람)
  - `unverified` → 기본 체크, "검증 안 됨" 회색 배지
- `verifyWarning`이 있으면 미리보기 상단에 경고 한 줄: "⚠️ 검증을 수행하지 못했습니다: ..."
- 공용 `QuestionPreview` 컴포넌트는 그대로 두고, 배지·체크 초기값은 `/generate` 페이지 쪽에서 처리 (수동 `/import` 흐름에는 영향 없음)

## 7. 오류 처리

| 상황 | 처리 |
|---|---|
| 생성 CLI 실패 (기존과 동일) | FAILED |
| 검증 CLI 실행 파일 없음 / 타임아웃 / verify-result.json 미생성 | SUCCEEDED + 전 항목 `unverified` + `verifyWarning` |
| verdicts JSON 파싱 불가 | SUCCEEDED + 전 항목 `unverified` + `verifyWarning` |
| verdicts 일부 index 불일치·누락 | 매칭된 것만 병합, 나머지 `unverified` |
| 유효 항목이 0개 (전부 스키마 오류) | 검증 단계 생략, 바로 SUCCEEDED |
| `RUNNING` 고아 (서버 재시작) | FAILED (기존과 동일) |
| `VERIFYING` 고아 (서버 재시작) | SUCCEEDED + 전 항목 `unverified` + `verifyWarning` |

## 8. 테스트

vitest, core 단위 테스트만 자동화 (프로젝트 규약: 서비스 계층은 수동 검증).

- `prompt-template.test.ts` 확장 — 생성 프롬프트: 기존 문제 목록 포함/절단 표시/0개 케이스. 검증 프롬프트: 판정 기준·출력 규격·파일 경로·문제 내용 포함 여부
- `question-summary.test.ts` — mcq 질문 추출, cloze 빈칸 채움, 알 수 없는 payload 방어
- `verify-schema.test.ts` — verdicts 파싱: 정상, index 누락, verdict 오타, JSON 아님
- `merge-verdicts` 테스트 — pass/fail 병합, index 불일치 시 unverified 유지, ok:false 항목 무시

수동 검증: 실제 엔진 2개로 생성 → 검증 → 미리보기 배지(pass/fail/unverified) 확인 → 저장까지 브라우저로 1회.
