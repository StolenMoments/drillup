# AI 문제 생성 (CLI non-interactive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹 화면(`/generate`)에서 주제·엔진·추가 지시를 입력하면 서버가 로컬 CLI(claude/codex/antigravity)를 non-interactive로 실행해 JSON 규격 문제를 생성하고, 미리보기 후 기존 `/api/import`로 DB에 저장한다.

**Architecture:** 잡 생성 + 폴링. `GenerationJob` Prisma 모델(기존 MariaDB), CLI 커맨드 빌더는 `src/core/engine-command.ts`(순수, 주입식), 실행기·잡 서비스는 `src/server/generation/`, Route Handler 2개(`POST /api/generate`, `GET /api/generate/[id]`)는 얇은 어댑터. 결과는 파일 기반(`generation_output/jobs/<id>/result.json`)으로 받는다. 설계서: `docs/superpowers/specs/2026-07-08-ai-generation-design.md`

**Tech Stack:** Next.js 15+ (App Router, TypeScript strict), Prisma + MariaDB, zod, vitest, Node `child_process`

## Global Constraints (설계서·00-overview에서 발췌 — 모든 태스크에 적용)

- Node 22+, npm. TypeScript strict, `any` 금지 — payload 캐스팅은 `as unknown as T` 형태만 허용.
- `src/core/`는 순수 TS: Next.js·Prisma·Node 전용 API import 금지 (zod 허용). Node 의존성은 주입으로 해결.
- `src/server/`는 Next.js import 금지 (Prisma, core만).
- Route Handler는 얇게: `parseBody`(zod) → 서비스 호출 → `jsonOk`. 오류는 `handleApiError`.
- 화면 코드는 fetch 직접 호출 금지 — `src/lib/api-client.ts`의 `api` 객체만 사용.
- API 오류 응답 형식: `{ "error": { "code": string, "message": string } }`.
- UI 문구는 한국어, 사용자 피드백 문구에 가벼운 이모지 유지(✅/❌ 등).
- 커밋 메시지는 한국어 + conventional commit 접두사(`feat:`/`fix:`/`test:`/`chore:`/`docs:`). 태스크마다 1커밋.
- 테스트는 vitest, 대상 파일 옆 `*.test.ts`. core만 자동 테스트, 서비스 계층은 수동 검증.
- CLI 호출 파라미터는 GREED(`D:\work\GREED\backend\routers\jobs.py`) 검증 방식 그대로.
- `.env` 커밋 금지, `.env.example`만 커밋.

## 파일 구조 지도 (이번 작업으로 생기거나 바뀌는 것)

```
prisma/schema.prisma                     # 수정: GenerationJob 모델·enum 추가
.gitignore                               # 수정: generation_output/ 추가
.env.example                             # 수정: GENERATION_TIMEOUT_MS 안내 추가
src/core/prompt-template.ts              # 수정: buildCliGenerationPrompt 추가(본문 공용화)
src/core/prompt-template.test.ts         # 생성
src/core/json-extract.ts                 # 생성: 관용적 JSON 추출
src/core/json-extract.test.ts            # 생성
src/core/engine-command.ts               # 생성: 엔진 커맨드 빌더(순수·주입식)
src/core/engine-command.test.ts          # 생성
src/server/generation/run-engine.ts      # 생성: spawn 실행기(타임아웃·로그·result.json)
src/server/generation/generation-service.ts  # 생성: createJob/getJob/runJob
src/lib/api-types.ts                     # 수정: GenerationJobDto 등 추가
src/lib/api-client.ts                    # 수정: api.generate 추가
src/app/api/generate/route.ts            # 생성: POST
src/app/api/generate/[id]/route.ts       # 생성: GET
src/components/QuestionPreview.tsx       # 생성: /import에서 추출한 공용 미리보기
src/app/import/page.tsx                  # 수정: QuestionPreview를 공용 컴포넌트로 교체
src/app/generate/page.tsx                # 생성: AI 생성 화면
src/app/layout.tsx                       # 수정: 내비에 "AI 생성" 링크
README.md                                # 수정: AI 생성 기능 안내
```

---

### Task 1: DB 스키마 — GenerationJob 모델

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `.gitignore`

**Interfaces:**
- Produces: Prisma 모델 `GenerationJob`(필드: `id`, `topicId`, `engine`, `instructions`, `status`, `result`, `errorMessage`, `rawOutput`, `createdAt`, `finishedAt`), enum `GenerationEngine`(CLAUDE/CODEX/ANTIGRAVITY), `GenerationStatus`(RUNNING/SUCCEEDED/FAILED). Task 6이 `prisma.generationJob`으로 사용.

- [ ] **Step 1: 스키마에 enum과 모델 추가**

`prisma/schema.prisma`의 `enum ReviewMode` 아래에 추가:

```prisma
enum GenerationEngine {
  CLAUDE
  CODEX
  ANTIGRAVITY
}

enum GenerationStatus {
  RUNNING
  SUCCEEDED
  FAILED
}
```

파일 끝(`ReviewLog` 모델 뒤)에 추가:

```prisma
model GenerationJob {
  id           Int              @id @default(autoincrement())
  topicId      Int              @map("topic_id")
  engine       GenerationEngine
  instructions String           @db.Text
  status       GenerationStatus @default(RUNNING)
  result       Json?
  errorMessage String?          @map("error_message") @db.Text
  rawOutput    String?          @map("raw_output") @db.MediumText
  createdAt    DateTime         @default(now()) @map("created_at")
  finishedAt   DateTime?        @map("finished_at")
  topic        Topic            @relation(fields: [topicId], references: [id], onDelete: Cascade)

  @@map("generation_job")
}
```

`Topic` 모델의 `questions   Question[]` 줄 아래에 역방향 관계 추가:

```prisma
  generationJobs GenerationJob[]
```

- [ ] **Step 2: 마이그레이션 실행**

Run: `npx prisma migrate dev --name add_generation_job`
Expected: `prisma/migrations/..._add_generation_job/migration.sql` 생성, "Your database is now in sync" 메시지, Prisma Client 재생성.

- [ ] **Step 3: .gitignore에 출력 디렉터리 추가**

`.gitignore`의 `# misc` 섹션 위에 추가:

```
# AI generation job output
/generation_output/
```

- [ ] **Step 4: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 오류 없음.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations .gitignore
git commit -m "feat: AI 생성 잡 테이블(generation_job) 스키마 추가"
```

---

### Task 2: core — CLI용 프롬프트 조립

**Files:**
- Modify: `src/core/prompt-template.ts`
- Test: `src/core/prompt-template.test.ts`

**Interfaces:**
- Consumes: 기존 `buildGenerationPrompt(topicName: string): string` (동작 유지 필수)
- Produces: `buildCliGenerationPrompt(topicName: string, instructions: string, resultPath: string): string` — Task 6의 `runJob`이 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/prompt-template.test.ts` 생성:

```ts
import { describe, expect, it } from "vitest";
import {
  buildCliGenerationPrompt,
  buildGenerationPrompt,
} from "./prompt-template";

describe("buildGenerationPrompt (기존 수동용)", () => {
  it("주제명과 수동 사용 안내 문구를 포함한다", () => {
    const prompt = buildGenerationPrompt("리눅스 기초");
    expect(prompt).toContain('"리눅스 기초"');
    expect(prompt).toContain("여기에 범위, 난이도, 문제 수 같은 조건을 추가해 사용하세요");
    expect(prompt).toContain('"questions"');
  });
});

describe("buildCliGenerationPrompt", () => {
  it("주제명·추가 지시·결과 저장 경로를 포함한다", () => {
    const prompt = buildCliGenerationPrompt(
      "리눅스 기초",
      "쉬운 난이도로 5문제",
      "D:\\work\\drillup\\generation_output\\jobs\\1\\result.json",
    );
    expect(prompt).toContain('"리눅스 기초"');
    expect(prompt).toContain("쉬운 난이도로 5문제");
    expect(prompt).toContain(
      "D:\\work\\drillup\\generation_output\\jobs\\1\\result.json",
    );
    expect(prompt).toContain("stdout에 출력하지 마세요");
  });

  it("추가 지시가 공백뿐이면 (없음)으로 표기한다", () => {
    const prompt = buildCliGenerationPrompt("리눅스 기초", "   ", "D:\\r.json");
    expect(prompt).toContain("(없음)");
  });

  it("수동용 안내 문구를 포함하지 않는다", () => {
    const prompt = buildCliGenerationPrompt("리눅스 기초", "", "D:\\r.json");
    expect(prompt).not.toContain("여기에 범위, 난이도, 문제 수 같은 조건을 추가해 사용하세요");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: FAIL — `buildCliGenerationPrompt`가 export되지 않음.

- [ ] **Step 3: 구현**

`src/core/prompt-template.ts` 전체를 다음으로 교체(기존 본문을 `promptBody`로 추출하고, 수동용/CLI용 두 조립 함수 제공 — 기존 `buildGenerationPrompt` 출력은 그대로 유지):

```ts
function promptBody(topicName: string): string {
  return `당신은 학습용 문제 출제 전문가입니다. 주제 "${topicName}"에 대한 학습 문제를 생성해 주세요.

## 출력 형식

다른 설명 없이 아래 구조의 JSON만 출력하세요. 코드 펜스(\`\`\`)를 쓰지 마세요.

{
  "questions": [
    {
      "type": "mcq",
      "question": "질문 텍스트",
      "choices": ["보기1", "보기2", "보기3", "보기4"],
      "answer_index": 0,
      "explanation": "정답에 대한 간결한 해설"
    },
    {
      "type": "cloze",
      "text": "핵심 개념을 설명하는 문장. 중요한 단어 자리는 {{1}}, {{2}} 형태의 빈칸으로 둔다.",
      "blanks": [
        { "id": 1, "answer": "빈칸1의 정답 단어" },
        { "id": 2, "answer": "빈칸2의 정답 단어" }
      ],
      "distractors": ["그럴듯한 오답 단어1", "오답 단어2"],
      "explanation": "해설"
    }
  ]
}

## 규칙

- mcq: choices는 정확히 4개, 중복 금지, answer_index는 0~3.
- cloze: text의 {{n}} 자리표시자와 blanks의 id가 정확히 일치해야 함.
- cloze: distractors는 1개 이상이며 정답 단어와 겹치면 안 됨.
- cloze: 빈칸은 문장의 핵심 개념 단어에만 넣을 것.
- explanation은 한두 문장으로 간결하게 작성.
- 두 유형(mcq, cloze)을 섞어서 출제할 것.
`;
}

export function buildGenerationPrompt(topicName: string): string {
  return `${promptBody(topicName)}
## 추가 지시

여기에 범위, 난이도, 문제 수 같은 조건을 추가해 사용하세요.
`;
}

export function buildCliGenerationPrompt(
  topicName: string,
  instructions: string,
  resultPath: string,
): string {
  const extra = instructions.trim();
  return `${promptBody(topicName)}
## 추가 지시

${extra || "(없음)"}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: 전체 테스트로 회귀 확인**

Run: `npx vitest run`
Expected: 전부 PASS (기존 import 화면이 쓰는 `buildGenerationPrompt` 출력 불변).

- [ ] **Step 6: Commit**

```bash
git add src/core/prompt-template.ts src/core/prompt-template.test.ts
git commit -m "feat: CLI 생성용 프롬프트 조립 함수 추가(본문 공용화)"
```

---

### Task 3: core — 관용적 JSON 추출

**Files:**
- Create: `src/core/json-extract.ts`
- Test: `src/core/json-extract.test.ts`

**Interfaces:**
- Produces: `extractJsonObject(raw: string): string` — 첫 `{`부터 마지막 `}`까지 절단, 없으면 원문 그대로 반환. Task 6의 `runJob`이 `parseImportJson` 앞단에서 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/json-extract.test.ts` 생성:

```ts
import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./json-extract";

describe("extractJsonObject", () => {
  it("순수 JSON은 그대로 반환한다", () => {
    expect(extractJsonObject('{"questions": []}')).toBe('{"questions": []}');
  });

  it("코드 펜스로 감싼 JSON에서 객체만 추출한다", () => {
    expect(extractJsonObject('```json\n{"questions": []}\n```')).toBe(
      '{"questions": []}',
    );
  });

  it("앞뒤 설명 문장을 제거한다", () => {
    expect(
      extractJsonObject('생성 결과입니다.\n{"questions": [{"a": 1}]}\n확인해 주세요.'),
    ).toBe('{"questions": [{"a": 1}]}');
  });

  it("중괄호가 없으면 원문을 그대로 반환한다", () => {
    expect(extractJsonObject("JSON이 아닌 응답")).toBe("JSON이 아닌 응답");
  });

  it("닫는 중괄호가 여는 것보다 앞에만 있으면 원문을 그대로 반환한다", () => {
    expect(extractJsonObject("} 잘못된 {")).toBe("} 잘못된 {");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/core/json-extract.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/core/json-extract.ts` 생성:

```ts
export function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return raw;
  return raw.slice(start, end + 1);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/json-extract.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/json-extract.ts src/core/json-extract.test.ts
git commit -m "feat: 모델 응답에서 JSON 객체를 관용적으로 추출하는 유틸 추가"
```

---

### Task 4: core — 엔진 커맨드 빌더 (GREED 파라미터 준용)

**Files:**
- Create: `src/core/engine-command.ts`
- Test: `src/core/engine-command.test.ts`

**Interfaces:**
- Produces:
  - `type EngineName = "CLAUDE" | "CODEX" | "ANTIGRAVITY"`
  - `interface EngineEnv { homeDir: string; localAppData: string | null; fileExists: (path: string) => boolean }`
  - `interface EngineCommand { command: string; args: string[]; promptViaStdin: boolean }`
  - `buildEngineCommand(engine: EngineName, promptPath: string, env: EngineEnv): EngineCommand`
- Task 5의 `runEngine`이 Node의 `homedir()`/`existsSync`를 주입해 사용. core 순수성 유지를 위해 Node API는 전부 주입식.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/engine-command.test.ts` 생성:

```ts
import { describe, expect, it } from "vitest";
import { buildEngineCommand, type EngineEnv } from "./engine-command";

function env(existing: string[] = []): EngineEnv {
  return {
    homeDir: "C:\\Users\\me",
    localAppData: "C:\\Users\\me\\AppData\\Local",
    fileExists: (path: string) => existing.includes(path),
  };
}

describe("buildEngineCommand — CLAUDE", () => {
  it("존재하는 첫 번째 claude.exe를 쓰고 프롬프트는 stdin으로 받는다", () => {
    const exe = "C:\\Users\\me\\.local\\bin\\claude.exe";
    const cmd = buildEngineCommand("CLAUDE", "D:\\p\\prompt.md", env([exe]));
    expect(cmd.command).toBe(exe);
    expect(cmd.args).toEqual([
      "--dangerously-skip-permissions",
      "--model",
      "sonnet",
      "-p",
    ]);
    expect(cmd.promptViaStdin).toBe(true);
  });

  it("exe가 없으면 claude.cmd로 폴백한다", () => {
    const cmd = buildEngineCommand("CLAUDE", "D:\\p\\prompt.md", env());
    expect(cmd.command).toBe("claude.cmd");
  });
});

describe("buildEngineCommand — CODEX", () => {
  it("npm 레이아웃의 codex.exe를 찾아 exec --yolo - 로 실행한다", () => {
    const exe =
      "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe";
    const cmd = buildEngineCommand("CODEX", "D:\\p\\prompt.md", env([exe]));
    expect(cmd.command).toBe(exe);
    expect(cmd.args).toEqual(["exec", "--yolo", "-"]);
    expect(cmd.promptViaStdin).toBe(true);
  });

  it("exe가 없으면 codex.cmd로 폴백한다", () => {
    const cmd = buildEngineCommand("CODEX", "D:\\p\\prompt.md", env());
    expect(cmd.command).toBe("codex.cmd");
  });
});

describe("buildEngineCommand — ANTIGRAVITY", () => {
  it("프롬프트 파일 경로 지시와 모델명을 인자로 넘기고 stdin은 쓰지 않는다", () => {
    const exe = "C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe";
    const cmd = buildEngineCommand("ANTIGRAVITY", "D:\\p\\prompt.md", env([exe]));
    expect(cmd.command).toBe(exe);
    expect(cmd.args[0]).toBe("--dangerously-skip-permissions");
    expect(cmd.args[1]).toBe("-p");
    expect(cmd.args[2]).toContain('"D:\\p\\prompt.md"');
    expect(cmd.args[3]).toBe("--model");
    expect(cmd.args[4]).toBe("Gemini 3.1 Pro (High)");
    expect(cmd.promptViaStdin).toBe(false);
  });

  it("localAppData가 없으면 홈 기준 경로를 탐색하고, 없으면 agy.exe로 폴백한다", () => {
    const noLocal: EngineEnv = { ...env(), localAppData: null };
    const cmd = buildEngineCommand("ANTIGRAVITY", "D:\\p\\prompt.md", noLocal);
    expect(cmd.command).toBe("agy.exe");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/core/engine-command.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/core/engine-command.ts` 생성:

```ts
export type EngineName = "CLAUDE" | "CODEX" | "ANTIGRAVITY";

export interface EngineEnv {
  homeDir: string;
  localAppData: string | null;
  fileExists: (path: string) => boolean;
}

export interface EngineCommand {
  command: string;
  args: string[];
  promptViaStdin: boolean;
}

const AGY_MODEL = "Gemini 3.1 Pro (High)";

function winJoin(...parts: string[]): string {
  return parts.join("\\");
}

function firstExisting(candidates: string[], env: EngineEnv, fallback: string): string {
  return candidates.find((candidate) => env.fileExists(candidate)) ?? fallback;
}

// GREED backend/routers/jobs.py에서 검증된 호출 방식 그대로.
// .cmd 배치 래퍼는 exit code/stdin 전달 문제가 있어 exe 직접 호출을 우선한다.
export function buildEngineCommand(
  engine: EngineName,
  promptPath: string,
  env: EngineEnv,
): EngineCommand {
  if (engine === "CLAUDE") {
    const command = firstExisting(
      [
        winJoin(env.homeDir, ".local", "bin", "claude.exe"),
        winJoin(
          env.homeDir,
          "AppData",
          "Roaming",
          "npm",
          "node_modules",
          "@anthropic-ai",
          "claude-code",
          "bin",
          "claude.exe",
        ),
      ],
      env,
      "claude.cmd",
    );
    return {
      command,
      args: ["--dangerously-skip-permissions", "--model", "sonnet", "-p"],
      promptViaStdin: true,
    };
  }

  if (engine === "CODEX") {
    const npmRoot = winJoin(
      env.homeDir,
      "AppData",
      "Roaming",
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
    );
    const command = firstExisting(
      [
        winJoin(npmRoot, "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"),
        winJoin(npmRoot, "codex-win32-arm64", "vendor", "aarch64-pc-windows-msvc", "bin", "codex.exe"),
        winJoin(npmRoot, "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "codex", "codex.exe"),
        winJoin(npmRoot, "codex-win32-arm64", "vendor", "aarch64-pc-windows-msvc", "codex", "codex.exe"),
      ],
      env,
      "codex.cmd",
    );
    return { command, args: ["exec", "--yolo", "-"], promptViaStdin: true };
  }

  const instruction =
    `Read the UTF-8 prompt file at "${promptPath}" and follow every instruction in it. ` +
    "Create the requested JSON output file; do not summarize the prompt itself.";
  const candidates = [
    ...(env.localAppData ? [winJoin(env.localAppData, "agy", "bin", "agy.exe")] : []),
    winJoin(env.homeDir, "AppData", "Local", "agy", "bin", "agy.exe"),
  ];
  const command = firstExisting(candidates, env, "agy.exe");
  return {
    command,
    args: ["--dangerously-skip-permissions", "-p", instruction, "--model", AGY_MODEL],
    promptViaStdin: false,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/engine-command.test.ts`
Expected: PASS (6 tests).

주의: `localAppData: null` 테스트에서 홈 기준 경로(`C:\Users\me\AppData\Local\agy\bin\agy.exe`)도 `fileExists`가 false이므로 `agy.exe` 폴백이 맞다.

- [ ] **Step 5: Commit**

```bash
git add src/core/engine-command.ts src/core/engine-command.test.ts
git commit -m "feat: 엔진별 CLI 커맨드 빌더 추가(GREED 검증 파라미터 준용)"
```

---

### Task 5: server — CLI 실행기 (run-engine)

**Files:**
- Create: `src/server/generation/run-engine.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `buildEngineCommand`, `EngineName` (Task 4)
- Produces (Task 6이 사용):
  - `runEngine(engine: EngineName, prompt: string, jobId: number): Promise<EngineRunResult>` — `EngineRunResult = { ok: true; resultText: string } | { ok: false; failureReason: string }`
  - `jobOutputDir(jobId: number): string` — `<프로젝트루트>/generation_output/jobs/<jobId>` 절대 경로
  - `generationTimeoutMs(): number` — 기본 600000(10분), `GENERATION_TIMEOUT_MS`로 조정

프로젝트 규약대로 서비스 계층 자동 테스트는 없다. 검증은 Task 7의 curl 수동 검증과 Task 10의 실엔진 통합 검증에서 수행.

- [ ] **Step 1: 구현**

`src/server/generation/run-engine.ts` 생성:

```ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { buildEngineCommand, type EngineName } from "@/core/engine-command";

const LOG_TAIL_CHARS = 1200;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export type EngineRunResult =
  | { ok: true; resultText: string }
  | { ok: false; failureReason: string };

export function generationTimeoutMs(): number {
  const raw = Number(process.env.GENERATION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

export function jobOutputDir(jobId: number): string {
  return path.resolve("generation_output", "jobs", String(jobId));
}

function tail(text: string): string {
  return text.trim().slice(-LOG_TAIL_CHARS);
}

interface SpawnExit {
  code: number | null;
  error: Error | null;
  timedOut: boolean;
}

export async function runEngine(
  engine: EngineName,
  prompt: string,
  jobId: number,
): Promise<EngineRunResult> {
  const dir = jobOutputDir(jobId);
  await mkdir(dir, { recursive: true });
  const promptPath = path.join(dir, "prompt.md");
  const resultPath = path.join(dir, "result.json");
  await writeFile(promptPath, prompt, "utf-8");

  const cmd = buildEngineCommand(engine, promptPath, {
    homeDir: homedir(),
    localAppData: process.env.LOCALAPPDATA ?? null,
    fileExists: existsSync,
  });

  let stdout = "";
  let stderr = "";
  const exit = await new Promise<SpawnExit>((resolve) => {
    let settled = false;
    const settle = (value: SpawnExit) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    // .cmd 배치 폴백은 shell 없이는 spawn이 EINVAL로 실패한다(Node 22).
    const child = spawn(cmd.command, cmd.args, {
      shell: cmd.command.toLowerCase().endsWith(".cmd"),
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      child.kill();
      settle({ code: null, error: null, timedOut: true });
    }, generationTimeoutMs());

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      settle({ code: null, error, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      settle({ code, error: null, timedOut: false });
    });

    if (cmd.promptViaStdin) {
      child.stdin.write(prompt, "utf-8");
    }
    child.stdin.end();
  });

  await writeFile(path.join(dir, "stdout.log"), stdout, "utf-8").catch(() => undefined);
  await writeFile(path.join(dir, "stderr.log"), stderr, "utf-8").catch(() => undefined);

  const logTail = [
    stdout.trim() ? `stdout: ${tail(stdout)}` : "",
    stderr.trim() ? `stderr: ${tail(stderr)}` : "",
  ]
    .filter(Boolean)
    .join("; ");

  if (exit.error) {
    return {
      ok: false,
      failureReason: `${engine} 엔진 실행 파일을 찾을 수 없습니다 (${cmd.command}): ${exit.error.message}`,
    };
  }
  if (exit.timedOut) {
    return {
      ok: false,
      failureReason: `시간 초과(${Math.round(generationTimeoutMs() / 1000)}초)로 중단했습니다${logTail ? `; ${logTail}` : ""}`,
    };
  }

  const resultText = await readFile(resultPath, "utf-8").catch(() => null);
  if (resultText === null || resultText.trim() === "") {
    return {
      ok: false,
      failureReason: `result.json이 생성되지 않았습니다 (exit_code=${exit.code ?? "unknown"})${logTail ? `; ${logTail}` : ""}`,
    };
  }
  return { ok: true, resultText };
}
```

- [ ] **Step 2: .env.example에 타임아웃 안내 추가**

`.env.example` 끝에 추가:

```
# (선택) AI 생성 CLI 타임아웃(밀리초). 미설정 시 600000(10분)
# GENERATION_TIMEOUT_MS=600000
```

- [ ] **Step 3: 타입·린트 확인**

Run: `npx tsc --noEmit; if ($?) { npm run lint }`
Expected: 둘 다 오류 없음.

- [ ] **Step 4: Commit**

```bash
git add src/server/generation/run-engine.ts .env.example
git commit -m "feat: CLI 엔진 spawn 실행기 추가(타임아웃·로그·파일 기반 결과 수집)"
```

---

### Task 6: server — 잡 서비스 + DTO

**Files:**
- Modify: `src/lib/api-types.ts`
- Create: `src/server/generation/generation-service.ts`

**Interfaces:**
- Consumes: `prisma.generationJob`(Task 1), `buildCliGenerationPrompt`(Task 2), `extractJsonObject`(Task 3), `runEngine`/`jobOutputDir`/`generationTimeoutMs`(Task 5), 기존 `parseImportJson`, `ServiceError`
- Produces (Task 7이 사용):
  - `createJob(input: { topicId: number; engine: GenerationEngineDto; instructions: string }): Promise<GenerationJobDto>` — 오류: `TOPIC_NOT_FOUND`(404), `JOB_ALREADY_RUNNING`(409)
  - `getJob(id: number): Promise<GenerationJobDto>` — 오류: `JOB_NOT_FOUND`(404)
  - DTO 타입 `GenerationEngineDto`, `GenerationStatusDto`, `GenerationJobDto`, `GenerationItemDto`

- [ ] **Step 1: DTO 추가**

`src/lib/api-types.ts` 끝에 추가:

```ts
export type GenerationEngineDto = "CLAUDE" | "CODEX" | "ANTIGRAVITY";
export type GenerationStatusDto = "RUNNING" | "SUCCEEDED" | "FAILED";

export type GenerationItemDto =
  | { index: number; ok: true; question: unknown }
  | { index: number; ok: false; errors: string[] };

export interface GenerationJobDto {
  id: number;
  topicId: number;
  engine: GenerationEngineDto;
  status: GenerationStatusDto;
  items: GenerationItemDto[] | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}
```

- [ ] **Step 2: 잡 서비스 구현**

`src/server/generation/generation-service.ts` 생성:

```ts
import path from "node:path";
import type { GenerationJob, Prisma } from "@prisma/client";
import { parseImportJson } from "@/core/import-schema";
import { extractJsonObject } from "@/core/json-extract";
import { buildCliGenerationPrompt } from "@/core/prompt-template";
import type { GenerationEngineDto, GenerationJobDto } from "@/lib/api-types";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { generationTimeoutMs, jobOutputDir, runEngine } from "./run-engine";

// 서버 재시작으로 고아가 된 RUNNING 잡을 조회 시점에 정리할 때 쓰는 여유 시간.
// 정상 경로에서는 runEngine의 자체 타임아웃이 먼저 동작한다.
const ORPHAN_GRACE_MS = 60_000;

function toDto(job: GenerationJob): GenerationJobDto {
  return {
    id: job.id,
    topicId: job.topicId,
    engine: job.engine,
    status: job.status,
    items:
      job.status === "SUCCEEDED"
        ? (job.result as unknown as GenerationJobDto["items"])
        : null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export async function createJob(input: {
  topicId: number;
  engine: GenerationEngineDto;
  instructions: string;
}): Promise<GenerationJobDto> {
  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) {
    throw new ServiceError("TOPIC_NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }

  const running = await prisma.generationJob.findFirst({
    where: { topicId: input.topicId, status: "RUNNING" },
  });
  if (running) {
    throw new ServiceError(
      "JOB_ALREADY_RUNNING",
      "이미 생성 중인 작업이 있습니다",
      409,
    );
  }

  const job = await prisma.generationJob.create({
    data: {
      topicId: input.topicId,
      engine: input.engine,
      instructions: input.instructions,
    },
  });

  void runJob(job.id, topic.name, input.instructions).catch((e) => {
    console.error(`generation job ${job.id} failed unexpectedly`, e);
  });

  return toDto(job);
}

async function runJob(
  jobId: number,
  topicName: string,
  instructions: string,
): Promise<void> {
  const resultPath = path.join(jobOutputDir(jobId), "result.json");
  const prompt = buildCliGenerationPrompt(topicName, instructions, resultPath);

  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return;

  const run = await runEngine(job.engine, prompt, jobId);
  if (!run.ok) {
    await failJob(jobId, run.failureReason, null);
    return;
  }

  const parsed = parseImportJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    await failJob(
      jobId,
      `${parsed.fatal}; 원문 앞 300자: ${run.resultText.slice(0, 300)}`,
      run.resultText,
    );
    return;
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      result: parsed.items as unknown as Prisma.InputJsonValue,
      rawOutput: run.resultText,
      finishedAt: new Date(),
    },
  });
}

async function failJob(
  jobId: number,
  message: string,
  rawOutput: string | null,
): Promise<void> {
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      errorMessage: message,
      rawOutput,
      finishedAt: new Date(),
    },
  });
}

export async function getJob(id: number): Promise<GenerationJobDto> {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  if (!job) {
    throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  }

  if (
    job.status === "RUNNING" &&
    Date.now() - job.createdAt.getTime() > generationTimeoutMs() + ORPHAN_GRACE_MS
  ) {
    const updated = await prisma.generationJob.update({
      where: { id },
      data: {
        status: "FAILED",
        errorMessage: "시간 초과 또는 서버 재시작으로 중단되었습니다",
        finishedAt: new Date(),
      },
    });
    return toDto(updated);
  }

  return toDto(job);
}
```

- [ ] **Step 3: 타입·린트·전체 테스트 확인**

Run: `npx tsc --noEmit; if ($?) { npm run lint }; if ($?) { npx vitest run }`
Expected: 전부 통과.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api-types.ts src/server/generation/generation-service.ts
git commit -m "feat: AI 생성 잡 서비스(createJob/getJob/runJob)와 DTO 추가"
```

---

### Task 7: API Route Handler + api-client

**Files:**
- Create: `src/app/api/generate/route.ts`
- Create: `src/app/api/generate/[id]/route.ts`
- Modify: `src/lib/api-client.ts`

**Interfaces:**
- Consumes: `createJob`/`getJob`(Task 6), 기존 `parseBody`/`jsonOk`/`handleApiError`/`parseIdParam`
- Produces (Task 9가 사용):
  - `api.generate.create(input: { topicId: number; engine: GenerationEngineDto; instructions: string }): Promise<{ job: GenerationJobDto }>`
  - `api.generate.get(id: number): Promise<{ job: GenerationJobDto }>`

- [ ] **Step 1: POST 라우트 구현**

`src/app/api/generate/route.ts` 생성:

```ts
import { z } from "zod";
import { createJob } from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseBody } from "@/server/http";

const createSchema = z.object({
  topicId: z.number().int().positive(),
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  instructions: z.string().max(4000),
});

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, createSchema);
    return jsonOk({ job: await createJob(input) }, 202);
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 2: GET 라우트 구현**

`src/app/api/generate/[id]/route.ts` 생성:

```ts
import { getJob } from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk({ job: await getJob(parseIdParam(id)) });
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 3: api-client에 generate 추가**

`src/lib/api-client.ts`:

import 타입 목록에 `GenerationEngineDto`, `GenerationJobDto` 추가:

```ts
import type {
  GenerationEngineDto,
  GenerationJobDto,
  QuestionDetailDto,
  QuestionListItemDto,
  ReviewResultDto,
  StatsOverviewDto,
  StudyQuestionDto,
  SubmitReviewInput,
  TopicDto,
} from "./api-types";
```

`api` 객체의 `import:` 항목 아래에 추가:

```ts
  generate: {
    create: (input: {
      topicId: number;
      engine: GenerationEngineDto;
      instructions: string;
    }) =>
      request<{ job: GenerationJobDto }>("/api/generate", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    get: (id: number) =>
      request<{ job: GenerationJobDto }>(`/api/generate/${id}`),
  },
```

- [ ] **Step 4: 타입·린트 확인**

Run: `npx tsc --noEmit; if ($?) { npm run lint }`
Expected: 오류 없음.

- [ ] **Step 5: curl 수동 검증 (오류 경로)**

dev 서버 실행(`npm run dev`) 후 별도 터미널에서(PowerShell, 로그인 세션 쿠키 필요 — 먼저 로그인):

```powershell
# 로그인해서 쿠키 저장
curl.exe -s -c cookies.txt -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{\"password\":\"<APP_PASSWORD>\"}'

# 존재하지 않는 주제 → 404 TOPIC_NOT_FOUND
curl.exe -s -b cookies.txt -X POST http://localhost:3000/api/generate -H "Content-Type: application/json" -d '{\"topicId\":99999,\"engine\":\"CLAUDE\",\"instructions\":\"\"}'

# 잘못된 engine → 400 VALIDATION
curl.exe -s -b cookies.txt -X POST http://localhost:3000/api/generate -H "Content-Type: application/json" -d '{\"topicId\":1,\"engine\":\"GPT\",\"instructions\":\"\"}'

# 존재하지 않는 잡 → 404 JOB_NOT_FOUND
curl.exe -s -b cookies.txt http://localhost:3000/api/generate/99999
```

Expected: 각각 `{"error":{"code":"TOPIC_NOT_FOUND",...}}`, `{"error":{"code":"VALIDATION",...}}`, `{"error":{"code":"JOB_NOT_FOUND",...}}`. 검증 후 `cookies.txt` 삭제.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/generate src/lib/api-client.ts
git commit -m "feat: 생성 잡 API 라우트(POST/GET)와 api-client 함수 추가"
```

---

### Task 8: QuestionPreview 공용 컴포넌트 추출

**Files:**
- Create: `src/components/QuestionPreview.tsx`
- Modify: `src/app/import/page.tsx`

**Interfaces:**
- Produces: `QuestionPreview({ question }: { question: ImportQuestion })` 기본 export — Task 9의 `/generate` 페이지와 `/import` 페이지가 공유. 렌더링 결과는 기존과 동일해야 한다.

- [ ] **Step 1: 컴포넌트 파일 생성**

`src/components/QuestionPreview.tsx` 생성 — `src/app/import/page.tsx`의 `QuestionPreview` 함수(14~51행)를 그대로 옮기고 기본 export:

```tsx
import type { ImportQuestion } from "@/core/import-schema";

export default function QuestionPreview({
  question,
}: {
  question: ImportQuestion;
}) {
  if (question.type === "mcq") {
    return (
      <div className="space-y-2">
        <p>{question.question}</p>
        <ol className="space-y-1 text-sm">
          {question.choices.map((choice, index) => (
            <li
              key={choice}
              className={
                index === question.answer_index
                  ? "font-semibold text-emerald-300"
                  : "text-slate-400"
              }
            >
              {index + 1}. {choice}
              {index === question.answer_index ? " (정답)" : ""}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const filledText = question.text.replace(/\{\{(\d+)\}\}/g, (_, id) => {
    const blank = question.blanks.find((item) => item.id === Number(id));
    return `[${blank?.answer ?? "?"}]`;
  });

  return (
    <div className="space-y-2">
      <p>{filledText}</p>
      <p className="text-sm text-slate-400">
        오답 단어: {question.distractors.join(", ")}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: import 페이지에서 로컬 정의 제거하고 공용 컴포넌트 사용**

`src/app/import/page.tsx`:
- 파일 내 `function QuestionPreview(...) { ... }` 정의(14~51행) 삭제
- import 추가: `import QuestionPreview from "@/components/QuestionPreview";`
- 사용부(`<QuestionPreview question={item.question} />`)는 그대로 유지

- [ ] **Step 3: 타입·린트·빌드 확인**

Run: `npx tsc --noEmit; if ($?) { npm run lint }; if ($?) { npm run build }`
Expected: 전부 통과.

- [ ] **Step 4: 브라우저 회귀 확인**

`npm run dev` 후 `/import`에서 기존처럼 JSON 붙여넣기 → 검증 → 미리보기가 이전과 동일하게 렌더링되는지 확인(정답 강조·오답 단어 표기).

- [ ] **Step 5: Commit**

```bash
git add src/components/QuestionPreview.tsx src/app/import/page.tsx
git commit -m "chore: QuestionPreview를 공용 컴포넌트로 추출"
```

---

### Task 9: /generate 페이지 + 내비 링크

**Files:**
- Create: `src/app/generate/page.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `api.generate.create`/`api.generate.get`/`api.import.submit`/`api.topics.*`(Task 7·기존), `QuestionPreview`(Task 8), `GenerationJobDto`·`GenerationItemDto`(Task 6)

- [ ] **Step 1: 페이지 구현**

`src/app/generate/page.tsx` 생성:

```tsx
"use client";

import { useEffect, useState } from "react";
import QuestionPreview from "@/components/QuestionPreview";
import type { ImportQuestion } from "@/core/import-schema";
import { api } from "@/lib/api-client";
import type {
  GenerationEngineDto,
  GenerationJobDto,
  TopicDto,
} from "@/lib/api-types";

const ENGINES: Array<{ value: GenerationEngineDto; label: string }> = [
  { value: "CLAUDE", label: "claude code" },
  { value: "CODEX", label: "codex" },
  { value: "ANTIGRAVITY", label: "antigravity" },
];

const POLL_INTERVAL_MS = 3000;

export default function GeneratePage() {
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [newTopicName, setNewTopicName] = useState("");
  const [engine, setEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [instructions, setInstructions] = useState("");
  const [job, setJob] = useState<GenerationJobDto | null>(null);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.topics
      .list()
      .then(setTopics)
      .catch((error: unknown) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "주제 목록을 불러오지 못했습니다",
        ),
      );
  }, []);

  const running = job?.status === "RUNNING";

  useEffect(() => {
    if (!job || job.status !== "RUNNING") return;
    const startedAt = new Date(job.createdAt).getTime();
    const timer = setInterval(async () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      try {
        const { job: next } = await api.generate.get(job.id);
        if (next.status !== "RUNNING") {
          setJob(next);
          if (next.status === "SUCCEEDED" && next.items) {
            setSelected(
              new Set(
                next.items.filter((item) => item.ok).map((item) => item.index),
              ),
            );
          }
        }
      } catch {
        // 폴링 일시 오류는 무시하고 다음 주기에 재시도
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [job]);

  async function refreshTopics() {
    setTopics(await api.topics.list());
  }

  async function createTopic() {
    const name = newTopicName.trim();
    if (!name) return;
    try {
      const topic = await api.topics.create({ name });
      setTopics((prev) =>
        [...prev, topic].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setTopicId(topic.id);
      setNewTopicName("");
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "주제 생성에 실패했습니다",
      );
    }
  }

  async function startGeneration() {
    if (topicId === "" || starting || running) return;
    setStarting(true);
    setMessage("");
    setJob(null);
    setSelected(new Set());
    setElapsed(0);
    try {
      const { job: created } = await api.generate.create({
        topicId,
        engine,
        instructions,
      });
      setJob(created);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "생성 요청에 실패했습니다",
      );
    } finally {
      setStarting(false);
    }
  }

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function save() {
    if (job?.status !== "SUCCEEDED" || !job.items) return;
    if (topicId === "" || selected.size === 0) return;
    const questions = job.items
      .filter((item) => item.ok && selected.has(item.index))
      .map((item) => (item.ok ? item.question : null))
      .filter((question) => question !== null);

    setSaving(true);
    try {
      const { savedCount } = await api.import.submit(topicId, questions);
      setMessage(`✅ ${savedCount}개 문제를 저장했습니다`);
      setJob(null);
      setSelected(new Set());
      await refreshTopics();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">AI 문제 생성</h1>

      <section className="space-y-3">
        <h2 className="font-semibold">1. 주제 선택</h2>
        <select
          value={topicId}
          onChange={(event) =>
            setTopicId(event.target.value ? Number(event.target.value) : "")
          }
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
        >
          <option value="">주제를 선택하세요</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name} ({topic.questionCount}문제)
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            value={newTopicName}
            onChange={(event) => setNewTopicName(event.target.value)}
            placeholder="새 주제 이름"
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2"
          />
          <button
            onClick={createTopic}
            disabled={newTopicName.trim().length === 0}
            className="shrink-0 rounded bg-slate-700 px-4 py-2 disabled:opacity-50"
          >
            추가
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">2. 엔진과 추가 지시</h2>
        <div className="flex gap-4">
          {ENGINES.map((item) => (
            <label key={item.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="engine"
                checked={engine === item.value}
                onChange={() => setEngine(item.value)}
              />
              {item.label}
            </label>
          ))}
        </div>
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          rows={4}
          placeholder="범위, 난이도, 문제 수 같은 조건 (예: 쉬운 난이도로 10문제)"
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">3. 생성</h2>
        <button
          onClick={startGeneration}
          disabled={topicId === "" || starting || running}
          className="rounded bg-sky-600 px-4 py-2 font-semibold disabled:opacity-50"
        >
          {running ? `생성 중... (경과 ${elapsed}초)` : "생성 시작"}
        </button>
        {topicId === "" && (
          <p className="text-sm text-amber-400">주제를 먼저 선택하세요</p>
        )}
      </section>

      {job?.status === "FAILED" && (
        <section className="space-y-3">
          <p className="whitespace-pre-wrap break-all rounded border border-red-800 bg-red-950 p-3 text-sm text-red-300">
            ❌ 생성에 실패했습니다: {job.errorMessage}
          </p>
          <button
            onClick={startGeneration}
            className="rounded bg-slate-700 px-4 py-2"
          >
            다시 시도
          </button>
        </section>
      )}

      {job?.status === "SUCCEEDED" && job.items && (
        <section className="space-y-3">
          <h2 className="font-semibold">4. 미리보기 및 저장</h2>
          {job.items.map((item) => (
            <div
              key={item.index}
              className={`rounded border p-3 ${
                item.ok ? "border-slate-700" : "border-red-800 bg-red-950/40"
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="text-slate-500">#{item.index + 1}</span>
                {item.ok ? (
                  <>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                      {(item.question as ImportQuestion).type === "mcq"
                        ? "객관식"
                        : "빈칸"}
                    </span>
                    <label className="ml-auto flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(item.index)}
                        onChange={() => toggle(item.index)}
                      />
                      저장
                    </label>
                  </>
                ) : (
                  <span className="text-red-300">오류</span>
                )}
              </div>
              {item.ok ? (
                <QuestionPreview question={item.question as ImportQuestion} />
              ) : (
                <ul className="list-inside list-disc text-sm text-red-300">
                  {item.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <button
            onClick={save}
            disabled={selected.size === 0 || saving}
            className="rounded bg-emerald-600 px-4 py-2 font-semibold disabled:opacity-50"
          >
            {saving ? "저장 중..." : `선택한 ${selected.size}개 문제 저장`}
          </button>
        </section>
      )}

      {message && <p className="text-sm text-sky-300">{message}</p>}
    </div>
  );
}
```

- [ ] **Step 2: 내비게이션에 링크 추가**

`src/app/layout.tsx`의 `가져오기` 링크 아래에 추가:

```tsx
            <Link href="/generate" className="hover:text-sky-300">
              AI 생성
            </Link>
```

- [ ] **Step 3: 타입·린트·빌드 확인**

Run: `npx tsc --noEmit; if ($?) { npm run lint }; if ($?) { npm run build }`
Expected: 전부 통과.

- [ ] **Step 4: Commit**

```bash
git add src/app/generate/page.tsx src/app/layout.tsx
git commit -m "feat: AI 문제 생성 화면(/generate)과 내비 링크 추가"
```

---

### Task 10: 실엔진 수동 통합 검증 + README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 전체 파이프라인 (Task 1~9)

- [ ] **Step 1: 실엔진 검증 (claude)**

`npm run dev` 상태에서 브라우저로:

1. `/generate` 접속 → 주제 선택(없으면 생성) → 엔진 `claude code` → 추가 지시 "쉬운 난이도로 3문제" → 생성 시작
2. "생성 중... (경과 N초)" 표시 확인, 완료까지 대기(수십 초~수 분)
3. 미리보기 카드에 문제·정답 강조가 보이는지 확인
4. 일부만 체크 후 저장 → "✅ N개 문제를 저장했습니다" 확인
5. `/questions`에서 저장된 문제 확인
6. `generation_output/jobs/<id>/`에 `prompt.md`·`result.json`·로그 파일 생성 확인
7. DB 확인: `npx prisma studio`로 `generation_job` 행의 `status=SUCCEEDED`, `result` 채워짐 확인

오류 경로 1건: 같은 주제로 생성 중에 다시 "생성 시작" → 409 메시지("이미 생성 중인 작업이 있습니다") 확인.

문제 발견 시 이 태스크에서 수정하고 `fix:` 커밋.

- [ ] **Step 2: README에 기능 안내 추가**

`README.md`의 기능 소개 부근에 추가 (기존 문서 구조에 맞춰 절 위치 조정):

```markdown
## AI 문제 생성 (/generate)

로컬에 설치된 CLI 에이전트를 non-interactive 모드로 실행해 문제를 자동 생성합니다.

- 지원 엔진: claude code(`claude.exe`), codex(`codex.exe`), antigravity(`agy.exe`) — 각 CLI가 설치·로그인되어 있어야 합니다.
- 흐름: 주제·추가 지시 입력 → 잡 생성(202) → 3초 폴링 → 미리보기에서 선택 → 기존 가져오기 API로 저장.
- 잡 이력은 DB의 `generation_job` 테이블에, 실행 산출물은 `generation_output/jobs/<id>/`(git 미추적)에 남습니다.
- 타임아웃 기본 10분 — `.env`의 `GENERATION_TIMEOUT_MS`(밀리초)로 조정.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: AI 문제 생성 기능 사용 안내 추가"
```

---

## Self-Review 체크 결과 (계획 작성 시 수행)

- **스펙 커버리지**: 스키마(§2→Task 1), 프롬프트 조립(§3→Task 2), JSON 추출(§3→Task 3), 커맨드 빌더(§3→Task 4), 실행기(§3→Task 5), 잡 서비스·부분 성공·고아 정리(§3→Task 6), API·DTO(§4→Task 7), 화면·컴포넌트 추출·내비(§5→Task 8·9), 오류 처리 표(§6→Task 5·6·7 분산), 테스트(§7→Task 2·3·4), 수동 검증(§7→Task 7·10) — 누락 없음.
- **커맨드 빌더 위치**: 스펙은 `src/server/generation/`에 어댑터를 두라고 했으나, 경로 탐색 로직을 테스트하려면(스펙 §7 "존재 확인 함수 주입") 순수 모듈이어야 하므로 `src/core/engine-command.ts`로 분리했다. 실행(spawn)은 스펙대로 `src/server/generation/run-engine.ts`에 있다.
- **타입 일관성**: `EngineName`(core) = `GenerationEngineDto`(lib) = Prisma `GenerationEngine` 리터럴 동일("CLAUDE"|"CODEX"|"ANTIGRAVITY"). `GenerationItemDto` = core `ImportItemResult`와 구조 동일(질문 필드만 `unknown`).
