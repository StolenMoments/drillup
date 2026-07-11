// 배포 드레인용 순수 함수 모음.
// 주의: 이전 배포의 node_modules로 실행하므로 다른 패키지를 import하지 않는다.

export const DEFAULT_GENERATION_TIMEOUT_MS = 10 * 60 * 1000;
export const ORPHAN_GRACE_MS = 60_000;
export const DEFAULT_DRAIN_TIMEOUT_SECONDS = 40 * 60;
export const POLL_INTERVAL_MS = 10_000;

export function parseEnvFile(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// src/server/generation/run-engine.ts의 generationTimeoutMs와 같은 규칙.
export function generationTimeoutMs(env) {
  const raw = Number(env.GENERATION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GENERATION_TIMEOUT_MS;
}

// generation-service.ts getJob()의 고아 판정 window와 같은 규칙.
export function orphanWindowMs(env) {
  return 2 * generationTimeoutMs(env) + ORPHAN_GRACE_MS;
}

export function staleCutoff(env, now = new Date()) {
  return new Date(now.getTime() - orphanWindowMs(env));
}

export function drainTimeoutMs(env) {
  const raw = Number(env.DEPLOY_DRAIN_TIMEOUT_SECONDS);
  const seconds =
    Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DRAIN_TIMEOUT_SECONDS;
  return seconds * 1000;
}

// src/server/db.ts createAdapter()와 같은 우선순위: DATABASE_URL 우선, "${" 포함 시 무시.
export function connectionConfig(env) {
  const directUrl = env.DATABASE_URL;
  if (directUrl && !directUrl.includes("${")) {
    const url = new URL(directUrl);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ""),
    };
  }
  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = env;
  if (!DB_HOST || !DB_USER || DB_PASSWORD === undefined || !DB_NAME) {
    throw new Error(
      "DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME is required",
    );
  }
  return {
    host: DB_HOST,
    port: Number(env.DB_PORT ?? "3306"),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  };
}

// 고아 window 이내의 활성 job만 센다. placeholder는 (cutoff, cutoff) 순서.
export const ACTIVE_JOBS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM generation_job
      WHERE status IN ('RUNNING', 'VERIFYING') AND created_at > ?)
    +
    (SELECT COUNT(*) FROM generation_item_revision
      WHERE status = 'RUNNING' AND created_at > ?)
    AS activeCount
`;
