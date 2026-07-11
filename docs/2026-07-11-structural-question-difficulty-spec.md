# 구조적 난이도 기반 AI 문제 생성 스펙

날짜: 2026-07-11

상태: 구현 대기

## 1. 배경

현재 AI 문제 생성은 시나리오형 문항, 유사 오답, 단정적 표현 금지, 생성 후 교차 검증과 자동 수정까지 수행한다. 그러나 생성기가 정답을 먼저 고른 뒤 나머지 선지를 채우는 경향이 있어 다음 문제가 반복된다.

- 정답은 완전관리형 AWS 기능인데 오답은 수동 구축, 자체 개발, 명백히 목적이 다른 서비스로 구성된다.
- 서비스 이름은 여러 개 등장하지만 실제로는 하나의 키워드만 보고 정답을 고를 수 있다.
- 시나리오에 여러 요구 사항이 있어도 정답 판별에는 하나만 사용된다.
- 검증기가 사실 정확성만 확인하고 선지의 매력도와 추론 구조는 충분히 검사하지 못한다.
- 공식 샘플 참고 자료가 스타일 요약 위주라 완성된 선지 간 경쟁 구조가 생성 과정에 강제되지 않는다.

이 기능은 사용자 정답률, 다수 사용자 통계, 모의 응시 정답률을 사용하지 않는다. 난이도는 문제를 푼 결과가 아니라 문제를 구성하는 제약, 서비스 비교, 기능 관계, 오답의 근접성으로 정의한다.

## 2. 목표

AI 문제 생성을 다음 3단계로 분리한다.

1. **출제 설계표 생성**: 혼동 가능한 서비스·기능과 시나리오 제약을 먼저 구조화한다.
2. **구조적 난이도 게이트**: 순수 TypeScript 규칙으로 설계표를 검사한다.
3. **문항 작성 및 검증**: 통과한 설계표만 자연어 문제로 작성하고, 설계표와 최종 문항이 일치하는지 검증한다.

핵심 목표는 다음과 같다.

- 최소 2개의 오답이 요구 사항 대부분을 충족하지만 정확히 하나의 핵심 제약을 놓치게 한다.
- 정답 판단에 복수의 독립 제약과 복수의 서비스·기능 지식이 필요하게 한다.
- 모든 선지를 비슷한 구체성, 길이, 추상화 수준으로 작성한다.
- 정답만 관리형이고 오답은 전부 수동 구현인 비대칭을 방지한다.
- 기존 생성 잡, 참고 자료 선택, 검증 엔진, 승인 UI와 저장 형식은 유지한다.

## 3. 비목표

- 사용자 정답률이나 실제 풀이 이력에 기반한 난이도 추정
- LLM을 여러 번 응시시켜 정답 합의율을 계산하는 방식
- 문제별 난이도 DB 컬럼 또는 UI 필터 추가
- 참고 자료의 사실을 자동으로 갱신하거나 외부 검색 결과를 영구 저장
- 모든 자격시험에 공통으로 적용할 수 있는 서비스 혼동 목록을 코드에 하드코딩

## 4. 핵심 용어

### 4.1 Confusion set

같은 요구 사항에서 실제 수험자가 비교할 만한 서비스, 기능 또는 구성 방식의 집합이다. 단순히 이름이 비슷한 서비스가 아니라 동일한 문제 상황에서 후보가 될 수 있어야 한다.

예:

- 모델 호출 감사: CloudTrail, Bedrock 모델 호출 로깅, CloudWatch Logs, S3 Object Lock
- RAG 검색 품질: 시맨틱 검색, 하이브리드 검색, 메타데이터 필터링, 리랭킹
- 추론 배포: 실시간, 비동기식, 서버리스, 배치 추론
- 안전 제어: Bedrock Guardrails, IAM 조건 키, AWS WAF, Amazon Comprehend

Confusion set은 선택된 참고 자료에서 생성한다. 서비스 목록만 나열하지 않고 각 후보의 적용 조건, 한계, 인접 오개념을 함께 기록한다.

### 4.2 독립 제약

다른 제약과 같은 의미로 축약할 수 없고, 선지의 적합성을 별도로 바꿀 수 있는 요구 사항이다. 예를 들어 "운영 부담 최소화"와 "관리형 서비스 사용"은 같은 문항에서 독립 제약으로 중복 계산하지 않는다.

### 4.3 근접 오답

정답이 아닌 선지 중 다음 조건을 만족하는 선지다.

- 전체 핵심 제약 중 정확히 하나를 위반한다.
- 나머지 핵심 제약은 명시적으로 충족한다.
- 위반 이유가 참고 자료의 서비스 기능 또는 제한으로 설명된다.
- 무관하거나 터무니없는 서비스가 아니라 confusion set 안의 현실적인 후보를 사용한다.

### 4.4 구조적 난이도

정답률이 아니라 정답을 판별하기 위해 비교해야 하는 독립 제약, 서비스·기능, 사실 관계와 트레이드오프의 수로 정의한다.

## 5. 출제 설계표 데이터 모델

신규 순수 TS 모듈 `src/core/question-blueprint.ts`에 zod 스키마와 타입을 정의한다.

```ts
export interface BlueprintReferenceFact {
  id: string;
  statement: string;
  sourceFile: string;
}

export interface BlueprintConstraint {
  id: string;
  statement: string;
  kind: "FUNCTIONAL" | "SECURITY" | "PERFORMANCE" | "COST" | "OPERATIONS" | "INTEGRATION" | "COMPLIANCE";
  factIds: string[];
}

export interface BlueprintChoice {
  id: string;
  solution: string;
  serviceNames: string[];
  satisfiedConstraintIds: string[];
  violatedConstraintIds: string[];
  misconception: string;
  correct: boolean;
}

export interface QuestionBlueprint {
  id: string;
  domainTask: string;
  testedDistinction: string;
  referenceFacts: BlueprintReferenceFact[];
  constraints: BlueprintConstraint[];
  choices: BlueprintChoice[];
  reasoningSteps: string[];
}

export interface QuestionBlueprintEnvelope {
  blueprints: QuestionBlueprint[];
}
```

파서 시그니처:

```ts
export type BlueprintParseResult =
  | { ok: true; blueprints: QuestionBlueprint[] }
  | { ok: false; fatal: string };

export function parseQuestionBlueprintJson(rawText: string): BlueprintParseResult;
```

파서는 형식만 검증한다. 난이도 규칙은 별도 평가 함수가 담당한다.

## 6. 구조적 난이도 게이트

`src/core/question-difficulty.ts`에 순수 함수로 구현한다.

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

### 6.1 필수 통과 조건

모든 조건을 만족해야 한다.

1. 독립 제약이 3~5개다.
2. 참고 사실이 2개 이상이고 모든 제약은 하나 이상의 참고 사실을 가리킨다.
3. 선지는 4~6개다.
4. 정답 선지는 1개 또는 2개다.
5. 정답 선지는 모든 제약을 충족하고 위반 제약이 없다.
6. 근접 오답이 최소 2개다.
7. 모든 오답은 하나 이상의 제약을 위반한다.
8. 모든 선지는 하나 이상의 서비스·기능 이름을 가진다.
9. 전체 선지에 등장하는 고유 서비스·기능은 최소 3개다.
10. 모든 `factIds`, `satisfiedConstraintIds`, `violatedConstraintIds` 참조가 실제 id와 일치한다.
11. 한 선지가 같은 제약을 충족과 위반에 동시에 포함하지 않는다.
12. `testedDistinction`, `misconception`, `reasoningSteps`는 비어 있지 않는다.

### 6.2 구조적 난이도 레벨

레벨은 통계가 아닌 구조적 지표로 결정한다.

| 레벨 | 기준 |
|---|---|
| 1 | 단일 서비스 정의 또는 단일 사실 회상으로 해결 가능 |
| 2 | 2개 후보의 한 가지 기능 차이를 비교 |
| 3 | 3개 독립 제약 또는 3개 서비스·기능을 비교 |
| 4 | 3개 이상 독립 제약, 근접 오답 2개 이상, 참고 사실 2개 이상, 추론 단계 2개 이상 |
| 5 | 레벨 4 충족 + 서비스 조합 비교, 우선순위 또는 트레이드오프 판단, 추론 단계 3개 이상 |

생성 파이프라인에는 레벨 4 이상만 허용한다. 레벨 계산은 설명용이며 필수 통과 조건을 우회할 수 없다.

### 6.3 표현상 단서

표현상 단서는 최종 문항 작성 후 검증한다. 다음 항목이 있으면 fail이다.

- 정답만 다른 선지보다 현저하게 길거나 구체적이다.
- 정답만 시나리오의 요구 사항을 같은 어휘와 순서로 반복한다.
- 오답에만 `직접 구축`, `수동`, `자체 개발`, `무조건` 같은 약점 표현이 집중된다.
- 선지마다 아키텍처 수준이 다르다. 예: 한 선지는 서비스 하나, 다른 선지는 완성된 다단계 구성.
- 서비스 이름을 가리더라도 긍정적·부정적 어조만으로 정답을 찾을 수 있다.

문자열 길이 차이만으로 자동 탈락시키지는 않는다. 검증 엔진이 설계표와 최종 문항을 함께 보고 판단한다.

## 7. 생성 파이프라인

### 7.1 단계 A: 출제 설계표 생성

`buildCliQuestionBlueprintPrompt()`를 추가한다.

입력:

- 주제명
- 사용자 추가 지시
- 요청 문제 수
- 기존 문제 요약
- 선택된 참고 자료 절대 경로
- 기존 키워드
- 변형 출제 원본 문제
- 결과 파일 경로

생성기는 참고 자료를 읽고 문제마다 다음 순서로 설계한다.

1. 출제 범위에 맞는 `testedDistinction`을 선택한다.
2. 동일한 상황에서 비교 가능한 confusion set을 만든다.
3. 독립 제약 3~5개를 정의한다.
4. 모든 제약을 만족하는 정답을 정의한다.
5. 정확히 한 제약을 위반하는 근접 오답을 최소 2개 정의한다.
6. 각 판단에 사용된 참고 사실과 파일 경로를 연결한다.
7. 최종 자연어 문제는 작성하지 않고 설계표 JSON만 저장한다.

### 7.2 설계표 검사와 1회 수정

- 설계표 JSON 파싱 실패 시 잡을 실패 처리한다.
- 각 설계표에 `assessQuestionBlueprint()`를 실행한다.
- 탈락한 설계표가 있으면 전체 위반 코드와 메시지를 생성 엔진에 전달해 설계표만 정확히 1회 수정한다.
- 수정 후에도 탈락한 설계표는 버린다.
- 통과한 설계표가 하나도 없으면 잡을 실패 처리한다.
- 일부만 통과하면 통과한 수만큼 문항 작성을 계속하며 `verifyWarning`에 누락 수를 남긴다.

### 7.3 단계 B: 설계표 기반 문항 작성

`buildCliGenerationFromBlueprintPrompt()`를 추가한다.

- 설계표의 사실, 제약, 정답 관계를 변경하지 않는다.
- 출력은 현재 `parseImportJson()`이 읽는 `{ "questions": [...] }` 형식을 그대로 사용한다.
- 설계표와 문항은 배열 인덱스로 연결한다. 단계 B는 설계표 순서와 문항 수를 변경하면 안 된다.
- 설계표의 내부 메타데이터, 위반 제약, `correct` 플래그는 문제 본문이나 선지에 노출하지 않는다.
- `answer_indices`, `choice_explanations`, `keywords`를 현재 스키마대로 생성한다.
- 모든 선지를 유사한 구체성, 문법 구조, 아키텍처 수준으로 표현한다.

### 7.4 단계 C: 사실 + 구조 일치 검증

기존 `buildCliVerifyPrompt()`를 확장해 각 최종 문항과 대응 설계표를 함께 전달한다.

검증기는 다음을 확인한다.

1. 정답과 선지별 해설이 참고 자료에 비추어 사실적으로 정확하다.
2. 최종 문항의 정답 인덱스가 설계표의 정답 선지와 일치한다.
3. 시나리오가 설계표의 모든 독립 제약을 실제로 포함한다.
4. 각 선지가 설계표의 솔루션과 위반 제약을 왜곡하지 않는다.
5. 근접 오답이 자연어 표현에서도 여전히 그럴듯하다.
6. 표현상 정답 단서가 없다.
7. 질문에 쓰이지 않는 장식성 제약이 없다.

검증 응답 형식은 기존 `verdicts`를 유지하되 구조화된 위반 코드를 추가한다.

```json
{
  "verdicts": [
    {
      "index": 0,
      "verdict": "fail",
      "comment": "정답 선지만 모든 요구 사항을 그대로 반복합니다.",
      "violation_codes": ["ANSWER_CUE_REQUIREMENT_ECHO"]
    }
  ]
}
```

`violation_codes`는 선택 필드로 추가해 기존 데이터와의 호환성을 유지한다.

## 8. 자동 수정

기존 1회 자동 수정 흐름을 유지하되 수정 프롬프트에 대응 설계표를 포함한다.

- 수정기는 설계표의 정답, 제약, 사실 관계를 변경할 수 없다.
- 표현상 단서, 누락된 제약, 선지의 추상화 수준, 해설만 수정할 수 있다.
- 사실 오류 때문에 설계표 자체가 잘못된 경우 문항 수정으로 덮지 않고 fail을 유지한다.
- 수정본도 동일한 설계표와 함께 재검증한다.

## 9. 파일 산출물과 관찰 가능성

기존 `generation_output/jobs/<id>/` 아래에 다음 파일을 추가한다.

```text
blueprint-prompt.md
blueprint-result.json
blueprint-repair-prompt.md       # 수정이 발생한 경우
blueprint-repair-result.json     # 수정이 발생한 경우
prompt.md                        # 단계 B 문항 작성 프롬프트
result.json                      # 기존 최종 문제 원문
verify-prompt.md
verify-result.json
```

DB 스키마는 변경하지 않는다. 최종 잡 `result`, `rawOutput`, 승인 흐름은 기존과 동일하다. 설계표는 디버깅 산출물 파일로만 보존한다.

## 10. 프롬프트 정리

현재 공통 프롬프트의 상충 지시를 함께 제거한다.

- JSON 예시와 규칙 모두 `answer_indices`만 사용한다.
- CLI 문제 생성은 MCQ 전용이므로 CLOZE 예시와 "두 유형을 섞을 것" 지시를 포함하지 않는다.
- 생성, 검증, 자동 수정 프롬프트가 동일한 시험형 MCQ 계약을 공유한다.
- `answer_index`라는 과거 필드명은 호환 파서 설명 외에는 생성 프롬프트에 넣지 않는다.
- "그럴듯한 오답" 같은 추상적 지시보다 설계표의 구체적인 충족·위반 관계를 우선한다.

## 11. 오류 처리

| 상황 | 처리 |
|---|---|
| 설계표 JSON 파싱 실패 | 잡 `FAILED`, 파싱 오류와 원문 앞 300자 저장 |
| 일부 설계표 구조 게이트 실패 | 1회 수정 후 실패 항목 제외, `verifyWarning` 기록 |
| 모든 설계표 구조 게이트 실패 | 잡 `FAILED` |
| 단계 B 문항 수가 설계표 수와 다름 | 잡 `FAILED` |
| 최종 문항 파싱 실패 | 기존 생성 실패 처리 유지 |
| 검증 엔진 실패 | 기존처럼 `unverified`와 `verifyWarning` 유지 |
| 자동 수정이 설계표의 정답을 변경 | 수정본 `fail`, 원본 판정 유지 |

## 12. 테스트 요구 사항

### 12.1 `question-blueprint.test.ts`

- 정상 설계표 파싱
- 잘못된 enum, 빈 배열, 중복 id, 존재하지 않는 참조 거부
- JSON이 아니거나 `blueprints`가 없는 경우 fatal

### 12.2 `question-difficulty.test.ts`

- 레벨 4 설계표 통과
- 제약 2개 탈락
- 근접 오답 1개 탈락
- 정답이 제약 하나를 누락하면 탈락
- 오답이 아무 제약도 위반하지 않으면 탈락
- 존재하지 않는 constraint/fact id 참조 탈락
- 충족과 위반에 같은 constraint id가 있으면 탈락
- 고유 서비스·기능 2개 이하 탈락
- 복수 정답 2개 허용, 3개 거부

### 12.3 `prompt-template.test.ts`

- 설계표 프롬프트에 참고 파일, 기존 문제, 추가 지시, 결과 경로 포함
- 설계표 기반 작성 프롬프트에 전체 설계표 포함
- 작성 프롬프트가 `answer_indices`와 `choice_explanations`를 요구
- 작성 프롬프트에 CLOZE 혼합 지시와 과거 `answer_index` 규칙이 없음
- 검증·수정 프롬프트에 대응 설계표와 표현상 단서 기준 포함

### 12.4 `generation-service.test.ts`

- 설계표 생성 → 게이트 → 문항 생성 → 검증 순서
- 설계표 1회 수정 후 통과
- 일부 설계표만 통과한 경우 통과 항목으로 계속 진행
- 전부 탈락하면 잡 실패
- 설계표와 최종 문항 개수가 다르면 잡 실패
- 자동 수정 시 설계표 전달

## 13. 완료 조건

- AI 생성 잡이 문제를 바로 만들지 않고 설계표를 먼저 생성한다.
- 구조 게이트를 통과하지 못한 설계표로는 최종 문제가 만들어지지 않는다.
- 최종 출력과 저장된 문제 형식은 기존 API/UI와 호환된다.
- 사용자 정답률이나 LLM 정답 합의율을 어디에서도 사용하지 않는다.
- 최신 생성 산출물에서 각 문항의 설계표와 탈락 사유를 파일로 확인할 수 있다.
- 전체 lint, test, TypeScript 검사와 production build가 통과한다.

