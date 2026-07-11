import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
} from "@/lib/session";
import {
  checkLockout,
  recordFailure,
  recordSuccess,
} from "@/server/login-throttle";
import { handleApiError, jsonError, parseBody } from "@/server/http";

const bodySchema = z.object({ password: z.string() });

export async function POST(req: Request) {
  try {
    const lockout = checkLockout();
    if (lockout.locked) {
      const retryAfterSec = Math.ceil(lockout.retryAfterMs / 1000);
      const res = jsonError(
        "TOO_MANY_ATTEMPTS",
        "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요 🔒",
        429,
      );
      res.headers.set("Retry-After", String(retryAfterSec));
      return res;
    }

    const { password } = await parseBody(req, bodySchema);
    if (password !== process.env.APP_PASSWORD) {
      recordFailure();
      return jsonError("INVALID_PASSWORD", "비밀번호가 올바르지 않습니다", 401);
    }

    recordSuccess();
    const token = await createSessionToken(process.env.SESSION_SECRET!);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_MS / 1000,
      path: "/",
    });
    return res;
  } catch (e) {
    return handleApiError(e);
  }
}
