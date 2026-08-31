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

export interface EngineCommandOutput {
  promptPath: string;
  resultPath: string;
  schemaPath: string;
  schemaJson: string;
  workDir: string;
}

const AGY_MODEL = "Gemini 3.7 Flash (High)";
const CODEX_MODEL = "gpt-5.6-terra";
const CODEX_REASONING_CONFIG = 'model_reasoning_effort="medium"';

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
  output: EngineCommandOutput,
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
        "--safe-mode",
        "--permission-mode",
        "dontAsk",
        "--model",
        "sonnet",
        "--tools",
        "WebSearch,WebFetch,Read",
        "--allowedTools",
        "WebSearch,WebFetch,Read",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--json-schema",
        output.schemaJson,
        "--output-format",
        "json",
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
    return {
      command,
      args: [
        "exec",
        "--sandbox",
        "workspace-write",
        "--cd",
        output.workDir,
        "--skip-git-repo-check",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--model",
        CODEX_MODEL,
        "-c",
        CODEX_REASONING_CONFIG,
        "-c",
        'web_search="live"',
        "-c",
        "sandbox_workspace_write.network_access=true",
        "--output-schema",
        output.schemaPath,
        "--output-last-message",
        output.resultPath,
        "--color",
        "never",
        "-",
      ],
      promptViaStdin: true,
    };
  }

  const instruction =
    `Read the UTF-8 prompt file at "${output.promptPath}" and follow every instruction in it. ` +
    `Your output must conform to the JSON Schema at "${output.schemaPath}". ` +
    `Create the JSON output file at "${output.resultPath}"; do not summarize the prompt itself.`;
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
    args: [
      "--dangerously-skip-permissions",
      "--disable-slash-commands",
      "-p",
      instruction,
      "--model",
      AGY_MODEL,
    ],
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
