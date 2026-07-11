import { describe, expect, it } from "vitest";
import { parseQuestionBlueprintJson } from "./question-blueprint";

const valid = { blueprints: [{ id: "b1", domainTask: "task", testedDistinction: "distinction", referenceFacts: [{ id: "f1", statement: "fact", sourceFile: "source.md" }], constraints: [{ id: "c1", statement: "constraint", kind: "FUNCTIONAL", factIds: ["f1"] }], choices: [{ id: "a", solution: "solution", serviceNames: ["svc"], satisfiedConstraintIds: ["c1"], violatedConstraintIds: [], misconception: "none", correct: true }], reasoningSteps: ["step"] }] };

describe("parseQuestionBlueprintJson", () => {
  it("parses a valid blueprint envelope", () => expect(parseQuestionBlueprintJson(JSON.stringify(valid))).toMatchObject({ ok: true }));
  it("rejects malformed JSON and missing envelope", () => {
    expect(parseQuestionBlueprintJson("no").ok).toBe(false);
    expect(parseQuestionBlueprintJson("{}").ok).toBe(false);
  });
  it("rejects blank fields and invalid enum", () => {
    const blank = structuredClone(valid); blank.blueprints[0].referenceFacts[0].statement = " ";
    const kind = structuredClone(valid); kind.blueprints[0].constraints[0].kind = "OTHER";
    expect(parseQuestionBlueprintJson(JSON.stringify(blank))).toMatchObject({ ok: false });
    expect(parseQuestionBlueprintJson(JSON.stringify(kind))).toMatchObject({ ok: false });
  });
});
