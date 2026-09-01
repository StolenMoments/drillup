import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import type { EngineName } from "@/core/engine-command";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);
type Environment = Record<string, string | undefined>;

function joinHome(homeDir: string, ...parts: string[]): string {
  return homeDir.includes("\\")
    ? path.win32.join(homeDir, ...parts)
    : path.posix.join(homeDir, ...parts);
}

export function aiSandboxRequired(
  platform = process.platform,
  env: Environment = process.env,
): boolean {
  const configured = env.AI_SANDBOX_REQUIRED?.trim().toLowerCase();
  if (configured && TRUE_VALUES.has(configured)) return true;
  if (configured && FALSE_VALUES.has(configured)) return false;
  return platform === "linux" && env.NODE_ENV === "production";
}

export function sanitizedAiEnv(
  engine: EngineName,
  homeDir = homedir(),
  env: Environment = process.env,
): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "all_proxy",
    "no_proxy",
  ];
  const childEnv: NodeJS.ProcessEnv = {
    HOME: homeDir,
    NODE_ENV:
      env.NODE_ENV === "development" || env.NODE_ENV === "test"
        ? env.NODE_ENV
        : "production",
  };
  for (const key of allowed) {
    if (env[key] !== undefined) childEnv[key] = env[key];
  }
  if (engine === "CODEX") childEnv.CODEX_HOME = joinHome(homeDir, ".codex");
  childEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  return childEnv;
}

export interface SandboxPreflightResult {
  ok: boolean;
  error?: string;
}

export function aiSandboxPreflight(): SandboxPreflightResult {
  if (!aiSandboxRequired()) return { ok: true };
  if (!existsSync("/usr/bin/bwrap") && !existsSync("/bin/bwrap")) {
    return {
      ok: false,
      error: "AI_SANDBOX_UNAVAILABLE: bubblewrap executable was not found",
    };
  }
  const result = spawnSync("bwrap", [
    "--die-with-parent",
    "--unshare-all",
    "--share-net",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind-try",
    "/bin",
    "/bin",
    "--ro-bind-try",
    "/lib",
    "/lib",
    "--ro-bind-try",
    "/lib64",
    "/lib64",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--",
    "/bin/sh",
    "-c",
    "exit 0",
  ], {
    encoding: "utf-8",
    env: sanitizedAiEnv("CODEX"),
  });
  if (result.status !== 0) {
    return {
      ok: false,
      error: `AI_SANDBOX_UNAVAILABLE: bubblewrap self-check failed (${result.stderr?.trim() || "unknown error"})`,
    };
  }
  return { ok: true };
}

function addParentDirs(
  args: string[],
  target: string,
  createdDirs: Set<string>,
): void {
  const parents: string[] = [];
  let current = path.dirname(target);
  while (current !== "." && current !== path.dirname(current)) {
    parents.push(current);
    current = path.dirname(current);
  }
  for (const parent of parents.reverse()) {
    if (createdDirs.has(parent)) continue;
    createdDirs.add(parent);
    args.push("--dir", parent);
  }
}

function authPaths(engine: EngineName, homeDir: string): string[] {
  if (engine === "CODEX") return [joinHome(homeDir, ".codex")];
  if (engine === "CLAUDE") {
    return [joinHome(homeDir, ".claude"), joinHome(homeDir, ".claude.json")];
  }
  return [
    joinHome(homeDir, ".gemini", "antigravity-cli"),
    joinHome(homeDir, ".gemini", "config"),
  ];
}

export function wrapWithBubblewrap(input: {
  engine: EngineName;
  command: string;
  args: string[];
  runDir: string;
  homeDir?: string;
}): { command: string; args: string[] } {
  if (!aiSandboxRequired()) return { command: input.command, args: input.args };
  const homeDir = input.homeDir ?? homedir();
  const createdDirs = new Set<string>(["/etc", "/proc", "/dev", "/tmp", "/work"]);
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--share-net",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind-try",
    "/bin",
    "/bin",
    "--ro-bind-try",
    "/lib",
    "/lib",
    "--ro-bind-try",
    "/lib64",
    "/lib64",
    "--dir",
    "/etc",
    "--ro-bind-try",
    "/etc/ssl",
    "/etc/ssl",
    "--ro-bind-try",
    "/etc/pki",
    "/etc/pki",
    "--ro-bind-try",
    "/etc/resolv.conf",
    "/etc/resolv.conf",
    "--ro-bind-try",
    "/etc/hosts",
    "/etc/hosts",
    "--ro-bind-try",
    "/etc/nsswitch.conf",
    "/etc/nsswitch.conf",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
  ];
  addParentDirs(args, homeDir, createdDirs);
  // agy refreshes its OAuth token and project cache during normal startup.
  const authBindOption =
    input.engine === "ANTIGRAVITY" ? "--bind" : "--ro-bind";
  for (const authPath of authPaths(input.engine, homeDir)) {
    if (!existsSync(authPath)) continue;
    addParentDirs(args, authPath, createdDirs);
    args.push(authBindOption, authPath, authPath);
  }
  args.push("--bind", input.runDir, "/work", "--chdir", "/work");

  let sandboxCommand = input.command;
  if (path.isAbsolute(input.command) && !input.command.startsWith("/usr/") && !input.command.startsWith("/bin/")) {
    args.push("--dir", "/ai-bin", "--ro-bind", input.command, "/ai-bin/engine");
    sandboxCommand = "/ai-bin/engine";
  }
  args.push("--", sandboxCommand, ...input.args);
  return { command: "bwrap", args };
}
