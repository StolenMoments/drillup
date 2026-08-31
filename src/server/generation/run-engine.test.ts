import { chmod, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiOutputContracts } from "@/core/ai-output-contracts";
import { generationTimeoutMs, removeAiRunsForLegacyDir, runEngine } from "./run-engine";

const originalTimeout = process.env.GENERATION_TIMEOUT_MS;
const originalRunRoot = process.env.AI_RUN_ROOT;
const originalCli = process.env.AI_CLI_CODEX;
const originalSandboxRequired = process.env.AI_SANDBOX_REQUIRED;
let testRoot = "";

beforeEach(async () => {
  testRoot = await mkdtemp(path.join(tmpdir(), "drillup-run-engine-test-"));
  process.env.AI_RUN_ROOT = path.join(testRoot, "runs");
});

afterEach(() => {
  if (originalTimeout === undefined) delete process.env.GENERATION_TIMEOUT_MS;
  else process.env.GENERATION_TIMEOUT_MS = originalTimeout;
  if (originalRunRoot === undefined) delete process.env.AI_RUN_ROOT;
  else process.env.AI_RUN_ROOT = originalRunRoot;
  if (originalCli === undefined) delete process.env.AI_CLI_CODEX;
  else process.env.AI_CLI_CODEX = originalCli;
  if (originalSandboxRequired === undefined) delete process.env.AI_SANDBOX_REQUIRED;
  else process.env.AI_SANDBOX_REQUIRED = originalSandboxRequired;
  return rm(testRoot, { recursive: true, force: true });
});

async function fakeCli(body: string): Promise<string> {
  const file = path.join(testRoot, `fake-${Math.random().toString(16).slice(2)}.mjs`);
  await writeFile(
    file,
    `import { writeFile } from "node:fs/promises"; import path from "node:path"; for await (const _ of process.stdin) {} const i = process.argv.indexOf("--output-last-message"); const resultPath = process.argv[i + 1]; ${body}`,
    "utf-8",
  );
  process.env.AI_CLI_CODEX = file;
  return file;
}

describe("generationTimeoutMs", () => {
  it("기본값은 20분이다", () => {
    delete process.env.GENERATION_TIMEOUT_MS;
    expect(generationTimeoutMs()).toBe(1_200_000);
  });

  it("GENERATION_TIMEOUT_MS를 반영한다", () => {
    process.env.GENERATION_TIMEOUT_MS = "30000";
    expect(generationTimeoutMs()).toBe(30_000);
  });

  it("잘못된 값이면 기본값을 쓴다", () => {
    process.env.GENERATION_TIMEOUT_MS = "abc";
    expect(generationTimeoutMs()).toBe(1_200_000);

    process.env.GENERATION_TIMEOUT_MS = "-5";
    expect(generationTimeoutMs()).toBe(1_200_000);
  });
});

describe("runEngine result isolation", () => {
  it("잘못된 파일명 하나는 경고와 함께 복구한다", async () => {
    await fakeCli('await writeFile(path.join(path.dirname(resultPath), "wrong-name.json"), JSON.stringify({ note: "ok" }));');
    const result = await runEngine(
      "CODEX",
      "return a note",
      path.join(testRoot, "legacy"),
      aiOutputContracts.note,
    );
    expect(result).toMatchObject({ ok: true });
    expect(result.warningMessage).toContain("recovered wrong-name.json");
  });

  it("결과 파일이 없으면 이전 실행 파일을 재사용하지 않는다", async () => {
    const legacy = path.join(testRoot, "legacy");
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, "result.json"), JSON.stringify({ note: "stale" }));
    await fakeCli("");
    const result = await runEngine(
      "CODEX",
      "return a note",
      legacy,
      aiOutputContracts.note,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failureReason).toContain("no newly created JSON file");
  });

  it("새 JSON 파일이 여러 개면 모호한 결과를 거부한다", async () => {
    await fakeCli('await writeFile(path.join(path.dirname(resultPath), "one.json"), "{}"); await writeFile(path.join(path.dirname(resultPath), "two.json"), "{}");');
    const result = await runEngine(
      "CODEX",
      "return a note",
      path.join(testRoot, "legacy"),
      aiOutputContracts.note,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failureReason).toContain("multiple newly created JSON files");
  });

  it("기존 작업 삭제 시 새 루트의 하위 실행도 함께 정리한다", async () => {
    await fakeCli('await writeFile(resultPath, JSON.stringify({ note: "ok" }));');
    const legacy = path.join(testRoot, "legacy-job");
    await runEngine("CODEX", "one", legacy, aiOutputContracts.note);
    await runEngine(
      "CODEX",
      "two",
      path.join(legacy, "revisions", "0"),
      aiOutputContracts.note,
    );
    expect(await readdir(process.env.AI_RUN_ROOT as string)).toHaveLength(2);
    await removeAiRunsForLegacyDir(legacy);
    expect(await readdir(process.env.AI_RUN_ROOT as string)).toHaveLength(0);
  });

  it.skipIf(process.platform !== "linux" || (!existsSync("/usr/bin/bwrap") && !existsSync("/bin/bwrap")))(
    "가짜 CLI가 저장소·비밀 환경변수에 접근하거나 git 작업을 수행하지 못한다",
    async () => {
      process.env.AI_SANDBOX_REQUIRED = "1";
      const repo = process.cwd();
      const probe = path.join(repo, "src", ".ai-sandbox-write-probe");
      const reference = path.join(testRoot, "reference.txt");
      await writeFile(reference, "copied-reference-ok", "utf-8");
      const script = path.join(testRoot, "fake-codex");
      await writeFile(
        script,
        `#!/bin/sh
cat >/dev/null
repo=${JSON.stringify(repo)}
test ! -r "$repo/AGENTS.md" || exit 21
test ! -r "$repo/CLAUDE.md" || exit 22
test ! -e "$repo/.agents" || exit 23
test ! -e "$repo/.git" || exit 24
printf bad > ${JSON.stringify(probe)} 2>/dev/null && exit 25
git -C "$repo" commit --dry-run >/dev/null 2>&1 && exit 26
git -C "$repo" push --dry-run >/dev/null 2>&1 && exit 27
test -z "$DB_PASSWORD" || exit 28
test -z "$SESSION_SECRET" || exit 29
test -r /work/references/1-reference.txt || exit 30
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then shift; result="$1"; fi
  shift
done
printf '{"note":"isolated"}' > "$result"
`,
        "utf-8",
      );
      await chmod(script, 0o755);
      process.env.AI_CLI_CODEX = script;
      try {
        const result = await runEngine(
          "CODEX",
          `Read ${reference}`,
          path.join(testRoot, "legacy"),
          aiOutputContracts.note,
          "",
          [reference],
        );
        expect(result).toMatchObject({ ok: true, resultText: '{"note":"isolated"}' });
        expect(existsSync(probe)).toBe(false);
      } finally {
        await rm(probe, { force: true });
      }
    },
  );
});
