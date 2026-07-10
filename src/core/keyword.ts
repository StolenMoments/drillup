export const KEYWORD_MAX_LENGTH = 50;

export function normalizeKeywordName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function dedupeKeywordNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = normalizeKeywordName(raw);
    if (!name || name.length > KEYWORD_MAX_LENGTH) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}
