import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
} from "@/lib/session";
import { handleApiError, jsonError, parseBody } from "@/server/http";

const bodySchema = z.object({ password: z.string() });

export async function POST(req: Request) {
  try {
    const { password } = await parseBody(req, bodySchema);
    if (password !== process.env.APP_PASSWORD) {
      return jsonError("INVALID_PASSWORD", "비밀번호가 올바르지 않습니다", 401);
    }
    const token = await createSessionToken(process.env.SESSION_SECRET!);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_TTL_MS / 1000,
      path: "/",
    });
    return res;
  } catch (e) {
    return handleApiError(e);
  }
}
