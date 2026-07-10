import { z } from "zod";
import {
  importClozeSchema,
  importMcqSchema,
  type ImportQuestion,
} from "./import-schema";

const revisionSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  comment: z.string().trim().min(1),
  revised_question: z.unknown(),
});

export type RevisionParseResult =
  | {
      ok: true;
      verdict: "pass" | "fail";
      comment: string;
      question: ImportQuestion;
    }
  | { ok: false; fatal: string };

export function parseRevisionJson(rawText: string): RevisionParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }
  const parsed = revisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fatal: "verdict, comment, revised_question이 필요합니다" };
  }
  const type =
    typeof parsed.data.revised_question === "object" &&
    parsed.data.revised_question !== null
      ? (parsed.data.revised_question as Record<string, unknown>).type
      : undefined;
  const question =
    type === "mcq"
      ? importMcqSchema.safeParse(parsed.data.revised_question)
      : type === "cloze"
        ? importClozeSchema.safeParse(parsed.data.revised_question)
        : null;
  if (!question?.success) {
    return { ok: false, fatal: "수정 문제가 가져오기 형식에 맞지 않습니다" };
  }
  return {
    ok: true,
    verdict: parsed.data.verdict,
    comment: parsed.data.comment,
    question: question.data,
  };
}
