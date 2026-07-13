import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { buildEngineCommand, type EngineName } from "@/core/engine-command";

const LOG_TAIL_CHARS = 8_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

type EngineDiagnostics = { stdoutTail: string; stderrTail: string; exitCode: number | null; timedOut: boolean; durationMs: number };
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
  dir: string,
  filePrefix = "",
): Promise<EngineRunResult> {
  const startedAt = Date.now();
  await mkdir(dir, { recursive: true });
  const promptPath = path.join(dir, `${filePrefix}prompt.md`);
  const resultPath = path.join(dir, `${filePrefix}result.json`);
  await writeFile(promptPath, prompt, "utf-8");

  const cmd = buildEngineCommand(engine, promptPath, {
    homeDir: homedir(),
    localAppData: process.env.LOCALAPPDATA ?? null,
    platform: process.platform,
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

  await writeFile(path.join(dir, `${filePrefix}stdout.log`), stdout, "utf-8").catch(
    () => undefined,
  );
  await writeFile(path.join(dir, `${filePrefix}stderr.log`), stderr, "utf-8").catch(
    () => undefined,
  );
  const diagnostics: EngineDiagnostics = { stdoutTail: tail(stdout), stderrTail: tail(stderr), exitCode: exit.code, timedOut: exit.timedOut, durationMs: Date.now() - startedAt };

  const logTail = [
    stdout.trim() ? `stdout: ${tail(stdout)}` : "",
    stderr.trim() ? `stderr: ${tail(stderr)}` : "",
  ]
    .filter(Boolean)
    .join("; ");

  if (exit.error) {
    return {
      ...diagnostics,
      ok: false,
      failureReason: `${engine} 엔진 실행 파일을 찾을 수 없습니다 (${cmd.command}): ${exit.error.message}`,
    };
  }
  if (exit.timedOut) {
    return {
      ...diagnostics,
      ok: false,
      failureReason: `시간 초과(${Math.round(generationTimeoutMs() / 1000)}초)로 중단했습니다${logTail ? `; ${logTail}` : ""}`,
    };
  }

  const resultText = await readFile(resultPath, "utf-8").catch(() => null);
  if (resultText === null || resultText.trim() === "") {
    return {
      ...diagnostics,
      ok: false,
      failureReason: `${filePrefix}result.json이 생성되지 않았습니다 (exit_code=${exit.code ?? "unknown"})${logTail ? `; ${logTail}` : ""}`,
    };
  }
  return { ok: true, resultText, ...diagnostics };
}
