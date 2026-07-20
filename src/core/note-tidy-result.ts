import { z } from "zod";

const noteTidySchema = z.object({ note: z.string() });

export type NoteTidyParseResult =
  | { ok: true; note: string }
  | { ok: false; fatal: string };

export interface NoteTidyParseOptions {
  /** 빈 note를 정상 결과(빈 문자열)로 받을지 여부. 기본 false. */
  allowEmpty?: boolean;
}

export function parseNoteTidyResult(
  rawText: string,
  options: NoteTidyParseOptions = {},
): NoteTidyParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }
  const parsed = noteTidySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fatal: "note 필드가 필요합니다" };
  }
  const note = parsed.data.note.trim();
  if (note.length === 0 && !options.allowEmpty) {
    return { ok: false, fatal: "정리된 노트가 비어 있습니다" };
  }
  return { ok: true, note };
}
