export type EngineName = "CLAUDE" | "CODEX" | "ANTIGRAVITY";

export interface EngineEnv {
  homeDir: string;
  localAppData: string | null;
  platform?: NodeJS.Platform;
  fileExists: (path: string) => boolean;
}

export interface EngineCommand {
  command: string;
  args: string[];
  promptViaStdin: boolean;
}

const AGY_MODEL = "Gemini 3.5 Flash (High)";

function winJoin(...parts: string[]): string {
  return parts.join("\\");
}

function firstExisting(candidates: string[], env: EngineEnv, fallback: string): string {
  return candidates.find((candidate) => env.fileExists(candidate)) ?? fallback;
}

function isWindows(env: EngineEnv): boolean {
  return (env.platform ?? "win32") === "win32";
}

// GREED backend/routers/jobs.py에서 검증된 호출 방식 그대로.
// .cmd 배치 래퍼는 exit code/stdin 전달 문제가 있어 exe 직접 호출을 우선한다.
export function buildEngineCommand(
  engine: EngineName,
  promptPath: string,
  env: EngineEnv,
): EngineCommand {
  if (engine === "CLAUDE") {
    const command = isWindows(env)
      ? firstExisting(
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
        )
      : firstExisting(
          [
            pathJoin(env.homeDir, ".local", "bin", "claude"),
            pathJoin(env.homeDir, ".npm-global", "bin", "claude"),
            "/usr/bin/claude",
            "/usr/local/bin/claude",
            "/opt/homebrew/bin/claude",
          ],
          env,
          "claude",
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
    const command = isWindows(env)
      ? firstExisting(windowsCodexCandidates(env), env, "codex.cmd")
      : firstExisting(
          [
            pathJoin(env.homeDir, ".local", "bin", "codex"),
            pathJoin(env.homeDir, ".npm-global", "bin", "codex"),
            "/usr/bin/codex",
            "/usr/local/bin/codex",
            "/opt/homebrew/bin/codex",
          ],
          env,
          "codex",
        );
    return { command, args: ["exec", "--yolo", "-"], promptViaStdin: true };
  }

  const instruction =
    `Read the UTF-8 prompt file at "${promptPath}" and follow every instruction in it. ` +
    "Create the requested JSON output file; do not summarize the prompt itself.";
  const candidates = isWindows(env)
    ? [
        ...(env.localAppData ? [winJoin(env.localAppData, "agy", "bin", "agy.exe")] : []),
        winJoin(env.homeDir, "AppData", "Local", "agy", "bin", "agy.exe"),
      ]
    : [
        pathJoin(env.homeDir, ".local", "bin", "agy"),
        pathJoin(env.homeDir, ".npm-global", "bin", "agy"),
        "/usr/bin/agy",
        "/usr/local/bin/agy",
        "/opt/homebrew/bin/agy",
      ];
  const command = firstExisting(candidates, env, isWindows(env) ? "agy.exe" : "agy");
  return {
    command,
    args: ["--dangerously-skip-permissions", "-p", instruction, "--model", AGY_MODEL],
    promptViaStdin: false,
  };
}

function pathJoin(...parts: string[]): string {
  return parts.join("/");
}

function windowsCodexCandidates(env: EngineEnv): string[] {
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
  return [
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
  ];
}
