import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildEngineCommand,
  type EngineName,
} from "@/core/engine-command";
import {
  parseAiOutputContract,
  type AiOutputContract,
} from "@/core/ai-output-contract";
import {
  aiSandboxPreflight,
  aiSandboxRequired,
  sanitizedAiEnv,
  wrapWithBubblewrap,
} from "./ai-sandbox";

const LOG_TAIL_CHARS = 8_000;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const VIRTUAL_WORK_DIR = "/work";

type EngineDiagnostics = {
  stdoutTail: string;
  stderrTail: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  warningMessage: string | null;
  runDir: string;
};
export type EngineRunResult =
  | ({ ok: true; resultText: string } & EngineDiagnostics)
  | ({ ok: false; failureReason: string } & EngineDiagnostics);

export function generationTimeoutMs(): number {
  const raw = Number(process.env.GENERATION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

export function jobOutputDir(jobId: number): string {
  return path.resolve("generation_output", "jobs", String(jobId));
}

export function aiRunRoot(): string {
  return path.resolve(
    process.env.AI_RUN_ROOT ??
      path.join(homedir(), ".local", "share", "drillup-ai", "runs"),
  );
}

function tail(text: string): string {
  return text.trim().slice(-LOG_TAIL_CHARS);
}

interface SpawnExit {
  code: number | null;
  error: Error | null;
  timedOut: boolean;
}

function virtualPath(fileName: string): string {
  return path.posix.join(VIRTUAL_WORK_DIR, fileName);
}

function replaceAllPathVariants(text: string, from: string, to: string): string {
  return text
    .replaceAll(from, to)
    .replaceAll(from.replaceAll("\\", "/"), to)
    .replaceAll(from.replaceAll("/", "\\"), to);
}

async function preparePrompt(
  prompt: string,
  legacyDir: string,
  runDir: string,
  referenceFiles: readonly string[],
  engine: EngineName,
  contract: AiOutputContract,
  expectedName: string,
): Promise<string> {
  const exposedWorkDir = aiSandboxRequired() ? VIRTUAL_WORK_DIR : runDir;
  let prepared = replaceAllPathVariants(prompt, path.resolve(legacyDir), exposedWorkDir);
  if (referenceFiles.length > 0) await mkdir(path.join(runDir, "references"), { recursive: true });
  for (const [index, source] of referenceFiles.entries()) {
    const fileName = `${index + 1}-${path.basename(source)}`;
    const destination = path.join(runDir, "references", fileName);
    await copyFile(source, destination);
    const exposed = aiSandboxRequired()
      ? virtualPath(path.posix.join("references", fileName))
      : destination;
    prepared = replaceAllPathVariants(prepared, source, exposed);
  }
  const outputInstruction =
    engine === "ANTIGRAVITY"
      ? `Write the final JSON to ${sandboxedOutputPath(expectedName, runDir)}.`
      : "Return only the JSON object as the structured final response.";
  return `${prepared}\n\n## Enforced AI output contract\nContract ID: ${contract.id}\n${outputInstruction}\nThe response must match this JSON Schema exactly:\n${JSON.stringify(contract.schema)}\n`;
}

function sandboxedOutputPath(fileName: string, runDir: string): string {
  return aiSandboxRequired() ? virtualPath(fileName) : path.join(runDir, fileName);
}

function claudeStructuredOutput(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const nested = record.structured_output ?? record.result;
      if (typeof nested === "object" && nested !== null) return JSON.stringify(nested);
      if (typeof nested === "string") return nested;
    }
    return trimmed;
  } catch {
    return null;
  }
}

async function jsonFiles(dir: string): Promise<Set<string>> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return new Set(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name),
  );
}

async function writeContractDiagnostics(
  runDir: string,
  rawOutput: string | null,
  normalizedOutput: unknown,
  contractErrors: string[],
): Promise<void> {
  await writeFile(
    path.join(runDir, "contract-diagnostics.json"),
    JSON.stringify({ rawOutput, normalizedOutput, contractErrors }, null, 2),
    "utf-8",
  ).catch(() => undefined);
}

async function selectResultFile(input: {
  runDir: string;
  expectedName: string;
  before: Set<string>;
}): Promise<{ text: string | null; warning: string | null; error: string | null }> {
  const expectedPath = path.join(input.runDir, input.expectedName);
  const expected = await readFile(expectedPath, "utf-8").catch(() => null);
  if (expected?.trim()) return { text: expected, warning: null, error: null };

  const after = await jsonFiles(input.runDir);
  const candidates = [...after].filter(
    (name) =>
      !input.before.has(name) &&
      name !== "contract.schema.json" &&
      name !== "contract-diagnostics.json" &&
      name !== "run-context.json",
  );
  if (candidates.length === 1) {
    const text = await readFile(path.join(input.runDir, candidates[0]), "utf-8");
    return {
      text,
      warning: `expected ${input.expectedName}, recovered ${candidates[0]}`,
      error: null,
    };
  }
  return {
    text: null,
    warning: null,
    error:
      candidates.length === 0
        ? `expected ${input.expectedName}, but no newly created JSON file was found`
        : `expected ${input.expectedName}, but multiple newly created JSON files were found: ${candidates.join(", ")}`,
  };
}

export async function removeAiRunsForLegacyDir(legacyDir: string): Promise<void> {
  const root = aiRunRoot();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const target = path.resolve(legacyDir);
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const runDir = path.join(root, entry.name);
        const context = await readFile(path.join(runDir, "run-context.json"), "utf-8")
          .then((text) => JSON.parse(text) as { legacyDir?: string })
          .catch(() => null);
        const relative = context?.legacyDir
          ? path.relative(target, context.legacyDir)
          : "..";
        if (
          relative === "" ||
          (!relative.startsWith("..") && !path.isAbsolute(relative))
        ) {
          await rm(runDir, { recursive: true, force: true });
        }
      }),
  );
}

export async function runEngine(
  engine: EngineName,
  prompt: string,
  legacyDir: string,
  contract: AiOutputContract,
  filePrefix = "",
  referenceFiles: readonly string[] = [],
): Promise<EngineRunResult> {
  const startedAt = Date.now();
  const runDir = path.join(aiRunRoot(), randomUUID());
  await mkdir(runDir, { recursive: true });
  const expectedName = `${filePrefix}result.json`;
  const promptName = `${filePrefix}prompt.md`;
  const promptPath = path.join(runDir, promptName);
  const resultPath = path.join(runDir, expectedName);
  const schemaPath = path.join(runDir, "contract.schema.json");
  await writeFile(
    path.join(runDir, "run-context.json"),
    JSON.stringify({ legacyDir: path.resolve(legacyDir), contractId: contract.id }),
    "utf-8",
  );
  await writeFile(schemaPath, JSON.stringify(contract.schema, null, 2), "utf-8");
  const preparedPrompt = await preparePrompt(
    prompt,
    legacyDir,
    runDir,
    referenceFiles,
    engine,
    contract,
    expectedName,
  );
  await writeFile(promptPath, preparedPrompt, "utf-8");
  const beforeJson = await jsonFiles(runDir);
  // 모든 실행 폴더에 동일한 최소 진단 파일을 남기고, 출력 검증 단계에서 갱신한다.
  await writeContractDiagnostics(runDir, null, null, []);

  const preflight = aiSandboxPreflight();
  const emptyDiagnostics = (): EngineDiagnostics => ({
    stdoutTail: "",
    stderrTail: "",
    exitCode: null,
    timedOut: false,
    durationMs: Date.now() - startedAt,
    warningMessage: null,
    runDir,
  });
  if (!preflight.ok) {
    return {
      ok: false,
      failureReason: preflight.error ?? "AI_SANDBOX_UNAVAILABLE",
      ...emptyDiagnostics(),
    };
  }

  const homeDir = homedir();
  const sandboxed = aiSandboxRequired();
  const exposed = {
    promptPath: sandboxed ? virtualPath(promptName) : promptPath,
    resultPath: sandboxed ? virtualPath(expectedName) : resultPath,
    schemaPath: sandboxed ? virtualPath("contract.schema.json") : schemaPath,
    schemaJson: JSON.stringify(contract.schema),
    workDir: sandboxed ? VIRTUAL_WORK_DIR : runDir,
  };
  const builtCommand = buildEngineCommand(engine, exposed, {
    homeDir,
    localAppData: process.env.LOCALAPPDATA ?? null,
    platform: process.platform,
    fileExists: existsSync,
  });
  const commandOverride = process.env[`AI_CLI_${engine}`];
  const cmd = commandOverride
    ? /\.[cm]?js$/i.test(commandOverride)
      ? { ...builtCommand, command: process.execPath, args: [commandOverride, ...builtCommand.args] }
      : { ...builtCommand, command: commandOverride }
    : builtCommand;
  const launch = wrapWithBubblewrap({
    engine,
    command: cmd.command,
    args: cmd.args,
    runDir,
    homeDir,
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
    const child = spawn(launch.command, launch.args, {
      cwd: runDir,
      env: sanitizedAiEnv(engine, homeDir),
      shell: launch.command.toLowerCase().endsWith(".cmd"),
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
    if (cmd.promptViaStdin) child.stdin.write(preparedPrompt, "utf-8");
    child.stdin.end();
  });

  await writeFile(path.join(runDir, `${filePrefix}stdout.log`), stdout, "utf-8").catch(() => undefined);
  await writeFile(path.join(runDir, `${filePrefix}stderr.log`), stderr, "utf-8").catch(() => undefined);
  const diagnostics = (warningMessage: string | null): EngineDiagnostics => ({
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
    exitCode: exit.code,
    timedOut: exit.timedOut,
    durationMs: Date.now() - startedAt,
    warningMessage,
    runDir,
  });
  const logTail = [
    stdout.trim() ? `stdout: ${tail(stdout)}` : "",
    stderr.trim() ? `stderr: ${tail(stderr)}` : "",
  ].filter(Boolean).join("; ");

  if (exit.error) {
    return {
      ok: false,
      failureReason: `${engine} engine executable could not be started (${cmd.command}): ${exit.error.message}`,
      ...diagnostics(null),
    };
  }
  if (exit.timedOut) {
    return {
      ok: false,
      failureReason: `AI engine timed out after ${Math.round(generationTimeoutMs() / 1000)} seconds${logTail ? `; ${logTail}` : ""}`,
      ...diagnostics(null),
    };
  }
  if (exit.code !== 0) {
    return {
      ok: false,
      failureReason: `${engine} exited with code ${exit.code ?? "unknown"}${logTail ? `; ${logTail}` : ""}`,
      ...diagnostics(null),
    };
  }

  if (engine === "CLAUDE") {
    const structured = claudeStructuredOutput(stdout);
    if (structured) await writeFile(resultPath, structured, "utf-8");
  }
  const selected = await selectResultFile({ runDir, expectedName, before: beforeJson });
  if (!selected.text) {
    await writeContractDiagnostics(runDir, null, null, [selected.error ?? "missing result"]);
    return {
      ok: false,
      failureReason: `${selected.error} (exit_code=${exit.code ?? "unknown"})${logTail ? `; ${logTail}` : ""}`,
      ...diagnostics(null),
    };
  }

  const parsed = parseAiOutputContract(contract, selected.text);
  if (!parsed.ok) {
    await writeContractDiagnostics(
      runDir,
      selected.text,
      parsed.normalizedValue,
      parsed.errors,
    );
    const warningMessage = [...parsed.warnings, selected.warning].filter(Boolean).join("; ") || null;
    return {
      ok: false,
      failureReason: `AI output contract ${contract.id} failed: ${parsed.errors.join("; ")}`,
      ...diagnostics(warningMessage),
    };
  }
  await writeContractDiagnostics(
    runDir,
    selected.text,
    parsed.normalizedValue,
    [],
  );
  const warningMessage = [...parsed.warnings, selected.warning].filter(Boolean).join("; ") || null;
  return {
    ok: true,
    resultText: parsed.normalizedText,
    ...diagnostics(warningMessage),
  };
}
