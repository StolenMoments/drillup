import { describe, expect, it } from "vitest";
import {
  ACTIVE_JOBS_SQL,
  connectionConfig,
  drainTimeoutMs,
  generationTimeoutMs,
  orphanWindowMs,
  parseEnvFile,
  staleCutoff,
} from "./drain-lib.mjs";

describe("parseEnvFile", () => {
  it("KEY=VALUE 줄을 파싱한다", () => {
    expect(parseEnvFile("DB_HOST=localhost\nDB_PORT=3307")).toEqual({
      DB_HOST: "localhost",
      DB_PORT: "3307",
    });
  });

  it("주석과 빈 줄을 무시한다", () => {
    expect(parseEnvFile("# comment\n\nDB_NAME=drillup\n")).toEqual({
      DB_NAME: "drillup",
    });
  });

  it("양쪽 따옴표를 제거한다", () => {
    expect(parseEnvFile("A=\"hello world\"\nB='single'")).toEqual({
      A: "hello world",
      B: "single",
    });
  });

  it("값 안의 =는 그대로 둔다", () => {
    expect(parseEnvFile("URL=mysql://u:p@h/db?a=1")).toEqual({
      URL: "mysql://u:p@h/db?a=1",
    });
  });
});

describe("generationTimeoutMs / orphanWindowMs", () => {
  it("기본값은 10분 / 2배 + 60초다", () => {
    expect(generationTimeoutMs({})).toBe(600_000);
    expect(orphanWindowMs({})).toBe(1_260_000);
  });

  it("GENERATION_TIMEOUT_MS를 반영한다", () => {
    expect(orphanWindowMs({ GENERATION_TIMEOUT_MS: "60000" })).toBe(180_000);
  });

  it("잘못된 값이면 기본값을 쓴다", () => {
    expect(orphanWindowMs({ GENERATION_TIMEOUT_MS: "abc" })).toBe(1_260_000);
    expect(orphanWindowMs({ GENERATION_TIMEOUT_MS: "-5" })).toBe(1_260_000);
  });
});

describe("staleCutoff", () => {
  it("now에서 orphan window만큼 뺀 시각을 돌려준다", () => {
    const now = new Date("2026-07-11T12:00:00Z");
    expect(staleCutoff({}, now).getTime()).toBe(now.getTime() - 1_260_000);
  });
});

describe("drainTimeoutMs", () => {
  it("기본값은 40분", () => {
    expect(drainTimeoutMs({})).toBe(2_400_000);
  });

  it("DEPLOY_DRAIN_TIMEOUT_SECONDS를 반영한다", () => {
    expect(drainTimeoutMs({ DEPLOY_DRAIN_TIMEOUT_SECONDS: "60" })).toBe(60_000);
    expect(drainTimeoutMs({ DEPLOY_DRAIN_TIMEOUT_SECONDS: "0" })).toBe(0);
  });

  it("잘못된 값이면 기본값을 쓴다", () => {
    expect(drainTimeoutMs({ DEPLOY_DRAIN_TIMEOUT_SECONDS: "abc" })).toBe(2_400_000);
  });
});

describe("connectionConfig", () => {
  it("DATABASE_URL을 우선 사용한다", () => {
    expect(
      connectionConfig({ DATABASE_URL: "mysql://user:pw@dbhost:3307/drillup" }),
    ).toEqual({
      host: "dbhost",
      port: 3307,
      user: "user",
      password: "pw",
      database: "drillup",
    });
  });

  it("포트가 없으면 3306을 쓴다", () => {
    expect(connectionConfig({ DATABASE_URL: "mysql://u:p@h/db" }).port).toBe(3306);
  });

  it("${가 포함된 DATABASE_URL은 무시하고 개별 변수를 쓴다", () => {
    expect(
      connectionConfig({
        DATABASE_URL: "mysql://${DB_USER}@h/db",
        DB_HOST: "localhost",
        DB_USER: "u",
        DB_PASSWORD: "p",
        DB_NAME: "drillup",
      }),
    ).toEqual({
      host: "localhost",
      port: 3306,
      user: "u",
      password: "p",
      database: "drillup",
    });
  });

  it("접속 정보가 없으면 예외를 던진다", () => {
    expect(() => connectionConfig({})).toThrow();
  });
});

describe("ACTIVE_JOBS_SQL", () => {
  it("두 테이블의 활성 상태를 세고 placeholder가 2개다", () => {
    expect(ACTIVE_JOBS_SQL).toContain("generation_job");
    expect(ACTIVE_JOBS_SQL).toContain("generation_item_revision");
    expect(ACTIVE_JOBS_SQL).toContain("'RUNNING'");
    expect(ACTIVE_JOBS_SQL).toContain("'VERIFYING'");
    expect(ACTIVE_JOBS_SQL.split("?").length - 1).toBe(2);
  });
});
