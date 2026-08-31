#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "linux") {
  console.log("[ai-sandbox] Windows/non-Linux development environment: preflight skipped.");
  process.exit(0);
}

if (!existsSync("/usr/bin/bwrap") && !existsSync("/bin/bwrap")) {
  console.error("AI_SANDBOX_UNAVAILABLE: bubblewrap executable was not found");
  process.exit(1);
}

const runDir = mkdtempSync(path.join(tmpdir(), "drillup-ai-preflight-"));
const userHome = homedir();
try {
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
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--bind",
    runDir,
    "/work",
    "--chdir",
    "/work",
    "--",
    "/bin/sh",
    "-c",
    `test "$PWD" = /work && test ! -e ${JSON.stringify(path.join(process.cwd(), "AGENTS.md"))} && test ! -e ${JSON.stringify(path.join(userHome, ".ssh"))}`,
  ];
  const result = spawnSync("bwrap", args, {
    encoding: "utf-8",
    env: {
      HOME: userHome,
      PATH: process.env.PATH,
      LANG: process.env.LANG ?? "C.UTF-8",
    },
  });
  if (result.status !== 0) {
    console.error(
      `AI_SANDBOX_UNAVAILABLE: bubblewrap isolation self-check failed: ${result.stderr.trim() || "unknown error"}`,
    );
    process.exit(1);
  }
  console.log("[ai-sandbox] bubblewrap isolation self-check passed.");
} finally {
  rmSync(runDir, { recursive: true, force: true });
}
