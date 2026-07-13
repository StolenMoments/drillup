import { type ImportItemResult, validateGeneratedQuestions } from "./import-schema";
import type { QuestionBlueprint } from "./question-blueprint";
import type { VerifiedItemResult } from "./verify-schema";

export function prepareGeneratedItems(sourceItems: ImportItemResult[]) {
  const items = sourceItems.map((item): ImportItemResult => {
    if (!item.ok) return item;
    const validated = validateGeneratedQuestions([item.question])[0];
    return { ...validated, index: item.index };
  });
  const validCount = items.filter((item) => item.ok).length;
  const firstInvalid = items.find((item) => !item.ok);
  const failureMessage = validCount === 0 && firstInvalid && !firstInvalid.ok
    ? `생성된 ${items.length}개 문항이 모두 유효성 검사를 통과하지 못했습니다. 첫 오류: #${firstInvalid.index + 1} ${firstInvalid.errors[0] ?? "알 수 없는 검증 오류"}`
    : null;
  return { items, validCount, failureMessage };
}

export type DistinctionTaggedItemResult =
  | (Extract<VerifiedItemResult, { ok: true }> & { testedDistinction: string | null })
  | Extract<VerifiedItemResult, { ok: false }>;

// 검증·수선 단계가 아이템 객체를 새로 만들며 필드를 잃으므로, job.result 저장 직전마다 호출한다.
export function attachTestedDistinctions(
  items: VerifiedItemResult[],
  blueprints: QuestionBlueprint[],
): DistinctionTaggedItemResult[] {
  return items.map((item) => {
    if (!item.ok) return item;
    const distinction = blueprints[item.index]?.testedDistinction?.trim();
    return { ...item, testedDistinction: distinction || null };
  });
}
