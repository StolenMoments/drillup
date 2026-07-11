import { z } from "zod";

const nonBlank = z.string().trim().min(1);
const stringList = z.array(nonBlank);

const referenceFactSchema = z.object({
  id: nonBlank,
  statement: nonBlank,
  sourceFile: nonBlank,
});

const constraintSchema = z.object({
  id: nonBlank,
  statement: nonBlank,
  kind: z.enum(["FUNCTIONAL", "SECURITY", "PERFORMANCE", "COST", "OPERATIONS", "INTEGRATION", "COMPLIANCE"]),
  factIds: stringList,
});

const choiceSchema = z.object({
  id: nonBlank,
  solution: nonBlank,
  serviceNames: stringList,
  satisfiedConstraintIds: stringList,
  violatedConstraintIds: stringList,
  misconception: nonBlank,
  correct: z.boolean(),
});

export const questionBlueprintSchema = z.object({
  id: nonBlank,
  domainTask: nonBlank,
  testedDistinction: nonBlank,
  referenceFacts: z.array(referenceFactSchema).min(1),
  constraints: z.array(constraintSchema).min(1),
  choices: z.array(choiceSchema).min(1),
  reasoningSteps: z.array(nonBlank).min(1),
});

export const questionBlueprintEnvelopeSchema = z.object({
  blueprints: z.array(questionBlueprintSchema).min(1),
});

export type BlueprintReferenceFact = z.infer<typeof referenceFactSchema>;
export type BlueprintConstraint = z.infer<typeof constraintSchema>;
export type BlueprintChoice = z.infer<typeof choiceSchema>;
export type QuestionBlueprint = z.infer<typeof questionBlueprintSchema>;
export type QuestionBlueprintEnvelope = z.infer<typeof questionBlueprintEnvelopeSchema>;

export type BlueprintParseResult =
  | { ok: true; blueprints: QuestionBlueprint[] }
  | { ok: false; fatal: string };

export function parseQuestionBlueprintJson(rawText: string): BlueprintParseResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "Invalid JSON." };
  }
  const result = questionBlueprintEnvelopeSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, fatal: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  }
  return { ok: true, blueprints: result.data.blueprints };
}
