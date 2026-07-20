import path from "node:path";
import type { GenerationEngine } from "@prisma/client";
import { extractJsonObject } from "@/core/json-extract";
import { buildNoteExtractPrompt } from "@/core/note-extract-prompt";
import { parseNoteTidyResult } from "@/core/note-tidy-result";
import type { ClozePayload, McqPayload } from "@/core/types";
import type { NoteExtractDto } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { runEngine } from "./generation/run-engine";

export async function extractNoteFromQuestion(
  questionId: number,
  engine: GenerationEngine,
): Promise<NoteExtractDto> {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
  });
  if (!question) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }

  const note = await prisma.topicNote.findUnique({
    where: { topicId: question.topicId },
  });

  const dir = path.resolve(
    "generation_output",
    "note-extracts",
    `${questionId}-${engine.toLowerCase()}`,
  );
  const prompt = buildNoteExtractPrompt(
    question.type,
    question.payload as unknown as McqPayload | ClozePayload,
    question.explanation,
    note?.content ?? "",
    path.join(dir, "result.json"),
  );

  const run = await runEngine(engine, prompt, dir);
  if (!run.ok) {
    throw new ServiceError("NOTE_EXTRACT_FAILED", run.failureReason, 502);
  }

  const parsed = parseNoteTidyResult(extractJsonObject(run.resultText), {
    allowEmpty: true,
  });
  if (!parsed.ok) {
    throw new ServiceError("NOTE_EXTRACT_PARSE_ERROR", parsed.fatal, 502);
  }

  return { engine, extracted: parsed.note };
}
