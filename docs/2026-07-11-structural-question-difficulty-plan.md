# 구조적 난이도 기반 AI 문제 생성 구현 계획

> 구현자는 작업 시작 전에 `AGENTS.md`, `docs/2026-07-11-structural-question-difficulty-spec.md`, 현재 `src/core/prompt-template.ts`, `src/server/generation/generation-service.ts`를 읽는다. 저장소 지침에 따라 `master`에서 작업하고 태스크마다 한국어 conventional commit을 하나씩 만든다.

**Goal:** 정답률을 사용하지 않고, 출제 설계표와 결정적 구조 게이트를 이용해 Professional 수준의 경쟁력 있는 선지를 생성한다.

**Architecture:** 기존 단일 생성 호출을 `설계표 생성 → 순수 TS 난이도 평가 → 설계표 기반 문항 작성 → 설계표 대조 검증`으로 분리한다. DB와 API/UI 형식은 바꾸지 않으며 기존 생성 잡의 검증·자동 수정·승인 흐름을 재사용한다.

**Tech Stack:** TypeScript strict, zod 4, vitest 4, Prisma 7, 기존 CLI 엔진 실행기

## 전역 제약

- `src/core/`는 순수 TypeScript로 유지한다. Node, Prisma, Next.js API를 import하지 않는다.
- `any`를 사용하지 않는다. JSON/Prisma 경계의 캐스팅은 기존 규칙을 따른다.
- 기존 문제 저장 형식, API DTO, 생성 잡 UI를 변경하지 않는다.
- 사용자 정답률, LLM 반복 풀이 결과, 합의율을 구현하지 않는다.
- 설계표의 구조 검사는 LLM 판정이 아니라 순수 함수로 결정한다.
- 참고 자료에 없는 서비스 사실을 코드에 하드코딩하지 않는다.
- 기존 생성 결과와 수동 임포트 호환성을 유지한다.
- 각 태스크 종료 시 지정 테스트를 실행하고 한 개의 커밋을 만든다.

## 파일 지도

```text
docs/
  2026-07-11-structural-question-difficulty-spec.md
  2026-07-11-structural-question-difficulty-plan.md
src/core/
  question-blueprint.ts                 # 신규: 설계표 zod 스키마/파서
  question-blueprint.test.ts            # 신규
  question-difficulty.ts                # 신규: 구조 게이트/레벨
  question-difficulty.test.ts           # 신규
  prompt-template.ts                    # 수정: 설계표/작성/검증/수정 프롬프트
  prompt-template.test.ts               # 수정
  verify-schema.ts                      # 수정: violation_codes 선택 필드
  verify-schema.test.ts                 # 수정
src/server/generation/
  generation-service.ts                 # 수정: 다단계 생성 orchestration
  generation-service.test.ts            # 수정
  run-engine.ts                         # 원칙적으로 변경 없음
```

---

## Task 1: 출제 설계표 스키마와 파서

**Files:**

- Create: `src/core/question-blueprint.ts`
- Create: `src/core/question-blueprint.test.ts`

### 인터페이스

스펙 5장의 타입을 구현하고 다음 함수를 export한다.

```ts
export type BlueprintParseResult =
  | { ok: true; blueprints: QuestionBlueprint[] }
  | { ok: false; fatal: string };

export function parseQuestionBlueprintJson(rawText: string): BlueprintParseResult;
```

- [ ] 정상 envelope와 모든 중첩 필드를 파싱하는 실패 테스트를 작성한다.
- [ ] JSON이 아닌 입력과 `blueprints` 누락 테스트를 작성한다.
- [ ] 빈 `statement`, 빈 `solution`, 허용하지 않는 constraint kind를 거부하는 테스트를 작성한다.
- [ ] 설계표 내부의 `referenceFacts`, `constraints`, `choices`, `reasoningSteps` 최소 배열 조건을 테스트한다.
- [ ] `npx vitest run src/core/question-blueprint.test.ts`가 실패하는지 확인한다.
- [ ] zod 스키마와 파서를 구현한다.
- [ ] id는 공백이 아닌 문자열, `correct`는 boolean, 모든 문자열 배열은 공백 항목을 허용하지 않게 한다.
- [ ] 중복 id와 교차 참조의 유효성은 Task 2 평가기로 넘기고 파서는 JSON 형태와 로컬 필드 형식에 집중한다.
- [ ] 대상 테스트를 통과시킨다.
- [ ] `npx tsc --noEmit`을 실행한다.
- [ ] 커밋: `feat: 출제 설계표 스키마와 파서 추가`

---

## Task 2: 결정적 구조 난이도 평가기

**Files:**

- Create: `src/core/question-difficulty.ts`
- Create: `src/core/question-difficulty.test.ts`

### 인터페이스

```ts
export interface DifficultyViolation {
  code: string;
  message: string;
  choiceId?: string;
}

export interface DifficultyAssessment {
  pass: boolean;
  level: 1 | 2 | 3 | 4 | 5;
  violations: DifficultyViolation[];
  metrics: {
    constraintCount: number;
    uniqueServiceCount: number;
    referenceFactCount: number;
    reasoningStepCount: number;
    closeDistractorCount: number;
  };
}

export function assessQuestionBlueprint(
  blueprint: QuestionBlueprint,
): DifficultyAssessment;
```

### 권장 위반 코드

```text
CONSTRAINT_COUNT
REFERENCE_FACT_COUNT
UNKNOWN_FACT_REFERENCE
CHOICE_COUNT
ANSWER_COUNT
CORRECT_CHOICE_MISSES_CONSTRAINT
CORRECT_CHOICE_HAS_VIOLATION
DISTRACTOR_HAS_NO_VIOLATION
CLOSE_DISTRACTOR_COUNT
UNKNOWN_CONSTRAINT_REFERENCE
CONSTRAINT_BOTH_SATISFIED_AND_VIOLATED
SERVICE_DIVERSITY
EMPTY_TESTED_DISTINCTION
EMPTY_MISCONCEPTION
REASONING_STEP_COUNT
DUPLICATE_ID
```

- [ ] 재사용 가능한 레벨 4 정상 fixture를 테스트 파일에 만든다.
- [ ] 스펙 6.1의 12개 필수 조건 각각에 대해 최소 한 개의 실패 테스트를 작성한다.
- [ ] 정답 1개와 정답 2개가 통과하고 정답 0개/3개가 실패하는지 테스트한다.
- [ ] 근접 오답을 `violatedConstraintIds.length === 1`이고 나머지 모든 제약을 충족하는 오답으로 계산한다.
- [ ] 레벨 4와 레벨 5 계산 테스트를 작성한다.
- [ ] 대상 테스트가 실패하는지 확인한다.
- [ ] 평가기를 구현한다. 모든 위반을 한 번에 수집하고 첫 오류에서 반환하지 않는다.
- [ ] 서비스 이름은 trim 후 대소문자를 보존한 문자열 기준으로 중복 제거한다.
- [ ] `pass`는 위반이 없고 레벨이 4 이상일 때만 true로 설정한다.
- [ ] 대상 테스트와 `npx tsc --noEmit`을 통과시킨다.
- [ ] 커밋: `feat: 구조적 문제 난이도 게이트 추가`

---

## Task 3: 생성 프롬프트 계약 정리

**Files:**

- Modify: `src/core/prompt-template.ts`
- Modify: `src/core/prompt-template.test.ts`

### 먼저 제거할 충돌

- 공통 JSON 예시의 MCQ 필드를 `answer_indices`로 통일한다.
- CLI 생성 프롬프트에서 CLOZE 예시와 "두 유형을 섞어서 출제" 규칙을 제거한다.
- 규칙에 남은 `answer_index` 표현을 `answer_indices`로 고친다.
- 생성, 검증, 수정 프롬프트에서 동일한 `EXAM_MCQ_RULES`를 재사용한다.

수동 임포트나 CLOZE 타입 자체는 삭제하지 않는다. CLI 문제 생성 계약만 MCQ 전용으로 분리한다. 필요하면 `manualImportPromptBody()`와 `cliMcqOutputContract()`처럼 템플릿 함수를 나눈다.

- [ ] 현재 충돌 문자열을 검출하는 회귀 테스트를 작성한다.
- [ ] `buildGenerationPrompt()`와 `buildCliGenerationPrompt()`의 공개 동작을 확인하고 기존 테스트를 깨지 않는 최소 분리를 설계한다.
- [ ] CLI 출력 계약에 `answer_indices`, `choice_explanations`, `keywords`가 포함되는지 테스트한다.
- [ ] CLI 출력 계약에 CLOZE 혼합 지시와 과거 `answer_index` 규칙이 없는지 테스트한다.
- [ ] 프롬프트를 정리하고 전체 `prompt-template.test.ts`를 통과시킨다.
- [ ] `npx tsc --noEmit`을 실행한다.
- [ ] 커밋: `fix: AI 객관식 생성 프롬프트 계약 통일`

---

## Task 4: 설계표 생성 프롬프트

**Files:**

- Modify: `src/core/prompt-template.ts`
- Modify: `src/core/prompt-template.test.ts`

### 신규 함수

```ts
export function buildCliQuestionBlueprintPrompt(
  topicName: string,
  instructions: string,
  resultPath: string,
  existing: ExistingQuestions,
  referenceFiles?: string[],
  existingKeywords?: string[],
  variantSources?: VariantSource[],
): string;
```

프롬프트는 다음을 명시한다.

- 최종 문제 문장을 쓰지 않고 설계표만 작성한다.
- 선택 참고 파일을 먼저 읽고 모든 `referenceFacts.sourceFile`에 실제 전달 경로를 사용한다.
- confusion set은 같은 시나리오의 현실적인 후보들로 구성한다.
- 독립 제약 3~5개, 근접 오답 최소 2개를 만든다.
- 정답을 먼저 정한 뒤 무관한 오답을 채우지 않는다.
- 설계표 출력 스키마와 결과 파일 경로를 준수한다.
- 추가 지시의 문제 수를 그대로 따른다.
- 기존 문제와 같은 `testedDistinction` 및 시나리오를 피한다.

- [ ] 참고 파일, 기존 문제, 키워드, 변형 원본, 추가 지시가 각각 있을 때 포함되는 테스트를 작성한다.
- [ ] 선택 인자가 비어 있을 때 불필요한 섹션이 생기지 않는 테스트를 작성한다.
- [ ] 설계표 JSON 예시가 `QuestionBlueprint` 스키마와 일치하는지 테스트 fixture로 검증한다.
- [ ] 함수를 구현하고 대상 테스트를 통과시킨다.
- [ ] 커밋: `feat: 출제 설계표 생성 프롬프트 추가`

---

## Task 5: 설계표 기반 문항 작성 프롬프트

**Files:**

- Modify: `src/core/prompt-template.ts`
- Modify: `src/core/prompt-template.test.ts`

### 신규 함수

```ts
export function buildCliGenerationFromBlueprintPrompt(
  topicName: string,
  blueprints: QuestionBlueprint[],
  resultPath: string,
  referenceFiles?: string[],
): string;
```

요구 사항:

- 설계표 배열 순서와 최종 문제 배열 순서를 동일하게 유지한다.
- 문항 수와 설계표 수를 동일하게 유지한다.
- 설계표의 정답, 제약, 서비스, 사실 관계를 변경하지 않는다.
- 내부 `correct`, 충족/위반 제약, 오개념 메타데이터를 문제에 노출하지 않는다.
- 시나리오에는 모든 독립 제약을 자연스럽게 포함한다.
- 선지는 유사한 길이, 문법 구조, 구체성, 아키텍처 수준으로 작성한다.
- 출력은 기존 `{ "questions": [...] }` 형식이다.

- [ ] 전체 설계표 JSON이 프롬프트에 포함되는 테스트를 작성한다.
- [ ] 출력 계약에 MCQ 전용 필드가 포함되는 테스트를 작성한다.
- [ ] 배열 순서/개수 유지와 메타데이터 비노출 지시를 테스트한다.
- [ ] 함수를 구현하고 대상 테스트를 통과시킨다.
- [ ] 커밋: `feat: 설계표 기반 문제 작성 프롬프트 추가`

---

## Task 6: 검증 응답 스키마 확장

**Files:**

- Modify: `src/core/verify-schema.ts`
- Modify: `src/core/verify-schema.test.ts`

- [ ] `violation_codes?: string[]`를 입력에서 허용하는 테스트를 작성한다.
- [ ] 기존 응답처럼 필드가 없어도 정상 파싱되는 회귀 테스트를 유지한다.
- [ ] 빈 문자열 코드는 제거하거나 거부하는 정책을 하나로 정하고 테스트한다. 권장: trim 후 빈 값 제거, 중복 제거.
- [ ] `VerifyVerdict`에 `violationCodes: string[]`를 추가한다.
- [ ] `mergeVerdicts()`의 기존 최종 항목 형식을 바꾸지 않는다. 위반 코드는 검증 로그와 자동 수정 지시에만 사용하고 DB 결과 DTO 확장은 이번 범위에서 제외한다.
- [ ] 구현 후 대상 테스트와 TypeScript 검사를 통과시킨다.
- [ ] 커밋: `feat: 문제 검증 위반 코드 파싱 추가`

---

## Task 7: 설계표 대조 검증·수정 프롬프트

**Files:**

- Modify: `src/core/prompt-template.ts`
- Modify: `src/core/prompt-template.test.ts`

기존 함수를 호환 가능한 방식으로 확장한다.

```ts
export function buildCliVerifyPrompt(
  topicName: string,
  items: Array<{ index: number; question: unknown; blueprint?: QuestionBlueprint }>,
  resultPath: string,
  referenceFiles?: string[],
): string;

export function buildCliRevisionPrompt(
  topicName: string,
  question: unknown,
  instructions: string,
  resultPath: string,
  referenceFiles?: string[],
  blueprint?: QuestionBlueprint,
): string;
```

- [ ] blueprint가 있을 때 문항별 설계표가 검증 프롬프트에 포함되는 테스트를 작성한다.
- [ ] blueprint가 없을 때 기존 수동 수정/호출 동작이 유지되는 테스트를 작성한다.
- [ ] 표현상 단서 5종, 장식성 제약, 설계표 정답·제약 불변 기준이 포함되는지 테스트한다.
- [ ] 수정 프롬프트가 설계표의 사실/정답/제약 변경을 금지하는지 테스트한다.
- [ ] 검증 출력 예시에 `violation_codes`를 추가한다.
- [ ] 구현하고 대상 테스트를 통과시킨다.
- [ ] 커밋: `feat: 설계표 대조 문제 검증 프롬프트 추가`

---

## Task 8: 생성 서비스에 다단계 파이프라인 연결

**Files:**

- Modify: `src/server/generation/generation-service.ts`
- Modify: `src/server/generation/generation-service.test.ts`

### 권장 내부 헬퍼

복잡도를 줄이기 위해 다음 private 헬퍼를 분리한다.

```ts
async function generateBlueprints(...): Promise<{
  blueprints: QuestionBlueprint[];
  warning: string | null;
}>;

async function repairBlueprintsOnce(...): Promise<QuestionBlueprint[]>;

function formatDifficultyViolations(
  assessments: DifficultyAssessment[],
): string;
```

### 실행 순서

1. `blueprint-result.json` 경로를 만든다.
2. 설계표 프롬프트를 생성해 `runEngine()`을 호출한다. prefix는 `blueprint-`를 사용한다.
3. `extractJsonObject()`와 `parseQuestionBlueprintJson()`으로 파싱한다.
4. 모든 설계표에 `assessQuestionBlueprint()`를 실행한다.
5. 탈락 항목이 있으면 위반 사항과 원본 설계표를 넣은 수정 프롬프트로 한 번만 재실행한다.
6. 수정 결과는 탈락 항목의 id와 대응되는 항목만 교체한다. 요청하지 않은 신규 id는 버린다.
7. 여전히 탈락한 항목을 제외한다. 하나도 남지 않으면 잡을 실패 처리한다.
8. 통과 설계표로 단계 B 프롬프트를 만들고 기존 생성 엔진을 실행한다.
9. 파싱된 최종 문항 수가 설계표 수와 다르면 잡을 실패 처리한다.
10. 기존 `validateGeneratedQuestions()`와 선지 셔플을 적용한다.
11. 선지를 셔플하더라도 설계표 대조가 깨지지 않게 주의한다. 권장 방식은 검증 완료 후에만 셔플하거나, 검증 프롬프트에는 셔플된 문항과 의미 기반 설계표를 전달하고 인덱스 일치를 요구하지 않는 것이다.
12. 검증 프롬프트에 각 문항과 배열상 대응 설계표를 전달한다.
13. 자동 수정에도 같은 설계표를 전달한다.
14. 기존 DB `result`, `rawOutput`, 상태 전이와 승인 동작을 유지한다.

### 상태 전이

기존 DB enum을 변경하지 않는다.

```text
RUNNING
  ├─ 설계표 생성
  ├─ 구조 게이트/1회 수정
  └─ 최종 문항 생성
VERIFYING
  ├─ 설계표 대조 검증
  └─ 기존 1회 자동 수정/재검증
SUCCEEDED | FAILED
```

- [ ] `runEngine`을 mock해 호출 순서를 검증하는 테스트를 작성한다.
- [ ] 첫 설계표가 통과하는 정상 흐름을 테스트한다.
- [ ] 첫 설계표가 실패하고 1회 수정 후 통과하는 흐름을 테스트한다.
- [ ] 일부만 통과할 때 통과 항목만 단계 B로 전달되고 warning이 남는지 테스트한다.
- [ ] 전부 실패, 설계표 파싱 실패, 최종 문항 수 불일치가 잡 실패로 이어지는지 테스트한다.
- [ ] 검증과 자동 수정에 정확한 대응 설계표가 전달되는지 테스트한다.
- [ ] 기존 생성 서비스 테스트 전체를 통과시킨다.
- [ ] 커밋: `feat: 구조적 난이도 기반 문제 생성 파이프라인 적용`

---

## Task 9: 회귀 테스트와 산출물 검증

**Files:**

- Modify only files required to fix defects found by verification

- [ ] `npx vitest run src/core/question-blueprint.test.ts src/core/question-difficulty.test.ts src/core/prompt-template.test.ts src/core/verify-schema.test.ts src/server/generation/generation-service.test.ts`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] 테스트 주제로 AI 생성 잡을 1회 실행한다.
- [ ] `generation_output/jobs/<id>/blueprint-result.json`에 설계표가 남는지 확인한다.
- [ ] 각 문제에 독립 제약 3개 이상, 근접 오답 2개 이상, 고유 서비스·기능 3개 이상이 있는지 설계표에서 확인한다.
- [ ] 최종 문제의 모든 선지가 비슷한 구체성과 아키텍처 수준인지 수동 확인한다.
- [ ] 정답만 관리형이고 오답은 전부 수동 구현인 패턴이 없는지 확인한다.
- [ ] 기존 생성 잡 목록, 상세, 승인, 문제 저장이 정상 동작하는지 확인한다.
- [ ] 검증 중 발견한 결함만 수정하고 관련 테스트를 추가한다.
- [ ] 커밋: `test: 구조적 난이도 생성 파이프라인 회귀 검증`

## 구현 완료 체크리스트

- [ ] 문제 생성 전에 구조화된 설계표가 생성된다.
- [ ] 구조 게이트는 순수 TS이며 사용자/LLM 정답률을 사용하지 않는다.
- [ ] 근접 오답 최소 2개와 독립 제약 최소 3개가 강제된다.
- [ ] 통과하지 못한 설계표는 한 번만 수정되고 그래도 실패하면 제외된다.
- [ ] 최종 문항은 대응 설계표와 함께 검증·수정된다.
- [ ] 기존 API, UI, DB 스키마와 문제 저장 형식이 유지된다.
- [ ] 프롬프트의 `answer_index`/`answer_indices`, MCQ/CLOZE 상충 지시가 제거된다.
- [ ] 전체 테스트, lint, TypeScript 검사, build가 통과한다.
- [ ] 태스크별 한국어 conventional commit이 남아 있다.

