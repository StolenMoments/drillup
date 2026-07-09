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
      args: [
        "--dangerously-skip-permissions",
        "--model",
        "sonnet",
        "--allowedTools",
        "WebSearch",
        "WebFetch",
        "-p",
      ],
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
        winJoin(
          npmRoot,
          "codex-win32-x64",
          "vendor",
          "x86_64-pc-windows-msvc",
          "bin",
          "codex.exe",
        ),
        winJoin(
          npmRoot,
          "codex-win32-arm64",
          "vendor",
          "aarch64-pc-windows-msvc",
          "bin",
          "codex.exe",
        ),
        winJoin(
          npmRoot,
          "codex-win32-x64",
          "vendor",
          "x86_64-pc-windows-msvc",
          "codex",
          "codex.exe",
        ),
        winJoin(
          npmRoot,
          "codex-win32-arm64",
          "vendor",
          "aarch64-pc-windows-msvc",
          "codex",
          "codex.exe",
        ),
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
