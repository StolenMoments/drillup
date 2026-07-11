# 선지 난이도 올리기 (Choice Hardening) 설계

날짜: 2026-07-11

## 배경과 목적

학습 중 MCQ 문제를 풀다 보면 오답 선지가 너무 쉬워 정답이 빤히 보이는 경우가 있다.
학습 화면에서 AI 엔진(Claude / Codex / Antigravity)을 선택 호출해 오답 선지를 더
어려운 오답으로 교체한 수정본을 받고, 미리보기를 확인한 뒤 문제에 적용할 수 있게 한다.

## 확정된 요구사항

- 호출 시점: 채점 후 결과 패널(ResultPanel)에서. 문제 카드에서는 호출하지 않는다.
- 대상 유형: MCQ만. CLOZE는 범위 밖 (필요해지면 추후 확장).
- 수정 범위: 오답 선지만 교체한다. 질문 텍스트, 정답 선지 텍스트, 선지 개수,
  `answer_indices`는 불변이다.
- 적용 방식: 미리보기를 보여주고 사용자가 "적용하기"를 눌러야 반영한다. 자동 적용 없음.
- 미리보기는 DB에 저장하지 않는다(해설과 달리 캐시 없음). 같은 문제에 대해 다른
  엔진으로 재시도할 수 있다.

## 전체 흐름

1. 학습 화면에서 채점 완료 → MCQ 문제이면 ResultPanel에 "🎯 선지 난이도 올리기"
   섹션 표시 (AI 해설 섹션과 같은 엔진 버튼 3개 패턴).
2. 엔진 버튼 클릭 → `POST /api/questions/[id]/harden-choices` `{ engine }`.
3. 서버: 문제 로드(MCQ 확인) → 토픽명 조회 → 전용 프롬프트 빌드 →
   `runEngine`으로 CLI 엔진 실행 (`generation_output/harden/{questionId}-{engine}/`) →
   결과 JSON 파싱·기계 검증 → 미리보기 DTO 반환. 이 단계에서 DB 저장 없음.
4. 클라이언트: 미리보기 표시 (수정 이유 comment, 정답 선지 "유지 ✅", 교체된 오답은
   기존 텍스트 취소선 → 새 텍스트).
5. "✅ 적용하기" 클릭 → 기존 `PATCH /api/questions/[id]`로 payload 교체
   (explanation은 기존 값 유지). 현재 화면의 카드는 갱신하지 않고 다음 학습부터
   새 선지가 나온다.

## 데이터 계약 (엔진 출력 JSON)

```json
{
  "comment": "어떤 오답을 왜 교체했는지",
  "revised": {
    "question": "원본과 동일해야 함",
    "choices": ["..."],
    "answer_indices": [0],
    "choice_explanations": ["선지별 판단 근거"]
  }
}
```

## 서버 기계 검증 규칙

프롬프트 지시만 믿지 않고 아래를 코드로 강제한다. 하나라도 어기면 요청 실패(502).

- `revised.question` 텍스트가 원본과 동일하다.
- `revised.answer_indices`가 원본의 정답 인덱스 집합(레거시 `answer_index` 포함
  해석: `mcqAnswerIndices` 기준)과 동일하다.
- 선지 개수가 원본과 동일하다.
- 정답 인덱스 위치의 선지 텍스트가 원본과 글자 단위로 동일하다.
- 선지 중복이 없다.
- 오답 선지 중 최소 1개는 실제로 변경되었다.
- `choice_explanations` 개수가 선지 개수와 같다.

## 코드 구성

| 파일 | 작업 |
|---|---|
| `src/core/prompt-template.ts` | `buildChoiceHardeningPrompt(topicName, payload, resultPath)` 추가. 기존 `EXAM_MCQ_RULES`(그럴듯한 오해·부분 정답·제약 하나 누락형 오답, giveaway 표현 금지)와 웹 검증 섹션(`webVerificationSection`)을 재사용하고 불변 조건을 명시. 결과는 stdout이 아닌 `resultPath` 파일로 저장하도록 지시 (기존 관례) |
| `src/core/harden-schema.ts` (신규) | `parseHardenJson(rawText, originalPayload)` 순수 함수. zod 파싱 + 위 기계 검증. 성공 시 `{ ok: true, comment, payload: McqPayload }`, 실패 시 `{ ok: false, fatal: 사유 }` (기존 `revision-schema.ts` 결과 형태 관례) |
| `src/server/choice-hardening-service.ts` (신규) | explanation-service와 동일 패턴: 문제 로드 → MCQ 아니면 400 → 토픽명 조회 → 프롬프트 빌드 → `runEngine` → `extractJsonObject` → 파싱·검증 → 미리보기 반환 |
| `src/app/api/questions/[id]/harden-choices/route.ts` (신규) | `POST { engine: "CLAUDE" \| "CODEX" \| "ANTIGRAVITY" }`. explain 라우트와 동일 구조 |
| `src/server/question-service.ts` | `updateQuestion`에서 payload 갱신과 `answerExplanation.deleteMany({ where: { questionId } })`를 트랜잭션으로 묶음. 선지가 바뀌면 캐시된 해설이 틀린 내용이 되므로, 문제 상세 페이지 수동 편집에도 동일하게 적용되는 개선 |
| `src/lib/api-types.ts` | `HardenPreviewDto { engine, comment, payload }` 추가 |
| `src/lib/api-client.ts` | `api.questions.hardenChoices(id, engine)` 추가 |
| `src/components/ResultPanel.tsx` | 아래 UI 섹션 추가 |

## UI (ResultPanel)

- MCQ 문제일 때만 "🎯 선지 난이도 올리기" 섹션을 노출한다.
- 상태 머신: `idle → loading → preview → applied / error`.
- 엔진 버튼 3개 (해설 버튼과 같은 스타일). 미리보기 상태에서도 다른 엔진으로 재요청
  가능하며 마지막 미리보기만 유지한다.
- 미리보기 카드: comment + 선지 비교 목록. 정답 선지는 "유지 ✅", 교체된 오답은
  기존 텍스트(취소선) → 새 텍스트.
- "✅ 적용하기" 버튼 → `PATCH /api/questions/[id]` → 성공 시
  "적용됨 — 다음 학습부터 새 선지가 나옵니다 🎉" 안내와 함께 버튼 비활성화.
- 실패 시 ❌ 메시지 표시, 재시도 가능.

## 에러 처리

- 엔진 실행 실패: `HARDEN_FAILED` 502 (`EXPLANATION_FAILED` 패턴).
- JSON 파싱/검증 위반: `HARDEN_PARSE_ERROR` 502, 위반 사유 포함
  (예: "정답 선지가 변경되었습니다").
- CLOZE 문제로 호출: `VALIDATION` 400.
- 적용(PATCH) 실패: 기존 에러 처리 재사용.

## 테스트 (vitest)

- `src/core/harden-schema.test.ts`: 정상 통과 / 정답 텍스트 변경 감지 /
  answer_indices 변경 감지 / 선지 개수 불일치 / 중복 선지 / 오답 미변경 /
  choice_explanations 개수 불일치 / 레거시 `answer_index` 원본 처리.
- `src/core/prompt-template.test.ts`: 불변 조건 문구와 원본 문제 JSON 포함 여부.
- `src/server/question-service.test.ts`: payload 갱신 시 해설 캐시 삭제 확인.

## 범위 밖

- CLOZE distractor 강화.
- 수정 이력/되돌리기(undo).
- 자유 텍스트 추가 지시 입력.
- 선지 개수 변경(4→5개 등).
