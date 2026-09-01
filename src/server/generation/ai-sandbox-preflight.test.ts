import { afterEach, describe, expect, it, vi } from "vitest";

const existsSyncMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({ existsSync: existsSyncMock }));
vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));

import { aiSandboxPreflight } from "./ai-sandbox";

const originalSandboxRequired = process.env.AI_SANDBOX_REQUIRED;

afterEach(() => {
  if (originalSandboxRequired === undefined) {
    delete process.env.AI_SANDBOX_REQUIRED;
  } else {
    process.env.AI_SANDBOX_REQUIRED = originalSandboxRequired;
  }
  existsSyncMock.mockReset();
  spawnSyncMock.mockReset();
});

describe("AI sandbox preflight", () => {
  it("샌드박스 내부 검사를 POSIX 셸로 실행한다", () => {
    process.env.AI_SANDBOX_REQUIRED = "1";
    existsSyncMock.mockReturnValue(true);
    spawnSyncMock.mockReturnValue({ status: 0, stderr: "" });

    expect(aiSandboxPreflight()).toEqual({ ok: true });

    const args = spawnSyncMock.mock.calls[0]?.[1];
    expect(args).toEqual(
      expect.arrayContaining([
        "--ro-bind-try",
        "/lib",
        "/lib",
        "--ro-bind-try",
        "/lib64",
        "/lib64",
      ]),
    );
    expect(args?.slice(-4)).toEqual(["--", "/bin/sh", "-c", "exit 0"]);
    expect(args).not.toContain("/usr/bin/true");
  });
});
