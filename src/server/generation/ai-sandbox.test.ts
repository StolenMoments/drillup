import { afterEach, describe, expect, it } from "vitest";
import { aiSandboxRequired, sanitizedAiEnv } from "./ai-sandbox";

const original = process.env.AI_SANDBOX_REQUIRED;
afterEach(() => {
  if (original === undefined) delete process.env.AI_SANDBOX_REQUIRED;
  else process.env.AI_SANDBOX_REQUIRED = original;
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
});
