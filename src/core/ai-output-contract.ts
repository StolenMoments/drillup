import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

export interface AiOutputNormalizationRule {
  path: string;
  aliases: Readonly<Record<string, string>>;
}

export interface AiOutputContract<T = unknown> {
  id: string;
  schema: JsonSchema;
  parser: z.ZodType<T>;
  allowedEnums: Readonly<Record<string, readonly string[]>>;
  normalizationRules: readonly AiOutputNormalizationRule[];
}

export interface AiContractParseSuccess<T> {
  ok: true;
  value: T;
  normalizedValue: unknown;
  normalizedText: string;
  warnings: string[];
}

export interface AiContractParseFailure {
  ok: false;
  rawValue: unknown;
  normalizedValue: unknown;
  errors: string[];
  warnings: string[];
}

export type AiContractParseResult<T> =
  | AiContractParseSuccess<T>
  | AiContractParseFailure;

function valueAtPath(value: unknown, path: PropertyKey[]): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

function displayValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value === "" ? '""' : value;
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

function formatIssue(issue: z.core.$ZodIssue, value: unknown): string {
  const path = issue.path.map(String).join(".") || "$";
  const received = valueAtPath(value, issue.path);
  if (issue.code === "invalid_value" && "values" in issue) {
    const expected = (issue.values as unknown[]).map(String).join("|");
    return `${path}: expected ${expected}, received ${displayValue(received)}`;
  }
  return `${path}: ${issue.message}, received ${displayValue(received)}`;
}

function cloneJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function applyRule(
  root: unknown,
  segments: string[],
  aliases: Readonly<Record<string, string>>,
  warnings: string[],
  currentPath: string[] = [],
): void {
  if (segments.length === 0) return;
  if (typeof root !== "object" || root === null) return;
  const [segment, ...rest] = segments;
  if (segment === "*") {
    if (!Array.isArray(root)) return;
    root.forEach((item, index) =>
      applyRule(item, rest, aliases, warnings, [...currentPath, String(index)]),
    );
    return;
  }
  const object = root as Record<string, unknown>;
  if (rest.length > 0) {
    applyRule(object[segment], rest, aliases, warnings, [...currentPath, segment]);
    return;
  }
  const original = object[segment];
  if (typeof original !== "string") return;
  const lookup = original.trim().toLowerCase();
  const normalized = aliases[lookup];
  if (!normalized) return;
  object[segment] = normalized;
  if (normalized !== original) {
    warnings.push(
      `${[...currentPath, segment].join(".")}: normalized ${displayValue(original)} to ${displayValue(normalized)}`,
    );
  }
}

export function defineAiOutputContract<T>(input: {
  id: string;
  parser: z.ZodType<T>;
  allowedEnums?: Readonly<Record<string, readonly string[]>>;
  normalizationRules?: readonly AiOutputNormalizationRule[];
}): AiOutputContract<T> {
  return {
    id: input.id,
    parser: input.parser,
    schema: z.toJSONSchema(input.parser, {
      target: "draft-7",
      unrepresentable: "any",
    }) as JsonSchema,
    allowedEnums: input.allowedEnums ?? {},
    normalizationRules: input.normalizationRules ?? [],
  };
}

export function parseAiOutputContract<T>(
  contract: AiOutputContract<T>,
  rawText: string,
): AiContractParseResult<T> {
  let rawValue: unknown;
  try {
    rawValue = JSON.parse(rawText);
  } catch (error) {
    return {
      ok: false,
      rawValue: rawText,
      normalizedValue: rawText,
      errors: [
        `$: expected valid JSON, received ${displayValue(rawText)} (${error instanceof Error ? error.message : "parse error"})`,
      ],
      warnings: [],
    };
  }

  const normalizedValue = cloneJson(rawValue);
  const warnings: string[] = [];
  for (const rule of contract.normalizationRules) {
    applyRule(
      normalizedValue,
      rule.path.split("."),
      rule.aliases,
      warnings,
    );
  }
  const parsed = contract.parser.safeParse(normalizedValue);
  if (!parsed.success) {
    return {
      ok: false,
      rawValue,
      normalizedValue,
      errors: parsed.error.issues.map((issue) => formatIssue(issue, normalizedValue)),
      warnings,
    };
  }
  return {
    ok: true,
    value: parsed.data,
    normalizedValue,
    normalizedText: JSON.stringify(normalizedValue),
    warnings,
  };
}
