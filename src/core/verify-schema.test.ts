import { describe, expect, it } from "vitest";
import type { ImportItemResult } from "./import-schema";
import { mergeVerdicts, parseVerifyJson } from "./verify-schema";

describe("parseVerifyJson", () => {
  it("normalizes violation codes", () => {
    expect(parseVerifyJson(JSON.stringify({ verdicts: [{ index: 0, verdict: "fail", violation_codes: [" A ", "", "A", "B"] }] }))).toEqual({ ok: true, verdicts: [{ index: 0, verdict: "fail", comment: null, violationCodes: ["A", "B"] }] });
  });
  it("keeps violation codes optional", () => {
    expect(parseVerifyJson(JSON.stringify({ verdicts: [{ index: 0, verdict: "pass" }] }))).toEqual({ ok: true, verdicts: [{ index: 0, verdict: "pass", comment: null, violationCodes: [] }] });
  });
  it("rejects invalid JSON", () => expect(parseVerifyJson("not json").ok).toBe(false));
});

describe("mergeVerdicts", () => {
  it("does not expose internal violation codes in item DTOs", () => {
    const question = { type: "mcq" as const, question: "q", choices: ["a", "b", "c", "d"], answer_index: 0 };
    const items: ImportItemResult[] = [{ index: 0, ok: true, question }];
    expect(mergeVerdicts(items, [{ index: 0, verdict: "fail", comment: "bad", violationCodes: ["X"] }])).toEqual([{ index: 0, ok: true, question, verdict: "fail", verdictComment: "bad" }]);
  });
});
