import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHOICE_HARDENING_TABLE_EXISTS_SQL,
  activeJobsQuery,
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

describe("activeJobsQuery", () => {
  const cutoff = new Date("2026-07-15T00:00:00.000Z");

  it("테이블 부재 시 기존 두 job 테이블만 조회한다", () => {
    const query = activeJobsQuery(false, cutoff);

    expect(query.sql).toContain("generation_job");
    expect(query.sql).toContain("generation_item_revision");
    expect(query.sql).not.toContain("choice_hardening_job");
    expect(query.params).toEqual([cutoff, cutoff]);
    expect(query.sql.split("?").length - 1).toBe(query.params.length);
  });

  it("테이블 존재 시 non-stale choice hardening RUNNING job을 포함한다", () => {
    const query = activeJobsQuery(true, cutoff);

    expect(query.sql).toContain("choice_hardening_job");
    expect(query.sql).toContain("status = 'RUNNING'");
    expect(query.sql).toContain("started_at > ?");
    expect(query.sql).toContain("started_at IS NULL AND created_at > ?");
    expect(query.params).toEqual([cutoff, cutoff, cutoff, cutoff]);
    expect(query.sql.split("?").length - 1).toBe(query.params.length);
  });

  it("information_schema에서 choice hardening 테이블 존재 여부를 확인한다", () => {
    expect(CHOICE_HARDENING_TABLE_EXISTS_SQL).toContain("information_schema.tables");
    expect(CHOICE_HARDENING_TABLE_EXISTS_SQL).toContain("choice_hardening_job");
  });
});

describe("systemd unit", () => {
  it("after callback이 종료 중 마무리될 25분 유예를 둔다", () => {
    const unit = readFileSync("deploy/drillup.service", "utf8");
    expect(unit).toContain("TimeoutStopSec=25min");
  });
});

describe("choice hardening migration deployment", () => {
  it("MariaDB identifier 길이 제한을 넘지 않는다", () => {
    const migration = readFileSync(
      "prisma/migrations/20260715000000_add_choice_hardening_job/migration.sql",
      "utf8",
    );
    const identifiers = [...migration.matchAll(/(?:INDEX|CONSTRAINT) `([^`]+)`/g)]
      .map((match) => match[1]);

    expect(identifiers.length).toBeGreaterThan(0);
    expect(identifiers.filter((identifier) => identifier.length > 64)).toEqual([]);
  });

  it("실패 기록을 공식 resolve 후 한 번 재적용한다", () => {
    const deployScript = readFileSync("scripts/deploy-remote.sh", "utf8");

    expect(deployScript).toContain(
      "prisma migrate resolve --rolled-back 20260715000000_add_choice_hardening_job",
    );
    expect(deployScript.match(/prisma migrate deploy/g)).toHaveLength(2);
  });
});
