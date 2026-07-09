const DRIVE_RE = /^[A-Za-z]:/;

/**
 * 참고 자료 루트 기준 상대 경로로 안전한지 판정한다.
 * 폴더명(referenceDir)과 파일 상대 경로 모두에 사용한다.
 */
export function isSafeReferencePath(p: string): boolean {
  const trimmed = p.trim();
  if (trimmed === "") return false;
  if (DRIVE_RE.test(trimmed)) return false;

  const normalized = trimmed.replaceAll("\\", "/");
  if (normalized.startsWith("/")) return false;

  return normalized
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
