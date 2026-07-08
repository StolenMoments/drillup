# 주제별 참고 자료 기반 문제 생성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주제(topic)에 참고 자료 폴더를 연결하고, AI 문제 생성(`/generate`) 시 CLI 에이전트가 그 폴더의 md/txt 파일을 직접 읽어 자료에 근거해 문제를 출제·검증하게 한다.

**Architecture:** `Topic.referenceDir`(참고 자료 루트 기준 상대 폴더)와 `GenerationJob.referenceFiles`(사용 파일 기록)를 추가한다. 파일 목록 조회 API로 `/generate` 화면에 체크박스를 보여주고, 선택된 파일의 **절대 경로만** 생성·검증 프롬프트에 나열한다 — 파일 내용은 CLI 에이전트가 직접 읽는다. 경로 안전성 검사는 `src/core/`의 순수 함수로 두고 단위 테스트한다.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 + MariaDB, zod 4, vitest 4

**Spec:** `docs/superpowers/specs/2026-07-09-topic-reference-generation-design.md`

## Global Constraints

- `master` 브랜치에서 직접 작업 (개인 프로젝트, 브랜치·워크트리 생성 금지)
- 커밋 메시지는 한국어, conventional-commit 타입 접두사는 영어 (`feat:`, `fix:`, `test:`, `docs:`), Task당 커밋 1개
- Route Handler는 얇게: zod 파싱 → `src/server/` 서비스 호출 → JSON 응답
- 화면 코드는 `src/lib/api-client.ts`의 `api` 객체만 사용 (fetch 직접 호출 금지)
- `src/core/`는 순수 TS (Next/Prisma import 금지), 자동 테스트는 core만 (서비스·UI는 수동 검증)
- 사용자에게 보이는 피드백 문구의 이모지(✅/❌/⚠️) 유지
- 참고 자료 루트: 프로젝트 루트 `generation_reference/` (환경변수 `GENERATION_REFERENCE_DIR`로 재정의), git 커밋 금지
- Next.js는 학습 데이터와 다를 수 있음 — 기존 코드 패턴(예: route ctx의 `params: Promise<...>`)을 그대로 따를 것

## File Structure

| 파일 | 역할 |
|---|---|
| `prisma/schema.prisma` (수정) | `Topic.referenceDir`, `GenerationJob.referenceFiles` 컬럼 |
| `src/core/reference-path.ts` (생성) | 상대 경로 안전성 순수 함수 `isSafeReferencePath` |
| `src/core/prompt-template.ts` (수정) | 생성·검증 프롬프트에 참고 자료 섹션 추가 |
| `src/server/generation/reference.ts` (생성) | 파일 목록 스캔·선택 파일 검증/절대경로 변환 |
| `src/server/topic-service.ts` (수정) | `referenceDir` DTO 노출·수정 |
| `src/server/generation/generation-service.ts` (수정) | 잡 생성 시 파일 해석, 프롬프트에 주입 |
| `src/app/api/topics/[id]/route.ts` (수정) | PATCH에 `referenceDir` 허용 |
| `src/app/api/topics/[id]/reference-files/route.ts` (생성) | 파일 목록 조회 API |
| `src/app/api/generate/route.ts` (수정) | `referenceFiles` 입력 추가 |
| `src/lib/api-types.ts`, `src/lib/api-client.ts` (수정) | DTO·클라이언트 확장 |
| `src/app/generate/page.tsx` (수정) | 참고 자료 파일 체크박스 |
| `src/app/questions/page.tsx` (수정) | 주제의 참고 자료 폴더 설정 버튼 |

---

### Task 1: Prisma 스키마 + 마이그레이션 + .gitignore

**Files:**
- Modify: `prisma/schema.prisma:32-41` (Topic), `prisma/schema.prisma:83-99` (GenerationJob)
- Modify: `.gitignore` (generation_output 항목 아래)

**Interfaces:**
- Produces: `Topic.referenceDir: string | null`, `GenerationJob.referenceFiles: Prisma.JsonValue | null` (Prisma Client 타입) — 이후 모든 태스크가 사용

- [ ] **Step 1: 스키마 수정**

`prisma/schema.prisma`의 `Topic` 모델에 한 줄 추가 (`createdAt` 위):

```prisma
model Topic {
  id             Int             @id @default(autoincrement())
  name           String          @unique @db.VarChar(100)
  description    String?         @db.Text
  referenceDir   String?         @map("reference_dir") @db.VarChar(200)
  createdAt      DateTime        @default(now()) @map("created_at")
  questions      Question[]
  generationJobs GenerationJob[]

  @@map("topic")
}
```

`GenerationJob` 모델에 한 줄 추가 (`rawOutput` 아래):

```prisma
  rawOutput      String?          @map("raw_output") @db.MediumText
  referenceFiles Json?            @map("reference_files")
  createdAt      DateTime         @default(now()) @map("created_at")
```

- [ ] **Step 2: .gitignore에 참고 자료 루트 추가**

`.gitignore`의 `# AI generation job output` 블록을 다음으로 교체:

```
# AI generation job output
/generation_output/

# AI generation reference materials (저작권 자료 포함 — 커밋 금지)
/generation_reference/
```

- [ ] **Step 3: 마이그레이션 실행**

DB가 꺼져 있으면 먼저: `docker-compose up -d`

Run: `npx prisma migrate dev --name topic_reference_files`
Expected: `Your database is now in sync with your schema.` + Prisma Client 재생성

- [ ] **Step 4: 기존 테스트·타입 확인**

Run: `npm run test` → Expected: 전부 PASS
Run: `npx tsc --noEmit` → Expected: 오류 없음

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations .gitignore
git commit -m "feat: Topic 참고 자료 폴더·GenerationJob 사용 파일 컬럼 추가"
```

---

### Task 2: core 경로 안전성 함수 (TDD)

**Files:**
- Create: `src/core/reference-path.ts`
- Test: `src/core/reference-path.test.ts`

**Interfaces:**
- Produces: `isSafeReferencePath(p: string): boolean` — 참고 자료 루트 기준 상대 경로로 안전하면 true. Task 4·5·6이 zod refine과 서비스 검증에 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/reference-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isSafeReferencePath } from "./reference-path";

describe("isSafeReferencePath", () => {
  it("정상 상대 경로를 허용한다 (슬래시·백슬래시 모두)", () => {
    expect(isSafeReferencePath("aip-c01")).toBe(true);
    expect(isSafeReferencePath("aip-c01/d1/bedrock.md")).toBe(true);
    expect(isSafeReferencePath("common\\00-exam-guide.md")).toBe(true);
  });

  it("빈 값·공백만 있는 값을 거부한다", () => {
    expect(isSafeReferencePath("")).toBe(false);
    expect(isSafeReferencePath("   ")).toBe(false);
  });

  it("상위 디렉터리 탈출을 거부한다", () => {
    expect(isSafeReferencePath("..")).toBe(false);
    expect(isSafeReferencePath("aip-c01/../../etc")).toBe(false);
    expect(isSafeReferencePath("..\\secrets")).toBe(false);
  });

  it("절대 경로·드라이브·UNC 경로를 거부한다", () => {
    expect(isSafeReferencePath("/etc/passwd")).toBe(false);
    expect(isSafeReferencePath("C:\\work\\drillup")).toBe(false);
    expect(isSafeReferencePath("c:/work")).toBe(false);
    expect(isSafeReferencePath("\\\\server\\share")).toBe(false);
  });

  it("빈 세그먼트·현재 디렉터리 세그먼트를 거부한다", () => {
    expect(isSafeReferencePath("a//b")).toBe(false);
    expect(isSafeReferencePath("./a")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/core/reference-path.test.ts`
Expected: FAIL — `Cannot find module './reference-path'` 류 오류

- [ ] **Step 3: 최소 구현**

`src/core/reference-path.ts`:

```ts
const DRIVE_RE = /^[A-Za-z]:/;

/**
 * 참고 자료 루트 기준 상대 경로로 안전한지 판정한다.
 * 폴더명(referenceDir)과 파일 상대 경로 모두에 사용한다.
 */
export function isSafeReferencePath(p: string): boolean {
  const trimmed = p.trim();
  if (trimmed === "") return false;
  if (DRIVE_RE.test(trimmed)) return false;

  const normalized = trimmed.replaceAll("\\", "/");
  if (normalized.startsWith("/")) return false;

  return normalized
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/core/reference-path.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/reference-path.ts src/core/reference-path.test.ts
git commit -m "feat: 참고 자료 상대 경로 안전성 판정 함수 추가"
```

---

### Task 3: 프롬프트에 참고 자료 섹션 추가 (TDD)

**Files:**
- Modify: `src/core/prompt-template.ts`
- Test: `src/core/prompt-template.test.ts`

**Interfaces:**
- Consumes: 기존 `buildCliGenerationPrompt`, `buildCliVerifyPrompt`
- Produces: 두 함수 모두 마지막에 **선택적 파라미터** `referenceFiles: string[] = []` (절대 경로 배열) 추가. 기본값이 있으므로 기존 호출부는 그대로 컴파일된다. Task 6이 실제 경로를 전달

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/prompt-template.test.ts`에 다음 describe 블록 2개 추가:

```ts
const REF_FILES = [
  "C:\\work\\drillup\\generation_reference\\aip-c01\\common\\00-exam-guide.md",
  "C:\\work\\drillup\\generation_reference\\aip-c01\\d1\\bedrock.md",
];

describe("buildCliGenerationPrompt 참고 자료 섹션", () => {
  it("파일 목록과 근거 우선 지시를 포함한다", () => {
    const prompt = buildCliGenerationPrompt(
      "AIP-C01 D1",
      "",
      "D:\\r.json",
      NO_EXISTING,
      REF_FILES,
    );
    expect(prompt).toContain("## 참고 자료 (반드시 먼저 읽을 것)");
    expect(prompt).toContain(`- ${REF_FILES[0]}`);
    expect(prompt).toContain(`- ${REF_FILES[1]}`);
    expect(prompt).toContain("자료에 없는 내용을 기억이나 추측으로 출제하지 마세요");
    expect(prompt).toContain("자료와 당신의 기억이 다르면 자료를 우선하세요");
    expect(prompt).toContain("읽을 수 없는 파일이 있으면 그 파일은 무시하고");
  });

  it("파일이 없으면 섹션을 생략한다 (기본값 포함)", () => {
    const withEmpty = buildCliGenerationPrompt("주제", "", "D:\\r.json", NO_EXISTING, []);
    const withDefault = buildCliGenerationPrompt("주제", "", "D:\\r.json", NO_EXISTING);
    expect(withEmpty).not.toContain("## 참고 자료");
    expect(withDefault).not.toContain("## 참고 자료");
  });
});

describe("buildCliVerifyPrompt 참고 자료 섹션", () => {
  it("파일 목록과 근거 기반 판정 지시를 포함한다", () => {
    const prompt = buildCliVerifyPrompt("AIP-C01 D1", items, "D:\\v.json", REF_FILES);
    expect(prompt).toContain("## 참고 자료 (반드시 먼저 읽을 것)");
    expect(prompt).toContain(`- ${REF_FILES[0]}`);
    expect(prompt).toContain("판정하기 전에 아래 파일들을 모두 읽으세요");
    expect(prompt).toContain("자료와 당신의 기억이 다르면 자료를 우선하세요");
  });

  it("파일이 없으면 섹션을 생략한다", () => {
    const prompt = buildCliVerifyPrompt("주제", items, "D:\\v.json");
    expect(prompt).not.toContain("## 참고 자료");
  });
});
```

주의: `items` 상수는 기존 `buildCliVerifyPrompt` describe 안에 선언되어 있다. 새 describe에서 쓰려면 `items` 선언을 파일 상단(모듈 스코프, `NO_EXISTING` 옆)으로 옮긴다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: FAIL — 새 테스트들이 `## 참고 자료` 미포함으로 실패 (5번째 인자는 아직 무시됨/타입 오류)

- [ ] **Step 3: 구현**

`src/core/prompt-template.ts`에 섹션 빌더를 추가하고 두 함수 시그니처를 확장:

```ts
function referenceSection(files: string[], lead: string): string {
  if (files.length === 0) return "";
  return [
    "## 참고 자료 (반드시 먼저 읽을 것)",
    "",
    `${lead} 아래 파일들을 모두 읽으세요:`,
    "",
    ...files.map((file) => `- ${file}`),
    "",
    "- 문제와 정답의 사실 관계는 반드시 위 자료 내용에 근거해야 합니다.",
    "- 자료에 없는 내용을 기억이나 추측으로 출제하지 마세요.",
    "- 자료와 당신의 기억이 다르면 자료를 우선하세요.",
    "- 읽을 수 없는 파일이 있으면 그 파일은 무시하고 진행하세요.",
    "",
  ].join("\n");
}
```

`buildCliGenerationPrompt` — 파라미터 추가 + `dedupSection` 앞에 섹션 삽입:

```ts
export function buildCliGenerationPrompt(
  topicName: string,
  instructions: string,
  resultPath: string,
  existing: ExistingQuestions,
  referenceFiles: string[] = [],
): string {
  const extra = instructions.trim();
  return `${promptBody(topicName)}
${referenceSection(referenceFiles, "문제를 만들기 전에")}${dedupSection(existing)}

## 추가 지시

${extra || "(없음)"}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
```

`buildCliVerifyPrompt` — 파라미터 추가 + "## 판정 기준" 섹션 뒤·"## 검증 대상 문제" 앞에 삽입 (기존 템플릿 리터럴에서 해당 위치에 `${referenceSection(referenceFiles, "판정하기 전에")}` 추가):

```ts
export function buildCliVerifyPrompt(
  topicName: string,
  items: Array<{ index: number; question: unknown }>,
  resultPath: string,
  referenceFiles: string[] = [],
): string {
  // ...기존 listing 코드 유지...
  // 템플릿에서:
  // 2. 문제 품질: ... 모순되지 않는가?
  //
  // ${referenceSection(referenceFiles, "판정하기 전에")}## 검증 대상 문제
```

- [ ] **Step 4: 전체 테스트 통과 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: PASS (기존 테스트 포함 전부) — 특히 파일 없음 케이스에서 빈 줄이 이중으로 생기지 않는지 프롬프트 출력을 눈으로 한 번 확인

Run: `npx tsc --noEmit`
Expected: 오류 없음 (기본값 파라미터라 기존 호출부 무변경)

- [ ] **Step 5: Commit**

```bash
git add src/core/prompt-template.ts src/core/prompt-template.test.ts
git commit -m "feat: 생성·검증 프롬프트에 참고 자료 파일 섹션 추가"
```

---

### Task 4: Topic DTO·API에 referenceDir 노출·수정

**Files:**
- Modify: `src/lib/api-types.ts:14-19` (TopicDto)
- Modify: `src/server/topic-service.ts`
- Modify: `src/app/api/topics/[id]/route.ts`
- Modify: `src/lib/api-client.ts:72-76` (topics.update)

**Interfaces:**
- Consumes: `isSafeReferencePath` (Task 2)
- Produces: `TopicDto.referenceDir: string | null`; `PATCH /api/topics/:id` body에 `referenceDir?: string | null` (빈 문자열 → null 정규화); `api.topics.update(id, { name?, description?, referenceDir? })`

- [ ] **Step 1: TopicDto 확장**

`src/lib/api-types.ts`:

```ts
export interface TopicDto {
  id: number;
  name: string;
  description: string | null;
  referenceDir: string | null;
  questionCount: number;
}
```

- [ ] **Step 2: topic-service 확장**

`src/server/topic-service.ts`의 `toDto` 파라미터 타입과 반환에 `referenceDir` 추가:

```ts
function toDto(topic: {
  id: number;
  name: string;
  description: string | null;
  referenceDir: string | null;
  _count: { questions: number };
}): TopicDto {
  return {
    id: topic.id,
    name: topic.name,
    description: topic.description,
    referenceDir: topic.referenceDir,
    questionCount: topic._count.questions,
  };
}
```

`updateTopic` 입력 타입 확장 (구현 본문은 무변경 — `data: input`이 그대로 전달):

```ts
export async function updateTopic(
  id: number,
  input: { name?: string; description?: string; referenceDir?: string | null },
): Promise<TopicDto> {
```

- [ ] **Step 3: PATCH route zod 확장**

`src/app/api/topics/[id]/route.ts`:

```ts
import { z } from "zod";
import { isSafeReferencePath } from "@/core/reference-path";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";
import { deleteTopic, updateTopic } from "@/server/topic-service";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().optional(),
  referenceDir: z
    .union([z.string().trim().max(200), z.null()])
    .optional()
    .transform((value) => (value === "" ? null : value))
    .refine(
      (value) => value === undefined || value === null || isSafeReferencePath(value),
      { message: "잘못된 참고 자료 폴더 경로입니다" },
    ),
});
```

- [ ] **Step 4: api-client 확장**

`src/lib/api-client.ts`의 `topics.update`:

```ts
    update: (
      id: number,
      input: { name?: string; description?: string; referenceDir?: string | null },
    ) =>
      request<TopicDto>(`/api/topics/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
```

- [ ] **Step 5: 확인 후 커밋**

Run: `npx tsc --noEmit` → Expected: 오류 없음
Run: `npm run test` → Expected: 전부 PASS

```bash
git add src/lib/api-types.ts src/lib/api-client.ts src/server/topic-service.ts "src/app/api/topics/[id]/route.ts"
git commit -m "feat: 주제에 참고 자료 폴더(referenceDir) 노출·수정 지원"
```

---

### Task 5: 참고 자료 서비스 + 파일 목록 API

**Files:**
- Create: `src/server/generation/reference.ts`
- Create: `src/app/api/topics/[id]/reference-files/route.ts`
- Modify: `src/lib/api-types.ts` (DTO 추가), `src/lib/api-client.ts` (topics.referenceFiles)

**Interfaces:**
- Consumes: `isSafeReferencePath` (Task 2), `prisma`, `ServiceError`
- Produces:
  - `referenceRoot(): string`
  - `listReferenceFiles(referenceDir: string): Promise<{ files: Array<{ path: string; size: number }>; dirExists: boolean }>`
  - `resolveReferenceFiles(referenceDir: string | null, selected: string[]): Promise<string[]>` — 절대 경로 배열 반환, Task 6이 사용
  - `getTopicReferenceFiles(topicId: number): Promise<ReferenceFileListDto>`
  - `GET /api/topics/:id/reference-files` → `ReferenceFileListDto`
  - `api.topics.referenceFiles(id: number): Promise<ReferenceFileListDto>`

- [ ] **Step 1: DTO 추가**

`src/lib/api-types.ts` 하단(Generation 타입들 위)에 추가:

```ts
export interface ReferenceFileDto {
  path: string; // referenceDir 기준 상대 경로 (슬래시 구분)
  size: number; // bytes
}

export interface ReferenceFileListDto {
  files: ReferenceFileDto[];
  dirExists: boolean;
}
```

- [ ] **Step 2: 서비스 구현**

`src/server/generation/reference.ts`:

```ts
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isSafeReferencePath } from "@/core/reference-path";
import type { ReferenceFileDto, ReferenceFileListDto } from "@/lib/api-types";
import { prisma } from "../db";
import { ServiceError } from "../errors";

const ALLOWED_EXTENSIONS = new Set([".md", ".txt"]);

export function referenceRoot(): string {
  return path.resolve(process.env.GENERATION_REFERENCE_DIR ?? "generation_reference");
}

function baseDir(referenceDir: string): string {
  if (!isSafeReferencePath(referenceDir)) {
    throw new ServiceError("VALIDATION", "잘못된 참고 자료 폴더 경로입니다", 400);
  }
  return path.join(referenceRoot(), referenceDir);
}

async function walk(dir: string, base: string, out: ReferenceFileDto[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, base, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const info = await stat(abs);
    out.push({
      path: path.relative(base, abs).replaceAll("\\", "/"),
      size: info.size,
    });
  }
}

export async function listReferenceFiles(
  referenceDir: string,
): Promise<ReferenceFileListDto> {
  const base = baseDir(referenceDir);
  const files: ReferenceFileDto[] = [];
  try {
    await walk(base, base, files);
  } catch {
    return { files: [], dirExists: false };
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, dirExists: true };
}

/** 선택 파일들을 검증하고 절대 경로로 변환한다. selected가 비면 빈 배열. */
export async function resolveReferenceFiles(
  referenceDir: string | null,
  selected: string[],
): Promise<string[]> {
  if (selected.length === 0) return [];
  if (!referenceDir) {
    throw new ServiceError(
      "VALIDATION",
      "이 주제에는 참고 자료 폴더가 설정되어 있지 않습니다",
      400,
    );
  }
  const base = baseDir(referenceDir);
  const resolved: string[] = [];
  for (const rel of selected) {
    if (!isSafeReferencePath(rel)) {
      throw new ServiceError("VALIDATION", `잘못된 파일 경로입니다: ${rel}`, 400);
    }
    const abs = path.join(base, rel);
    const exists = await stat(abs).then((s) => s.isFile()).catch(() => false);
    if (!exists) {
      throw new ServiceError(
        "REFERENCE_FILE_NOT_FOUND",
        `참고 자료 파일을 찾을 수 없습니다: ${rel} (목록을 새로고침하세요)`,
        400,
      );
    }
    resolved.push(abs);
  }
  return resolved;
}

export async function getTopicReferenceFiles(
  topicId: number,
): Promise<ReferenceFileListDto> {
  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) {
    throw new ServiceError("NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }
  if (!topic.referenceDir) {
    return { files: [], dirExists: false };
  }
  return listReferenceFiles(topic.referenceDir);
}
```

- [ ] **Step 3: Route Handler 추가**

`src/app/api/topics/[id]/reference-files/route.ts`:

```ts
import { getTopicReferenceFiles } from "@/server/generation/reference";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await getTopicReferenceFiles(parseIdParam(id)));
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 4: api-client 확장**

`src/lib/api-client.ts`의 `topics` 객체에 추가 (import에 `ReferenceFileListDto` 추가):

```ts
    referenceFiles: (id: number) =>
      request<ReferenceFileListDto>(`/api/topics/${id}/reference-files`),
```

- [ ] **Step 5: 확인 후 커밋**

Run: `npx tsc --noEmit` → Expected: 오류 없음
Run: `npm run test` → Expected: 전부 PASS

```bash
git add src/server/generation/reference.ts "src/app/api/topics/[id]/reference-files" src/lib/api-types.ts src/lib/api-client.ts
git commit -m "feat: 참고 자료 파일 목록 조회 서비스와 API 추가"
```

---

### Task 6: 생성 파이프라인에 참고 자료 연결

**Files:**
- Modify: `src/app/api/generate/route.ts`
- Modify: `src/server/generation/generation-service.ts`
- Modify: `src/lib/api-client.ts:111-124` (generate.create)

**Interfaces:**
- Consumes: `resolveReferenceFiles` (Task 5), `buildCliGenerationPrompt`/`buildCliVerifyPrompt`의 `referenceFiles` 파라미터 (Task 3)
- Produces: `POST /api/generate` body에 `referenceFiles: string[]` (상대 경로, 기본 `[]`); 잡 행에 상대 경로 기록; 생성·검증 프롬프트에 절대 경로 주입

- [ ] **Step 1: route zod 확장**

`src/app/api/generate/route.ts`:

```ts
const createSchema = z.object({
  topicId: z.number().int().positive(),
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  verifyEngine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  instructions: z.string().max(4000),
  referenceFiles: z.array(z.string().min(1).max(300)).max(100).default([]),
});
```

- [ ] **Step 2: generation-service 확장**

`src/server/generation/generation-service.ts` 변경점:

import 추가:

```ts
import { resolveReferenceFiles } from "./reference";
```

`createJob` — 입력 타입에 `referenceFiles: string[]` 추가, 실행 중 잡 확인 뒤에 해석, 잡 행에 기록, `runJob`에 절대 경로 전달:

```ts
export async function createJob(input: {
  topicId: number;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  instructions: string;
  referenceFiles: string[];
}): Promise<GenerationJobDto> {
  // ...기존 topic 조회·RUNNING 잡 409 체크 그대로...

  const referenceAbsPaths = await resolveReferenceFiles(
    topic.referenceDir,
    input.referenceFiles,
  );
  const existing = await loadExistingQuestions(input.topicId);

  const job = await prisma.generationJob.create({
    data: {
      topicId: input.topicId,
      engine: input.engine,
      verifyEngine: input.verifyEngine,
      instructions: input.instructions,
      referenceFiles: input.referenceFiles,
    },
  });

  void runJob(job.id, topic.name, input.instructions, existing, referenceAbsPaths).catch(
    (e) => {
      console.error(`generation job ${job.id} failed unexpectedly`, e);
    },
  );

  return toDto(job);
}
```

`runJob` — 시그니처에 `referenceAbsPaths: string[]` 추가, 두 프롬프트 호출에 전달:

```ts
async function runJob(
  jobId: number,
  topicName: string,
  instructions: string,
  existing: ExistingQuestions,
  referenceAbsPaths: string[],
): Promise<void> {
  // ...
  const prompt = buildCliGenerationPrompt(
    topicName,
    instructions,
    resultPath,
    existing,
    referenceAbsPaths,
  );
  // ...검증 단계에서:
  const verifyPrompt = buildCliVerifyPrompt(
    topicName,
    validItems.map((item) => ({ index: item.index, question: item.question })),
    verifyResultPath,
    referenceAbsPaths,
  );
```

- [ ] **Step 3: api-client 확장**

`src/lib/api-client.ts`의 `generate.create` 입력 타입에 추가:

```ts
    create: (input: {
      topicId: number;
      engine: GenerationEngineDto;
      verifyEngine: GenerationEngineDto;
      instructions: string;
      referenceFiles: string[];
    }) =>
```

주의: 이 시점에 `src/app/generate/page.tsx`의 `api.generate.create` 호출이 `referenceFiles` 누락으로 타입 오류가 난다. 임시 방편 없이 이 태스크에서 호출부에 `referenceFiles: []`를 추가해 두고, Task 7에서 실제 선택값으로 교체한다:

```ts
      const { job: created } = await api.generate.create({
        topicId,
        engine,
        verifyEngine,
        instructions,
        referenceFiles: [],
      });
```

- [ ] **Step 4: 확인 후 커밋**

Run: `npx tsc --noEmit` → Expected: 오류 없음
Run: `npm run test` → Expected: 전부 PASS

```bash
git add src/app/api/generate/route.ts src/server/generation/generation-service.ts src/lib/api-client.ts src/app/generate/page.tsx
git commit -m "feat: 생성 잡에 참고 자료 파일 해석·기록·프롬프트 주입 추가"
```

---

### Task 7: /generate 화면 — 참고 자료 파일 체크박스

**Files:**
- Modify: `src/app/generate/page.tsx`

**Interfaces:**
- Consumes: `api.topics.referenceFiles` (Task 5), `TopicDto.referenceDir` (Task 4), `api.generate.create`의 `referenceFiles` (Task 6)

- [ ] **Step 1: 상태·로딩 로직 추가**

`src/app/generate/page.tsx`에 import 추가 (`ReferenceFileListDto`를 api-types import에 추가) 후, 컴포넌트 상단 state 선언부에 추가:

```ts
  const [refList, setRefList] = useState<ReferenceFileListDto | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
```

주제 변경 시 파일 목록 로딩 (기존 useEffect들 아래에 추가):

```ts
  const selectedTopic = topics.find((topic) => topic.id === topicId);

  useEffect(() => {
    setRefList(null);
    setSelectedFiles(new Set());
    if (topicId === "") return;
    const topic = topics.find((item) => item.id === topicId);
    if (!topic?.referenceDir) return;

    let ignore = false;
    api.topics
      .referenceFiles(topicId)
      .then((list) => {
        if (ignore) return;
        setRefList(list);
        setSelectedFiles(new Set(list.files.map((file) => file.path)));
      })
      .catch(() => {
        if (!ignore) setRefList({ files: [], dirExists: false });
      });
    return () => {
      ignore = true;
    };
  }, [topicId, topics]);

  function toggleFile(filePath: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }
```

- [ ] **Step 2: 체크박스 섹션 렌더링**

"주제 선택" 섹션과 "엔진과 추가 지시" 섹션 사이에 추가:

```tsx
      {selectedTopic?.referenceDir && (
        <section className="surface surface-pad space-y-3">
          <h2 className="section-title">참고 자료</h2>
          <p className="muted text-sm">
            generation_reference/{selectedTopic.referenceDir}/ — 선택한 파일을
            에이전트가 읽고 근거로 출제합니다
          </p>
          {refList === null ? (
            <p className="muted text-sm">파일 목록을 불러오는 중...</p>
          ) : !refList.dirExists || refList.files.length === 0 ? (
            <p className="text-sm text-[color:var(--warning)]">
              ⚠️ 참고 자료가 없습니다 — generation_reference/
              {selectedTopic.referenceDir}/ 에 md/txt 파일을 넣으세요
            </p>
          ) : (
            <div className="space-y-1">
              {refList.files.map((file) => (
                <label key={file.path} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file.path)}
                    onChange={() => toggleFile(file.path)}
                  />
                  <span className="min-w-0 flex-1 break-all">{file.path}</span>
                  <span className="subtle shrink-0 text-xs">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>
      )}
```

- [ ] **Step 3: 생성 요청에 선택 파일 포함**

`startGeneration`의 Task 6 임시값 `referenceFiles: []`를 교체:

```ts
        referenceFiles: selectedTopic?.referenceDir ? [...selectedFiles] : [],
```

- [ ] **Step 4: 확인**

Run: `npx tsc --noEmit` → Expected: 오류 없음
Run: `npm run lint` → Expected: 오류 없음

- [ ] **Step 5: Commit**

```bash
git add src/app/generate/page.tsx
git commit -m "feat: /generate에 참고 자료 파일 선택 체크박스 추가"
```

---

### Task 8: 문제 관리 화면 — 참고 자료 폴더 설정 버튼

**Files:**
- Modify: `src/app/questions/page.tsx:113-145` (renameTopic 함수 근처)

**Interfaces:**
- Consumes: `api.topics.update`의 `referenceDir` (Task 4), `TopicDto.referenceDir`

- [ ] **Step 1: 설정 함수 추가**

`renameTopic` 함수 아래에 추가 (기존 `window.prompt` 패턴 그대로):

```ts
  async function editReferenceDir() {
    if (topicId === "") return;
    const current = topics.find((topic) => topic.id === topicId);
    const dir = window.prompt(
      "참고 자료 폴더 (generation_reference/ 기준 상대 경로, 비우면 해제)",
      current?.referenceDir ?? "",
    );
    if (dir === null) return;

    try {
      await api.topics.update(topicId, {
        referenceDir: dir.trim() === "" ? null : dir.trim(),
      });
      await reload({
        selectedTopicId: topicId,
        selectedType: typeFilter,
        selectedSort: sort,
        selectedPage: page,
      });
      setMessage("✅ 참고 자료 폴더를 설정했습니다");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "참고 자료 폴더 설정 실패",
      );
    }
  }
```

- [ ] **Step 2: 버튼 추가**

"주제 이름 변경" 버튼과 "주제 삭제" 버튼 사이에 추가:

```tsx
            <button
              onClick={editReferenceDir}
              className="btn btn-secondary min-h-9 px-3 text-sm"
            >
              참고 자료 폴더
            </button>
```

- [ ] **Step 3: 확인**

Run: `npx tsc --noEmit` → Expected: 오류 없음
Run: `npm run lint` → Expected: 오류 없음

주의: 성공 메시지가 기존 danger 색상 문단(`text-[color:var(--danger)]`)으로 렌더링된다. 이 화면의 `message`는 오류 전용이었으므로, ✅ 메시지도 같은 위치에 표시되는 것은 허용한다 (기존 패턴 유지, 색상 리팩터링은 범위 외).

- [ ] **Step 4: Commit**

```bash
git add src/app/questions/page.tsx
git commit -m "feat: 문제 관리에서 주제 참고 자료 폴더 설정 버튼 추가"
```

---

### Task 9: 수동 E2E 검증 + README 사용 안내

**Files:**
- Modify: `README.md` (AI 생성 사용 안내 부근)
- 로컬 전용(커밋 안 함): `generation_reference/aip-c01/` 샘플 자료

**Interfaces:**
- Consumes: Task 1–8 전부

- [ ] **Step 1: 샘플 참고 자료 준비**

```bash
mkdir -p generation_reference/aip-c01/common
```

`generation_reference/aip-c01/common/00-exam-guide.md`에 실제 AIP-C01 Exam Guide 요약을 넣는다 (최소한 도메인 5개와 in-scope 서비스 몇 개 — `docs/aip-c01-reference-data.md`의 목록 참조). 파일 상단에 `> 스냅샷: 2026-07 기준` 명시.

- [ ] **Step 2: 앱 실행 + 주제 설정**

Run: `docker-compose up -d` 후 `npm run dev`

브라우저에서:
1. 문제 관리 → 주제 생성이 없으므로 /generate 또는 /import에서 새 주제 "AIP-C01 D1 — FM 통합" 추가
2. 문제 관리 → 해당 주제 선택 → "참고 자료 폴더" 버튼 → `aip-c01` 입력
3. 잘못된 값(`../etc`) 입력 시 오류 메시지 확인

- [ ] **Step 3: 생성 E2E**

/generate에서:
1. 주제 선택 → "참고 자료" 섹션에 `common/00-exam-guide.md` 체크박스(기본 체크)와 KB 표시 확인
2. 추가 지시 "이 주제에서 쉬운 문제 3개만" → 생성 시작 (엔진 claude)
3. `generation_output/jobs/<id>/prompt.md`에 "## 참고 자료" 섹션과 절대 경로 포함 확인
4. `verify-prompt.md`에도 같은 섹션 포함 확인
5. 미리보기에서 문제가 자료 내용(도메인·서비스)에 근거하는지 확인 → 저장 → "✅ N개 문제를 저장했습니다"

- [ ] **Step 4: README 사용 안내 추가**

README.md의 AI 생성 안내 부근에 다음 요지 추가 (기존 문체 따라):

```markdown
### 참고 자료 기반 생성

- 문제 관리에서 주제에 "참고 자료 폴더"를 설정하면(예: `aip-c01`),
  `generation_reference/<폴더>/`의 md/txt 파일을 /generate에서 선택해
  에이전트가 읽고 근거로 출제·검증한다.
- 최신 시험처럼 모델 학습 데이터가 부족한 주제에 사용한다.
  AIP-C01 자료 구성은 `docs/aip-c01-reference-data.md` 참조.
- `generation_reference/`는 git에 커밋되지 않는다.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: 참고 자료 기반 생성 사용 안내 추가"
```

---

## Self-Review 결과

- **Spec coverage**: 스키마(Task 1), 경로 안전성(Task 2), 프롬프트 생성·검증 주입(Task 3·6), referenceDir 노출·수정(Task 4), 파일 목록 API(Task 5), 생성 파이프라인(Task 6), /generate 체크박스(Task 7), 주제 폴더 설정 UI(Task 8), 오류 처리(Task 2·5·6의 VALIDATION/REFERENCE_FILE_NOT_FOUND, 파일 무시 지시는 Task 3), 수동 검증(Task 9) — 스펙 전 항목 매핑됨
- **Placeholder scan**: 없음
- **Type consistency**: `isSafeReferencePath`·`resolveReferenceFiles`·`ReferenceFileListDto`·`referenceFiles: string[] = []` 명칭이 태스크 간 일치함을 확인
