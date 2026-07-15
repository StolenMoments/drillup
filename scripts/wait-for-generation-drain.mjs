#!/usr/bin/env node
// 배포 전 활성 AI 생성 job이 끝날 때까지 대기한다.
// 이전 배포의 node_modules로 실행하므로 빌드 산출물에 의존하지 않는다.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  CHOICE_HARDENING_TABLE_EXISTS_SQL,
  POLL_INTERVAL_MS,
  activeJobsQuery,
  connectionConfig,
  drainTimeoutMs,
  parseEnvFile,
  staleCutoff,
} from "./drain-lib.mjs";

const root = process.cwd();

if (!existsSync(path.join(root, "node_modules", "mariadb"))) {
  console.log("[drain] node_modules/mariadb가 없어 드레인을 건너뜁니다 (최초 배포).");
  process.exit(0);
}

const envPath = path.join(root, ".env");
const fileEnv = existsSync(envPath)
  ? parseEnvFile(readFileSync(envPath, "utf-8"))
  : {};
const env = { ...fileEnv, ...process.env };

const { default: mariadb } = await import("mariadb");
const conn = await mariadb.createConnection(connectionConfig(env));
const deadline = Date.now() + drainTimeoutMs(env);

try {
  const tableRows = await conn.query(CHOICE_HARDENING_TABLE_EXISTS_SQL);
  const hasChoiceHardeningTable = Number(tableRows[0]?.tableCount ?? 0) > 0;
  for (;;) {
    const activeJobs = activeJobsQuery(
      hasChoiceHardeningTable,
      staleCutoff(env),
    );
    const rows = await conn.query(activeJobs.sql, activeJobs.params);
    const active = Number(rows[0]?.activeCount ?? 0);
    if (active === 0) {
      console.log("[drain] 활성 생성 job이 없습니다. 배포를 진행합니다.");
      break;
    }
    if (Date.now() >= deadline) {
      console.warn(
        `[drain] 경고: 활성 job ${active}개가 남아 있지만 최대 대기 시간을 초과해 배포를 계속합니다.`,
      );
      break;
    }
    console.log(`[drain] 활성 job ${active}개 — ${POLL_INTERVAL_MS / 1000}초 뒤 재확인합니다.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
} finally {
  await conn.end();
}
