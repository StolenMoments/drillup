import { describe, expect, it } from "vitest";
import { assessQuestionBlueprint } from "./question-difficulty";
import type { QuestionBlueprint } from "./question-blueprint";

const blueprint: QuestionBlueprint = {
  id: "b", domainTask: "deploy securely", testedDistinction: "managed versus self-managed", referenceFacts: [{ id: "f1", statement: "a", sourceFile: "a.md" }, { id: "f2", statement: "b", sourceFile: "b.md" }],
  constraints: ["c1", "c2", "c3"].map((id, index) => ({ id, statement: id, kind: index === 0 ? "SECURITY" : "OPERATIONS", factIds: [index === 2 ? "f2" : "f1"] })),
  choices: [
    { id: "a", solution: "correct", serviceNames: ["A", "B"], satisfiedConstraintIds: ["c1", "c2", "c3"], violatedConstraintIds: [], misconception: "none", correct: true },
    { id: "b", solution: "near 1", serviceNames: ["A"], satisfiedConstraintIds: ["c1", "c2"], violatedConstraintIds: ["c3"], misconception: "misses c3", correct: false },
    { id: "c", solution: "near 2", serviceNames: ["B"], satisfiedConstraintIds: ["c1", "c3"], violatedConstraintIds: ["c2"], misconception: "misses c2", correct: false },
    { id: "d", solution: "wrong", serviceNames: ["C"], satisfiedConstraintIds: ["c1"], violatedConstraintIds: ["c2", "c3"], misconception: "misses", correct: false },
  ], reasoningSteps: ["compare", "select"],
};
describe("assessQuestionBlueprint", () => {
  it("passes level 4 structural blueprint", () => expect(assessQuestionBlueprint(blueprint)).toMatchObject({ pass: true, level: 4 }));
  it("reports required structure violations", () => {
    const invalid = structuredClone(blueprint); invalid.constraints = invalid.constraints.slice(0, 2); invalid.choices[1].violatedConstraintIds = [];
    const codes = assessQuestionBlueprint(invalid).violations.map((item) => item.code);
    expect(codes).toContain("CONSTRAINT_COUNT"); expect(codes).toContain("DISTRACTOR_HAS_NO_VIOLATION");
  });
  it("calculates level 5 for a three-step service composition", () => {
    const advanced = structuredClone(blueprint); advanced.reasoningSteps.push("tradeoff");
    expect(assessQuestionBlueprint(advanced).level).toBe(5);
  });
});
