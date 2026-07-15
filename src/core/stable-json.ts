function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortValue(record[key])]),
    );
  }

  return value;
}

export function stableStringify(value: unknown): string {
  const serialized = JSON.stringify(sortValue(value));
  return serialized === undefined ? "null" : serialized;
}

export async function sha256Fingerprint(value: unknown): Promise<string> {
  const input = new TextEncoder().encode(stableStringify(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
