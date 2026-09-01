import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aiSandboxRequired,
  sanitizedAiEnv,
  wrapWithBubblewrap,
} from "./ai-sandbox";

const original = process.env.AI_SANDBOX_REQUIRED;
const tempHomes: string[] = [];

function expectMount(
  args: string[],
  option: "--bind" | "--ro-bind",
  source: string,
): void {
  const sourceIndex = args.indexOf(source);
  expect(args.slice(sourceIndex - 1, sourceIndex + 2)).toEqual([
    option,
    source,
    source,
  ]);
}

afterEach(() => {
  if (original === undefined) delete process.env.AI_SANDBOX_REQUIRED;
  else process.env.AI_SANDBOX_REQUIRED = original;
  for (const tempHome of tempHomes.splice(0)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

describe("ai sandbox policy", () => {
  it("운영 Linux에서는 bubblewrap을 강제한다", () => {
    expect(aiSandboxRequired("linux", { NODE_ENV: "production" })).toBe(true);
    expect(aiSandboxRequired("win32", { NODE_ENV: "production" })).toBe(false);
  });

  it("DB와 앱 비밀 환경변수를 자식에게 넘기지 않는다", () => {
    const env = sanitizedAiEnv("CODEX", "/home/opc", {
      PATH: "/usr/bin",
      DB_PASSWORD: "db-secret",
      SESSION_SECRET: "session-secret",
      APP_PASSWORD: "app-secret",
      OPENAI_API_KEY: "api-secret",
    });
    expect(env).toMatchObject({ HOME: "/home/opc", PATH: "/usr/bin", CODEX_HOME: "/home/opc/.codex" });
    expect(env.DB_PASSWORD).toBeUndefined();
    expect(env.SESSION_SECRET).toBeUndefined();
    expect(env.APP_PASSWORD).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("Antigravity 인증과 프로젝트 상태는 쓰기 가능하게 마운트한다", () => {
    process.env.AI_SANDBOX_REQUIRED = "true";
    const homeDir = mkdtempSync(path.join(tmpdir(), "drillup-ai-sandbox-"));
    tempHomes.push(homeDir);
    const authDir = path.join(homeDir, ".gemini", "antigravity-cli");
    const configDir = path.join(homeDir, ".gemini", "config");
    mkdirSync(authDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });

    const launch = wrapWithBubblewrap({
      engine: "ANTIGRAVITY",
      command: "/usr/bin/agy",
      args: [],
      runDir: path.join(homeDir, "run"),
      homeDir,
    });

    expectMount(launch.args, "--bind", authDir);
    expectMount(launch.args, "--bind", configDir);
  });

  it("다른 엔진의 인증 정보는 계속 읽기 전용으로 마운트한다", () => {
    process.env.AI_SANDBOX_REQUIRED = "true";
    const homeDir = mkdtempSync(path.join(tmpdir(), "drillup-ai-sandbox-"));
    tempHomes.push(homeDir);
    const authDir = path.join(homeDir, ".codex");
    mkdirSync(authDir, { recursive: true });

    const launch = wrapWithBubblewrap({
      engine: "CODEX",
      command: "/usr/bin/codex",
      args: [],
      runDir: path.join(homeDir, "run"),
      homeDir,
    });

    expectMount(launch.args, "--ro-bind", authDir);
  });
});
