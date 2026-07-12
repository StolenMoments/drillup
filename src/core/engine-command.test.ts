import { describe, expect, it } from "vitest";
import { buildEngineCommand, type EngineEnv } from "./engine-command";

function env(existing: string[] = []): EngineEnv {
  return {
    homeDir: "C:\\Users\\me",
    localAppData: "C:\\Users\\me\\AppData\\Local",
    platform: "win32",
    fileExists: (path: string) => existing.includes(path),
  };
}

function linuxEnv(existing: string[] = []): EngineEnv {
  return {
    homeDir: "/home/opc",
    localAppData: null,
    platform: "linux",
    fileExists: (path: string) => existing.includes(path),
  };
}

describe("buildEngineCommand - CLAUDE", () => {
  it("존재하는 첫 번째 claude.exe를 쓰고 프롬프트는 stdin으로 받는다", () => {
    const exe = "C:\\Users\\me\\.local\\bin\\claude.exe";
    const cmd = buildEngineCommand("CLAUDE", "D:\\p\\prompt.md", env([exe]));
    expect(cmd.command).toBe(exe);
    expect(cmd.args).toEqual([
      "--dangerously-skip-permissions",
      "--model",
      "sonnet",
      "--allowedTools",
      "WebSearch",
      "WebFetch",
      "-p",
    ]);
    expect(cmd.promptViaStdin).toBe(true);
  });

  it("exe가 없으면 claude.cmd로 폴백한다", () => {
    const cmd = buildEngineCommand("CLAUDE", "D:\\p\\prompt.md", env());
    expect(cmd.command).toBe("claude.cmd");
  });

  it("uses claude from PATH on Linux when no direct binary exists", () => {
    const cmd = buildEngineCommand("CLAUDE", "/tmp/prompt.md", linuxEnv());
    expect(cmd.command).toBe("claude");
  });

  it("uses ~/.local/bin/claude on Linux when it exists", () => {
    const exe = "/home/opc/.local/bin/claude";
    const cmd = buildEngineCommand("CLAUDE", "/tmp/prompt.md", linuxEnv([exe]));
    expect(cmd.command).toBe(exe);
  });
});

describe("buildEngineCommand - CODEX", () => {
  it("npm 레이아웃의 codex.exe를 찾아 exec --yolo - 로 실행한다", () => {
    const exe =
      "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe";
    const cmd = buildEngineCommand("CODEX", "D:\\p\\prompt.md", env([exe]));
    expect(cmd.command).toBe(exe);
    expect(cmd.args).toEqual(["exec", "--yolo", "-"]);
    expect(cmd.promptViaStdin).toBe(true);
  });

  it("요청한 Codex 모델을 인자로 전달한다", () => {
    const cmd = buildEngineCommand("CODEX", "D:\\p\\prompt.md", env(), {
      codexModel: "gpt-5.6-terra",
    });

    expect(cmd.args).toEqual([
      "exec",
      "--yolo",
      "--model",
      "gpt-5.6-terra",
      "-",
    ]);
  });

  it("exe가 없으면 codex.cmd로 폴백한다", () => {
    const cmd = buildEngineCommand("CODEX", "D:\\p\\prompt.md", env());
    expect(cmd.command).toBe("codex.cmd");
  });

  it("uses codex from PATH on Linux when no direct binary exists", () => {
    const cmd = buildEngineCommand("CODEX", "/tmp/prompt.md", linuxEnv());
    expect(cmd.command).toBe("codex");
  });

  it("uses ~/.local/bin/codex on Linux when it exists", () => {
    const exe = "/home/opc/.local/bin/codex";
    const cmd = buildEngineCommand("CODEX", "/tmp/prompt.md", linuxEnv([exe]));
    expect(cmd.command).toBe(exe);
  });
});

describe("buildEngineCommand - ANTIGRAVITY", () => {
  it("프롬프트 파일 경로 지시와 모델명을 인자로 넘기고 stdin은 쓰지 않는다", () => {
    const exe = "C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe";
    const cmd = buildEngineCommand("ANTIGRAVITY", "D:\\p\\prompt.md", env([exe]));
    expect(cmd.command).toBe(exe);
    expect(cmd.args[0]).toBe("--dangerously-skip-permissions");
    expect(cmd.args[1]).toBe("-p");
    expect(cmd.args[2]).toContain('"D:\\p\\prompt.md"');
    expect(cmd.args[3]).toBe("--model");
    expect(cmd.args[4]).toBe("Gemini 3.5 Flash (High)");
    expect(cmd.promptViaStdin).toBe(false);
  });

  it("localAppData가 없으면 홈 기준 경로를 탐색하고, 없으면 agy.exe로 폴백한다", () => {
    const noLocal: EngineEnv = { ...env(), localAppData: null };
    const cmd = buildEngineCommand("ANTIGRAVITY", "D:\\p\\prompt.md", noLocal);
    expect(cmd.command).toBe("agy.exe");
  });

  it("uses agy from PATH on Linux when no direct binary exists", () => {
    const cmd = buildEngineCommand("ANTIGRAVITY", "/tmp/prompt.md", linuxEnv());
    expect(cmd.command).toBe("agy");
  });

  it("uses ~/.local/bin/agy on Linux when it exists", () => {
    const exe = "/home/opc/.local/bin/agy";
    const cmd = buildEngineCommand("ANTIGRAVITY", "/tmp/prompt.md", linuxEnv([exe]));
    expect(cmd.command).toBe(exe);
  });
});
