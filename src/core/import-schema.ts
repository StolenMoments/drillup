import { z } from "zod";
import { KEYWORD_MAX_LENGTH } from "./keyword";

const nonBlank = z.string().trim().min(1, "빈 문자열은 허용하지 않습니다");
const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g;

const keywordListSchema = z
  .array(nonBlank.max(KEYWORD_MAX_LENGTH, `키워드는 ${KEYWORD_MAX_LENGTH}자 이하여야 합니다`))
  .max(5, "키워드는 최대 5개입니다")
  .optional();

const mcqBase = z.object({
  question: nonBlank,
  choices: z
    .array(nonBlank)
    .min(4, "보기는 4~6개여야 합니다")
    .max(6, "보기는 4~6개여야 합니다"),
  answer_index: z
    .number()
    .int()
    .min(0, "answer_index는 보기 범위 안이어야 합니다"),
});

function refineMcq(question: z.infer<typeof mcqBase>, ctx: z.RefinementCtx) {
  if (question.answer_index >= question.choices.length) {
    ctx.addIssue({
      code: "custom",
      path: ["answer_index"],
      message: "answer_index는 보기 범위 안이어야 합니다",
    });
  }

  if (
    new Set(question.choices.map((choice) => choice.trim())).size !==
    question.choices.length
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["choices"],
      message: "보기에는 중복이 없어야 합니다",
    });
  }
}

const clozeBase = z.object({
  text: nonBlank,
  blanks: z
    .array(z.object({ id: z.number().int().positive(), answer: nonBlank }))
    .min(1, "빈칸은 1개 이상 필요합니다"),
  distractors: z.array(nonBlank).min(1, "오답 단어가 1개 이상 필요합니다"),
});

function refineCloze(question: z.infer<typeof clozeBase>, ctx: z.RefinementCtx) {
  const textIds = new Set(
    [...question.text.matchAll(PLACEHOLDER_RE)].map((match) =>
      Number(match[1]),
    ),
  );
  const blankIds = question.blanks.map((blank) => blank.id);
  const uniqueBlankIds = new Set(blankIds);

  if (uniqueBlankIds.size !== blankIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["blanks"],
      message: "blanks의 id가 중복됩니다",
    });
  }

  const sameSize = textIds.size === uniqueBlankIds.size;
  const allMatch = blankIds.every((id) => textIds.has(id));
  if (!sameSize || !allMatch) {
    ctx.addIssue({
      code: "custom",
      path: ["text"],
      message: "text의 {{n}} 자리표시자와 blanks의 id 집합이 일치해야 합니다",
    });
  }

  const words = [
    ...question.blanks.map((blank) => blank.answer.trim()),
    ...question.distractors.map((distractor) => distractor.trim()),
  ];
  if (new Set(words).size !== words.length) {
    ctx.addIssue({
      code: "custom",
      path: ["distractors"],
      message: "단어장에는 정답과 오답을 통틀어 중복 단어가 없어야 합니다",
    });
  }
}

export const mcqPayloadSchema = mcqBase.superRefine(refineMcq);
export const clozePayloadSchema = clozeBase.superRefine(refineCloze);

export const importMcqSchema = mcqBase
  .extend({
    type: z.literal("mcq"),
    explanation: z.string().optional(),
    keywords: keywordListSchema,
  })
  .superRefine(refineMcq);

export const importClozeSchema = clozeBase
  .extend({
    type: z.literal("cloze"),
    explanation: z.string().optional(),
    keywords: keywordListSchema,
  })
  .superRefine(refineCloze);

export type ImportQuestion =
  | z.infer<typeof importMcqSchema>
  | z.infer<typeof importClozeSchema>;

export type ImportItemResult =
  | { index: number; ok: true; question: ImportQuestion }
  | { index: number; ok: false; errors: string[] };

export type ImportParseResult =
  | { ok: true; items: ImportItemResult[] }
  | { ok: false; fatal: string };

export function validateImportQuestions(
  questions: unknown[],
): ImportItemResult[] {
  return questions.map((raw, index) => {
    const type =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>).type
        : undefined;
    const schema =
      type === "mcq" ? importMcqSchema : type === "cloze" ? importClozeSchema : null;

    if (!schema) {
      return {
        index,
        ok: false,
        errors: ['type은 "mcq" 또는 "cloze"여야 합니다'],
      };
    }

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        index,
        ok: false,
        errors: parsed.error.issues.map((issue) => {
          const path = issue.path.join(".");
          return path ? `${path}: ${issue.message}` : issue.message;
        }),
      };
    }

    return { index, ok: true, question: parsed.data };
  });
}

export function parseImportJson(rawText: string): ImportParseResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }

  const questions =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>).questions
      : undefined;
  if (!Array.isArray(questions) || questions.length === 0) {
    return {
      ok: false,
      fatal: "최상위에 questions 배열이 있어야 하며 비어 있으면 안 됩니다",
    };
  }

  return { ok: true, items: validateImportQuestions(questions) };
}
