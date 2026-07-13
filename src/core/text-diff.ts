export type TextDiffPartType = "equal" | "insert" | "delete";

export interface TextDiffPart {
  type: TextDiffPartType;
  text: string;
}

function tokenize(text: string): string[] {
  return text.match(/\s|[^\s]+/gu) ?? [];
}

function pushPart(parts: TextDiffPart[], type: TextDiffPartType, text: string) {
  if (!text) return;
  const previous = parts.at(-1);
  if (previous?.type === type) {
    previous.text += text;
    return;
  }
  parts.push({ type, text });
}

export function diffText(original: string, revised: string): TextDiffPart[] {
  const originalTokens = tokenize(original);
  const revisedTokens = tokenize(revised);
  const lcs: number[][] = Array.from(
    { length: originalTokens.length + 1 },
    () => Array<number>(revisedTokens.length + 1).fill(0),
  );

  for (let originalIndex = originalTokens.length - 1; originalIndex >= 0; originalIndex -= 1) {
    for (let revisedIndex = revisedTokens.length - 1; revisedIndex >= 0; revisedIndex -= 1) {
      lcs[originalIndex][revisedIndex] =
        originalTokens[originalIndex] === revisedTokens[revisedIndex]
          ? lcs[originalIndex + 1][revisedIndex + 1] + 1
          : Math.max(lcs[originalIndex + 1][revisedIndex], lcs[originalIndex][revisedIndex + 1]);
    }
  }

  const parts: TextDiffPart[] = [];
  let originalIndex = 0;
  let revisedIndex = 0;

  while (originalIndex < originalTokens.length || revisedIndex < revisedTokens.length) {
    if (
      originalIndex < originalTokens.length &&
      revisedIndex < revisedTokens.length &&
      originalTokens[originalIndex] === revisedTokens[revisedIndex]
    ) {
      pushPart(parts, "equal", originalTokens[originalIndex]);
      originalIndex += 1;
      revisedIndex += 1;
    } else if (
      revisedIndex < revisedTokens.length &&
      (originalIndex === originalTokens.length ||
        lcs[originalIndex][revisedIndex + 1] > lcs[originalIndex + 1][revisedIndex])
    ) {
      pushPart(parts, "insert", revisedTokens[revisedIndex]);
      revisedIndex += 1;
    } else {
      pushPart(parts, "delete", originalTokens[originalIndex]);
      originalIndex += 1;
    }
  }

  return parts;
}
