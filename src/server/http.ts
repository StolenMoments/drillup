import { NextResponse } from "next/server";
import type { z } from "zod";
import { ServiceError } from "./errors";

export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function jsonError(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function handleApiError(e: unknown): NextResponse {
  if (e instanceof ServiceError) return jsonError(e.code, e.message, e.status);
  console.error(e);
  return jsonError("INTERNAL", "서버 오류가 발생했습니다", 500);
}

export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ServiceError("BAD_REQUEST", "요청 본문이 올바른 JSON이 아닙니다", 400);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ServiceError("VALIDATION", detail, 400);
  }
  return result.data;
}
