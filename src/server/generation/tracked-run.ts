import type { GenerationEngine, GenerationRunStage } from "@prisma/client";
import { prisma } from "../db";
import { runEngine, type EngineRunOptions, type EngineRunResult } from "./run-engine";

type Input = { generationJobId: number; stage: GenerationRunStage; itemIndex?: number; attempt?: number; engine: GenerationEngine; model?: string; prompt: string; dir: string; filePrefix?: string; options?: EngineRunOptions };

function persistenceFailure(error: unknown): void { console.error("generation run log persistence failed", error); }

async function update(runLogId: number | null, data: Record<string, unknown>): Promise<void> {
  if (runLogId === null) return;
  await prisma.generationRunLog.update({ where: { id: runLogId }, data }).catch(persistenceFailure);
}

export async function runTrackedEngine(input: Input): Promise<EngineRunResult & { runLogId: number | null }> {
  const runLogId = await prisma.generationRunLog.create({ data: { generationJobId: input.generationJobId, stage: input.stage, itemIndex: input.itemIndex, attempt: input.attempt, engine: input.engine, model: input.model, status: "RUNNING", prompt: input.prompt }, select: { id: true } }).then((row) => row.id).catch((error) => { persistenceFailure(error); return null; });
  const result = await runEngine(input.engine, input.prompt, input.dir, input.filePrefix, input.options);
  const diagnosticData = { response: result.ok ? result.resultText : null, stdoutTail: result.stdoutTail || null, stderrTail: result.stderrTail || null, exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs };
  if (result.ok) await update(runLogId, diagnosticData);
  else await update(runLogId, { ...diagnosticData, status: "FAILED", errorMessage: result.failureReason, finishedAt: new Date() });
  return { ...result, runLogId };
}

export async function completeTrackedRun(runLogId: number | null): Promise<void> { await update(runLogId, { status: "SUCCEEDED", finishedAt: new Date() }); }
export async function failTrackedRun(runLogId: number | null, errorMessage: string): Promise<void> { await update(runLogId, { status: "FAILED", errorMessage, finishedAt: new Date() }); }
