# 사실 오류 방어 파이프라인 설계

날짜: 2026-07-11
상태: 승인됨

## 배경

question id=57(주제 5, AIP-C01 D1)의 정답 선지·해설·AI 해설(CLAUDE/ANTIGRAVITY)이 모두
"Amazon Bedrock Prompt Management가 승인 워크플로를 기본 제공한다"는 잘못된 사실을 담고 있다.
실제로는 draft→version 스냅샷 구조만 있고 네이티브 승인·반려 게이트는 없다.

문제 생성, 검증, AI 해설, 선지 난이도 올리기 네 단계가 모두 이 오류를 놓쳤다. 원인은 우연이 아니라 구조적이다.

1. **오염된 참고 자료** — `generation_reference/aip-c01/d1/bedrock-models-data.md:51`에
   "Bedrock Prompt Management로 역할 정의, 파라미터화된 템플릿, 승인 워크플로를 관리한다"는 오류 서술이 있다.
2. **자료 우선 지시** — `src/core/prompt-template.ts`의 `referenceSection`이
   "자료와 당신의 기억이 다르면 자료를 우선하세요"라고 지시한다. 생성·블루프린트·검증·재검증 프롬프트가
   모두 이 섹션을 포함하므로 검증 엔진도 오염된 자료를 따른다. `webVerificationSection`은 반대로
   "최신 공식 웹 문서 우선"이라 두 지시가 모순이며, 웹 도구가 없으면 자료가 이긴다.
3. **하류 단계의 이의 제기 출구 부재** — AI 해설 프롬프트는 "정답: X"를 주고 왜 맞는지 설명하라고만 하고,
   선지 강화 프롬프트는 정답을 한 글자도 바꾸지 말라고 지시한다. 사실 오류를 발견해도 보고할 필드가
   출력 스키마에 없어 모델이 오류를 합리화하게 된다.
4. **검증자 재갈** — `buildCliVerifyPrompt`의 Blueprint conformance 섹션이
   "Facts, correct answers, constraints, and service relationships are immutable"이라고 지시해
   검증 엔진이 블루프린트의 사실을 의심하지 못하게 막는다.

즉 오염된 단일 소스(참고 자료)를 네 단계가 충실히 물려받은 사건이다.

## 목표

- 참고 자료가 오염돼도 파이프라인이 사실 오류를 탐지·차단·보고할 수 있게 한다.
- 이미 저장된 문항의 사실 오류를 배치로 재감사할 수 있게 한다.
- 모든 AI 호출 기능(생성, 검증, 재검증, 해설, 선지 강화)에 일관되게 적용한다.
  키워드 태깅/추천은 사실성과 무관하므로 제외한다.

## 설계

### A. 선행 데이터 수정

- `generation_reference/aip-c01/d1/bedrock-models-data.md:51`을 사실에 맞게 수정한다:
  Prompt Management는 파라미터화된 템플릿·버전 관리(draft→version 스냅샷)를 제공하며,
  네이티브 승인·반려 워크플로는 없으므로 승인 절차가 필요하면 외부 프로세스와 결합해야 한다.
- question 57 자체는 C의 감사 잡이 잡아내는 첫 사례가 되고, 수정은 기존 문제 편집 화면에서 처리한다.

### B. 프롬프트 공통 수정 (`src/core/prompt-template.ts`)

1. **우선순위 통일** — `referenceSection`의 "자료 우선" 지시를 삭제하고 다음으로 교체한다:
   - 사실 우선순위: 최신 공식 웹 문서 > 참고 자료 > 모델 지식.
   - 참고 자료는 출제 범위·스타일의 근거다.
   - 서비스가 특정 기능을 "기본 제공"한다는 주장은 반드시 공식 문서로 확인한다.
   - 생성·블루프린트·검증·재검증·선지 강화가 모두 이 섹션을 공유하므로 한 곳 수정으로 전파된다.
2. **검증자 재갈 제거** — `buildCliVerifyPrompt`의 "Facts, correct answers … are immutable"을
   "블루프린트 구조는 유지하되, 사실 오류를 발견하면 반드시 fail"로 완화한다.
3. **이의 제기 출구** — AI 해설(`buildAnswerExplanationPrompt`)과 선지 강화(`buildChoiceHardeningPrompt`)
   출력 스키마에 선택 필드 `factual_concern`을 추가한다. 지시: "정답 전제를 유지해 작업하되,
   정답 자체가 사실과 다르다고 판단되면 근거 URL과 함께 이 필드에 기록하라."
   - 파서 수정: `explanation-schema`, `harden-schema`.
   - DB: `AnswerExplanation`에 `factual_concern` 컬럼(TEXT, nullable) 추가.
   - UI: 학습 화면 해설 패널과 선지 강화 미리보기에 ⚠️ 경고 표시.

### C. 저장 문항 감사 잡 (AUDIT job kind)

- `GenerationJobKind`에 `AUDIT` 추가.
- 주제 단위로 저장된 문항을 배치(20문항)로 묶어 웹 검증 전용 verify 프롬프트(참고 자료 제외)로 재검증한다.
- 결과는 `{questionId, summary, verdict, comment}` 목록으로 잡 result에 저장한다.
- 생성 관리 화면에서 fail 문항 목록 + 사유 + 문제 편집 링크를 제공한다.
- `KEYWORD_TAG` 잡과 같은 패턴(승인 없이 조회·처리)을 따른다.

### D. 블루프린트 fact-check 게이트

- 블루프린트 파싱(및 수리) 직후, 모든 `referenceFacts`를 중복 제거해 별도 엔진 호출로
  공식 문서와 대조한다. fact별 판정: `confirmed` / `refuted` / `unverifiable` + 근거 URL.
- `refuted` fact를 참조하는 블루프린트는 생성에서 제외한다. 전부 제외되면 잡을 실패 처리한다.
- `verifyWarning`에 반박된 fact와 출처 참고 자료 파일을 기록한다
  (예: "fact f3 반박됨 (출처: d1/bedrock-models-data.md)") — 자료 정화로 이어지는 피드백 루프.
- `unverifiable`(웹 도구 사용 불가 등)은 진행하되 경고를 기록한다.
- 비용: 생성 잡당 엔진 호출 1회 추가.

### E. 테스트

- 프롬프트 템플릿 단위 테스트: 우선순위 문구, factual_concern 지시, fact-check 프롬프트 형식.
- 스키마 파서 테스트: factual_concern 파싱, fact-check 결과 파싱, AUDIT 결과 파싱.
- 서비스 테스트: 감사 잡 생성/실행/결과 저장, fact-check 게이트의 제외·경고 동작.
- DB 마이그레이션 2건: `AnswerExplanation.factual_concern` 컬럼, `GenerationJobKind.AUDIT` enum.

## 제외 범위

- 참고 자료 md 전체를 주기적으로 lint하는 배치(향후 후속 과제).
- 교차 엔진(2개 이상) 검증 — 같은 오염 자료를 주면 함께 속으므로 이번 유형에 효과가 제한적.
- 키워드 태깅/추천 프롬프트 변경.
