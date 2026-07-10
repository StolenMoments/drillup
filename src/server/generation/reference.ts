import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isSafeReferencePath } from "@/core/reference-path";
import type { ReferenceFileDto, ReferenceFileListDto } from "@/lib/api-types";
import { prisma } from "../db";
import { ServiceError } from "../errors";

const ALLOWED_EXTENSIONS = new Set([".md", ".txt"]);
export const AIP_C01_REQUIRED_REFERENCES = [
  "common/00-exam-guide.md",
  "common/01-style-examples.md",
];

export function requiredReferenceFiles(referenceDir: string | null): string[] {
  return referenceDir === "aip-c01" ? AIP_C01_REQUIRED_REFERENCES : [];
}

export function referenceRoot(): string {
  return path.resolve(process.env.GENERATION_REFERENCE_DIR ?? "generation_reference");
}

function baseDir(referenceDir: string): string {
  if (!isSafeReferencePath(referenceDir)) {
    throw new ServiceError("VALIDATION", "잘못된 참고 자료 폴더 경로입니다", 400);
  }
  return path.join(referenceRoot(), referenceDir);
}

async function walk(
  dir: string,
  base: string,
  out: ReferenceFileDto[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, base, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const info = await stat(abs);
    out.push({
      path: path.relative(base, abs).replaceAll("\\", "/"),
      size: info.size,
    });
  }
}

export async function listReferenceFiles(
  referenceDir: string,
): Promise<ReferenceFileListDto> {
  const base = baseDir(referenceDir);
  const files: ReferenceFileDto[] = [];
  try {
    await walk(base, base, files);
  } catch {
    return { files: [], dirExists: false };
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, dirExists: true };
}

export async function resolveReferenceFiles(
  referenceDir: string | null,
  selected: string[],
): Promise<string[]> {
  const required = requiredReferenceFiles(referenceDir);
  const requested = [...new Set([...required, ...selected])];
  if (requested.length === 0) return [];
  if (!referenceDir) {
    throw new ServiceError(
      "VALIDATION",
      "이 주제에는 참고 자료 폴더가 설정되어 있지 않습니다",
      400,
    );
  }
  const base = baseDir(referenceDir);
  const resolved: string[] = [];
  if (referenceDir === "aip-c01" && !selected.some((file) => !required.includes(file))) {
    throw new ServiceError("VALIDATION", "AIP-C01은 필수 자료 외에 도메인 참고 자료를 하나 이상 선택해야 합니다", 400);
  }
  for (const rel of requested) {
    if (!isSafeReferencePath(rel)) {
      throw new ServiceError("VALIDATION", `잘못된 파일 경로입니다: ${rel}`, 400);
    }
    const abs = path.join(base, rel);
    const exists = await stat(abs)
      .then((s) => s.isFile())
      .catch(() => false);
    if (!exists) {
      throw new ServiceError(
        "REFERENCE_FILE_NOT_FOUND",
        `참고 자료 파일을 찾을 수 없습니다: ${rel} (목록을 새로고침하세요)`,
        400,
      );
    }
    resolved.push(abs);
  }
  return resolved;
}

export async function getTopicReferenceFiles(
  topicId: number,
): Promise<ReferenceFileListDto> {
  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) {
    throw new ServiceError("NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }
  if (!topic.referenceDir) {
    return { files: [], dirExists: false };
  }
  return listReferenceFiles(topic.referenceDir);
}
