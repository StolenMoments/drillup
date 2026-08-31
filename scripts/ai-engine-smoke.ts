import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { aiOutputContracts } from "../src/core/ai-output-contracts";
import { runEngine } from "../src/server/generation/run-engine";

process.env.AI_SANDBOX_REQUIRED = "1";

const fixtureDir = await mkdtemp(path.join(tmpdir(), "drillup-ai-smoke-"));
const referencePath = path.join(fixtureDir, "reference.txt");
const token = `DRILLUP_SMOKE_${Date.now()}`;
await writeFile(referencePath, `Reference token: ${token}\n`, "utf-8");

try {
  for (const engine of ["CLAUDE", "CODEX", "ANTIGRAVITY"] as const) {
    const prompt = `Read this copied reference file: ${referencePath}\nUse web search to confirm that example.com is an IANA-reserved example domain. Return JSON {"note":"REFERENCE_OK:<token>; WEB_OK:example.com"}.`;
    const result = await runEngine(
      engine,
      prompt,
      path.join(fixtureDir, engine.toLowerCase()),
      aiOutputContracts.note,
      "",
      [referencePath],
    );
    if (!result.ok) {
      throw new Error(`${engine} smoke test failed: ${result.failureReason}`);
    }
    const parsed = JSON.parse(result.resultText) as { note?: string };
    if (!parsed.note?.includes(token) || !parsed.note.includes("WEB_OK:example.com")) {
      throw new Error(`${engine} smoke test returned an unexpected structured response`);
    }
    console.log(`[ai-smoke] ${engine}: reference, web, and structured output checks passed.`);
  }
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}
