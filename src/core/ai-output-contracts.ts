import { z } from "zod";
import { defineAiOutputContract } from "./ai-output-contract";

const nonBlank = z.string().trim().min(1);
const stringList = z.array(nonBlank);
const nullableText = z.string().nullable();
const passFailAliases = {
  pass: "pass",
  fail: "fail",
  revise: "fail",
  needs_revision: "fail",
  needs_changes: "fail",
  ok: "pass",
  approved: "pass",
} as const;

const mcqPayload = z.strictObject({
  question: nonBlank,
  choices: z.array(nonBlank).min(4).max(6),
  answer_indices: z.array(z.number().int().min(0)).min(1).max(2),
  choice_explanations: z.array(nonBlank),
});

const generatedMcq = mcqPayload.extend({
  type: z.literal("mcq"),
  explanation: nonBlank,
  keywords: stringList,
});

const blueprint = z.strictObject({
  id: nonBlank,
  domainTask: nonBlank,
  testedDistinction: nonBlank,
  referenceFacts: z.array(
    z.strictObject({ id: nonBlank, statement: nonBlank, sourceFile: nonBlank }),
  ).min(1),
  constraints: z.array(
    z.strictObject({
      id: nonBlank,
      statement: nonBlank,
      kind: z.enum([
        "FUNCTIONAL",
        "SECURITY",
        "PERFORMANCE",
        "COST",
        "OPERATIONS",
        "INTEGRATION",
        "COMPLIANCE",
      ]),
      factIds: stringList,
    }),
  ).min(1),
  choices: z.array(
    z.strictObject({
      id: nonBlank,
      solution: nonBlank,
      serviceNames: stringList,
      satisfiedConstraintIds: stringList,
      violatedConstraintIds: stringList,
      correct: z.boolean(),
      misconception: nullableText,
    }),
  ).min(1),
  reasoningSteps: z.array(nonBlank).min(1),
});

const verifyEnvelope = z.strictObject({
  verdicts: z.array(
    z.strictObject({
      index: z.number().int().min(0),
      verdict: z.enum(["pass", "fail"]),
      comment: z.string(),
      violation_codes: z.array(z.string()),
    }),
  ),
});

const revisionEnvelope = z.strictObject({
  verdict: z.enum(["pass", "fail"]),
  comment: nonBlank,
  revised_question: generatedMcq,
});

export const aiOutputContracts = {
  blueprint: defineAiOutputContract({
    id: "drillup.question-blueprint.v1",
    parser: z.strictObject({ blueprints: z.array(blueprint).min(1) }),
  }),
  questions: defineAiOutputContract({
    id: "drillup.questions.v1",
    parser: z.strictObject({ questions: z.array(generatedMcq).min(1) }),
  }),
  verifyPassFail: defineAiOutputContract({
    id: "drillup.verify-pass-fail.v1",
    parser: verifyEnvelope,
    allowedEnums: { "verdicts.*.verdict": ["pass", "fail"] },
    normalizationRules: [
      { path: "verdicts.*.verdict", aliases: passFailAliases },
    ],
  }),
  revisionPassFail: defineAiOutputContract({
    id: "drillup.revision-pass-fail.v1",
    parser: revisionEnvelope,
    allowedEnums: { verdict: ["pass", "fail"] },
    normalizationRules: [{ path: "verdict", aliases: passFailAliases }],
  }),
  keywordAssignments: defineAiOutputContract({
    id: "drillup.keyword-assignments.v1",
    parser: z.strictObject({
      assignments: z.array(
        z.strictObject({ id: z.number().int().positive(), keywords: stringList.min(1) }),
      ),
    }),
  }),
  keywordSuggestion: defineAiOutputContract({
    id: "drillup.keyword-suggestion.v1",
    parser: z.strictObject({ keywords: stringList.min(1) }),
  }),
  explanation: defineAiOutputContract({
    id: "drillup.explanation.v1",
    parser: z.strictObject({
      explanation: nonBlank,
      factual_concern: nullableText,
      choice_explanations: z.array(
        z.strictObject({
          choice: nonBlank,
          explanation: nonBlank,
          aws_reference: z.strictObject({ title: nonBlank, url: nonBlank }),
        }),
      ).nullable(),
    }),
  }),
  hardenChoices: defineAiOutputContract({
    id: "drillup.harden-choices.v1",
    parser: z.strictObject({
      comment: nonBlank,
      factual_concern: nullableText,
      revised: mcqPayload,
    }),
  }),
  factualReview: defineAiOutputContract({
    id: "drillup.factual-review.v1",
    parser: z.strictObject({
      verdict: z.enum(["confirmed", "rejected", "unverifiable"]),
      comment: nonBlank,
      evidence_url: nullableText,
      revised: mcqPayload.nullable(),
    }),
    allowedEnums: { verdict: ["confirmed", "rejected", "unverifiable"] },
  }),
  freshnessReview: defineAiOutputContract({
    id: "drillup.freshness-review.v1",
    parser: z.strictObject({
      verdict: z.enum(["pass", "fail", "unverified"]),
      comment: nonBlank,
      evidence_url: nullableText,
      revised: mcqPayload.nullable(),
    }),
    allowedEnums: { verdict: ["pass", "fail", "unverified"] },
  }),
  note: defineAiOutputContract({
    id: "drillup.note.v1",
    parser: z.strictObject({ note: z.string() }),
  }),
} as const;
