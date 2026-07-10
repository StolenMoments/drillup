# 키워드 매핑 + AI 변형 출제 설계

날짜: 2026-07-10

상태: 승인됨

## 1. 목표

학습 능률을 올리기 위한 두 기능을 추가한다.

1. **키워드 매핑**: 문제마다 개념 키워드를 붙이고, 키워드 단위로 문제를 모아보고, 해당 키워드 문제만 연습 학습할 수 있게 한다. 키워드는 AI가 자동 부여하고(신규 생성·임포트 시 + 기존 문제 일괄 백필) 사용자가 문제 상세에서 수동 교정한다.
2. **AI 변형 출제**: 특정 문제(또는 키워드에 묶인 문제들)를 원본 컨텍스트로 삼아 "같은 개념을 다른 각도·형태로 묻는" 문제를 기존 생성→검증→승인 파이프라인으로 생성한다.

핵심 결정 사항:

- **어휘 통제가 설계의 핵심**: 키워드는 정규화(trim + 연속 공백 정리) 후 이름 유니크로 저장하고, AI 프롬프트에 해당 주제의 기존 키워드 목록을 주입해 재사용을 유도한다. `TCP` / `TCP 프로토콜` 같은 난립을 막는다.
- **정규화 테이블** (`Keyword` + `QuestionKeyword` 조인). JSON 컬럼 방식은 필터·집계·병합이 전부 앱 코드로 밀려나 기각.
- **키워드는 전역 어휘** — 주제 간 공유. 프롬프트에 주입하는 "기존 키워드"는 해당 주제의 문제에 연결된 키워드로 한정.
- **백필과 변형 모두 기존 `GenerationJob` 인프라 재사용** — 엔진 실행, 타임아웃/고아 처리, 잡 목록·상세 페이지, 승인 흐름을 그대로 쓴다. 잡 종류(`kind`) 컬럼으로 분기.
- **SRS 큐는 건드리지 않음** — 키워드별 학습은 연습(practice) 모드 전용. SRS는 due 기준이 원칙.

## 2. 데이터 모델 (Prisma)

```prisma
enum GenerationJobKind {
  QUESTION     // 문제 생성 (기존 동작, 변형 출제 포함)
  KEYWORD_TAG  // 기존 문제 키워드 일괄 부여
}

model Keyword {
  id        Int               @id @default(autoincrement())
  name      String            @unique @db.VarChar(50)
  createdAt DateTime          @default(now()) @map("created_at")
  questions QuestionKeyword[]

  @@map("keyword")
}

model QuestionKeyword {
  questionId Int      @map("question_id")
  keywordId  Int      @map("keyword_id")
  question   Question @relation(fields: [questionId], references: [id], onDelete: Cascade)
  keyword    Keyword  @relation(fields: [keywordId], references: [id], onDelete: Cascade)

  @@id([questionId, keywordId])
  @@map("question_keyword")
}
```

기존 모델 변경:

- `Question`에 역방향 관계 `keywords QuestionKeyword[]` 추가.
- `GenerationJob`에 두 컬럼 추가:
  - `kind GenerationJobKind @default(QUESTION)` — 잡 종류.
  - `sourceQuestionIds Json?` — 변형 출제의 원본 문제 id 배열(`number[]`). `kind=QUESTION`이고 변형이 아닌 일반 생성이면 `null`.

고아 키워드 정리: 문제에서 키워드 연결을 끊을 때(수동 삭제, 문제 삭제는 Cascade) 연결이 0개가 된 키워드는 함께 삭제한다. 별도 배치 불필요.

## 3. core 확장 (순수 TS)

### 3.1 키워드 정규화 (`src/core/keyword.ts`, 신규)

```ts
export const KEYWORD_MAX_LENGTH = 50;
export function normalizeKeywordName(raw: string): string; // trim + 연속 공백 1개로
export function dedupeKeywordNames(names: string[]): string[]; // 정규화 후 중복 제거, 빈 문자열 제외
```

### 3.2 임포트 스키마 (`src/core/import-schema.ts`)

mcq/cloze 공통으로 `keywords` 필드 추가 — 수동 임포트와 AI 생성이 같은 스키마를 쓰므로 한 번에 적용된다.

```ts
keywords: z.array(nonBlank.max(KEYWORD_MAX_LENGTH)).max(5).optional()
```

### 3.3 백필 응답 스키마 (`src/core/keyword-tag-schema.ts`, 신규)

`parseVerifyJson`과 동일한 스타일:

```ts
export type KeywordTagParseResult =
  | { ok: true; assignments: Array<{ id: number; keywords: string[] }> }
  | { ok: false; fatal: string };

export function parseKeywordTagJson(rawText: string): KeywordTagParseResult;
```

zod 검증: `assignments` 배열 필수, `id`는 양의 정수, `keywords`는 1~5개의 비어있지 않은 문자열.

### 3.4 프롬프트 템플릿 (`src/core/prompt-template.ts`)

1. **생성 프롬프트 출력 형식에 `keywords` 추가** — `promptBody`의 JSON 예시에 `"keywords": ["핵심 개념1", "핵심 개념2"]` 필드를 넣고, 규칙에 "문제마다 핵심 개념 키워드 1~3개를 keywords에 넣을 것" 추가.
2. **기존 키워드 주입 섹션** (신규):

```ts
export function existingKeywordsSection(names: string[]): string;
```

이름 목록이 비어 있으면 빈 문자열. 있으면 "## 키워드 규칙" 섹션 — "가능하면 아래 기존 키워드를 재사용하고, 딱 맞는 것이 없을 때만 새 키워드를 만들 것. 표기 변형(대소문자·조사·축약)으로 새 키워드를 만들지 말 것."

3. **변형 출제 섹션** — `buildCliGenerationPrompt`에 선택 인자 추가:

```ts
export interface VariantSource {
  question: string; // 원본 문제 JSON(payload + explanation) 직렬화
}
export function buildCliGenerationPrompt(
  topicName, instructions, resultPath, existing, referenceFiles,
  variantSources?: VariantSource[],   // 신규
  existingKeywords?: string[],        // 신규
): string;
```

`variantSources`가 있으면 "## 변형 출제 (원본 문제)" 섹션을 추가 — 원본 문제들을 JSON 코드 블록으로 나열하고 "위 원본과 같은 개념을 다른 각도·형태·상황으로 묻는 문제를 만들 것. 원본과 표현만 바꾼 문제는 금지(기존 중복 금지 규칙과 동일 기준)." 기존 중복 금지 섹션(`dedupSection`)은 그대로 유지된다.

4. **백필 프롬프트** (신규):

```ts
export function buildCliKeywordTagPrompt(
  topicName: string,
  questions: Array<{ id: number; summary: string }>,
  existingKeywords: string[],
  resultPath: string,
): string;
```

문제 요약 목록(기존 `summarizeQuestionPayload` 재사용)과 기존 키워드 목록을 제시하고, `{"assignments":[{"id":123,"keywords":["...", "..."]}]}` 형식으로 문제마다 1~3개 키워드를 부여하도록 지시. 결과 저장 규칙(stdout 금지, resultPath에 UTF-8 JSON만)은 기존 프롬프트들과 동일.

## 4. 서비스 계층

### 4.1 키워드 서비스 (`src/server/keyword-service.ts`, 신규)

```ts
listKeywords(topicId?: number): Promise<KeywordDto[]>            // 문제 수 포함, 이름순
addQuestionKeyword(questionId: number, name: string): Promise<KeywordDto>
removeQuestionKeyword(questionId: number, keywordId: number): Promise<void>
```

- `addQuestionKeyword`: `normalizeKeywordName` → 빈 문자열/50자 초과면 400 `ServiceError` → `connectOrCreate` (이미 연결돼 있으면 no-op).
- `removeQuestionKeyword`: 연결 삭제 후 해당 키워드의 남은 연결이 0이면 키워드도 삭제.
- 공용 헬퍼 `attachKeywords(tx, questionId, names: string[])` — 임포트/백필 승인에서 재사용. 정규화·중복 제거 후 connectOrCreate.

### 4.2 임포트 서비스 (`src/server/import-service.ts`)

`importQuestions()`가 각 문제 저장 시 `question.keywords`가 있으면 `attachKeywords`로 연결. 기존 트랜잭션 구조 유지.

### 4.3 생성 서비스 (`src/server/generation/generation-service.ts`)

- `createJob` 입력에 `sourceQuestionIds?: number[]` 추가. 있으면:
  - 원본 문제들을 조회(없는 id는 404). 상한 **10개** — 키워드 트리거 시 연결 문제가 더 많으면 최근 생성순 10개만 사용.
  - `payload` + `explanation`을 직렬화해 `VariantSource[]`로 프롬프트에 전달, 잡 레코드에 `sourceQuestionIds` 저장.
- 일반/변형 생성 모두 해당 주제의 기존 키워드 목록(연결 문제 수 상위 **50개**)을 `existingKeywords`로 프롬프트에 주입.
- **`createKeywordTagJob(input: { topicId; engine })`** (신규): 키워드가 하나도 없는 문제들을 최대 **50개** 조회(없으면 400 "부여할 문제가 없습니다"). `kind: KEYWORD_TAG`로 잡 생성, `buildCliKeywordTagPrompt`로 실행. 검증(verify) 단계는 없음 — RUNNING → SUCCEEDED/FAILED. 결과는 `parseKeywordTagJson`으로 파싱해 `result`에 저장하되, 요청에 없던 문제 id가 응답에 있으면 해당 항목은 버린다.
- **`approveJob` 분기**: `kind=KEYWORD_TAG`면 선택된 항목의 `assignments`를 `attachKeywords`로 적용하고 `savedCount`에 적용 문제 수를 기록. `kind=QUESTION`이면 기존 동작.
- 잡 동시 실행 가드(주제당 1개)는 kind와 무관하게 기존 규칙 유지.

### 4.4 문제/학습 서비스

- `question-service.ts`: 목록 조회에 `keywordId` 필터 추가. 문제 상세 DTO에 `keywords: KeywordDto[]` 포함.
- `study-service.ts`: `getStudyQueue("practice", ...)`에 `keywordId` 파라미터 추가 — 해당 키워드에 연결된 문제만 후보로 랜덤 추출. SRS 모드는 변경 없음.

## 5. API 설계

```
GET    /api/keywords?topicId=            → 200 { keywords: KeywordDto[] }
POST   /api/questions/{id}/keywords      요청 { name } → 200 KeywordDto
DELETE /api/questions/{id}/keywords/{keywordId} → 204
GET    /api/questions?keywordId=         (기존 라우트에 필터 추가 — 키워드 페이지의 문제 목록도 이 필터를 사용)
GET    /api/study/queue?mode=practice&keywordId=  (기존 라우트에 파라미터 추가)
POST   /api/generate                     요청에 sourceQuestionIds?: number[] 추가
POST   /api/generate/keyword-tag         요청 { topicId, engine } → GenerationJobDto (기존 POST /api/generate와 동일한 응답 규약)
```

- DTO(`src/lib/api-types.ts`): `KeywordDto { id; name; questionCount }`, `GenerationJobDto`/`GenerationJobSummaryDto`에 `kind` 추가, 문제 상세 DTO에 `keywords` 추가.
- Route Handler는 기존과 동일하게 얇게(zod 파싱 → 서비스 호출). 화면은 `api-client` 경유.

## 6. 화면

### 6.1 `/keywords` 페이지 (신규)

- 키워드 목록: 이름 + 연결 문제 수, 주제 필터 드롭다운, 이름순.
- 키워드 선택 시: 연결 문제 목록(요약) + 액션 버튼 2개:
  - **"이 키워드 연습하기 📝"** → `/study?mode=practice&keywordId={id}` 이동.
  - **"이 개념으로 문제 생성 🤖"** → 해당 키워드의 문제 id들(최근 10개)을 `sourceQuestionIds`로 `POST /api/generate` → 생성된 잡 상세 페이지로 이동. 주제는 연결 문제 중 최다 주제를 기본값으로 하되 잡 생성 전에 선택 가능.
- 내비게이션(레이아웃)에 "키워드" 링크 추가.

### 6.2 문제 상세 (`/questions/[id]`)

- 키워드 칩 목록 표시 + 삭제(×) 버튼, 입력창으로 추가(기존 키워드 datalist 자동완성).
- **"변형 문제 생성 🤖"** 버튼 — 엔진 선택 후 이 문제 1개를 `sourceQuestionIds`로 잡 생성 → 잡 상세로 이동.

### 6.3 문제 목록 (`/questions`)

- 키워드 필터(주제 필터 옆에 드롭다운) 추가. 필터 적용 시 해당 키워드 연결 문제만 표시.

### 6.4 생성 잡 화면 (`/generate`, `/generate/[id]`)

- 잡 목록에 kind 배지(문제 생성 / 키워드 부여)와 변형 여부 표시.
- `KEYWORD_TAG` 잡 상세: 문제 요약 + 제안 키워드를 항목별 체크박스로 표시, 선택 저장(기존 승인 UI 패턴 재사용).
- `QUESTION` 잡 상세: 기존 그대로 + 항목에 keywords가 있으면 미리보기에 칩으로 표시.
- 주제 관리 화면(주제 목록)에 **"키워드 일괄 부여"** 실행 진입점 추가(엔진 선택 → `POST /api/generate/keyword-tag`).

### 6.5 학습 화면 (`/study`)

- `keywordId` 쿼리 파라미터 수용 — 연습 모드 큐 요청에 전달, 화면 상단에 "키워드: {name}" 표시.

## 7. 오류 처리

| 상황 | 처리 |
|---|---|
| 키워드 이름 빈 문자열/50자 초과 | 400 VALIDATION |
| 존재하지 않는 문제/키워드 | 404 NOT_FOUND |
| 변형 원본 문제 id 일부 없음 | 404 NOT_FOUND (잡 생성 전 검증) |
| 백필 대상 문제 없음 | 400 NO_UNTAGGED_QUESTIONS |
| KEYWORD_TAG 잡 응답 파싱 실패 | 잡 FAILED + 원문 앞 300자 (기존 패턴) |
| 응답에 요청 밖 문제 id 포함 | 해당 항목만 무시 |
| kind가 다른 잡에 맞지 않는 승인 요청 | 기존 승인 검증 로직에서 400 INVALID_ITEMS |

## 8. 테스트

vitest, core 단위 테스트만 자동화(프로젝트 규약: 서비스 계층은 수동 검증).

- `keyword.test.ts` — 정규화(trim, 연속 공백), 중복 제거, 빈 문자열 제외.
- `import-schema.test.ts` — keywords 필드 허용/생략/5개 초과/빈 문자열 거부.
- `keyword-tag-schema.test.ts` — 정상, assignments 누락, id 비정수, keywords 빈 배열, JSON 아님.
- `prompt-template.test.ts` — 기존 키워드 섹션 유무, 변형 섹션(원본 JSON 포함), 백필 프롬프트(문제 목록·resultPath 지시), 생성 출력 형식에 keywords 포함.

수동 검증: 마이그레이션 후 ① 문제 상세에서 키워드 추가/삭제 ② 임포트 JSON에 keywords 포함 저장 확인 ③ 키워드 일괄 부여 잡 실행→승인→문제 상세 반영 ④ 문제 상세 "변형 문제 생성" → 잡 승인 → 새 문제에 키워드 자동 부여 확인 ⑤ `/keywords`에서 연습 학습 진입 → 해당 키워드 문제만 출제되는지 확인.
