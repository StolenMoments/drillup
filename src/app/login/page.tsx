"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setPending(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError("비밀번호가 올바르지 않습니다");
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-16 max-w-xs space-y-4">
      <h1 className="text-center text-xl font-bold">drillup 로그인</h1>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="비밀번호"
        autoFocus
        className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending || password.length === 0}
        className="w-full rounded bg-sky-600 py-2 font-semibold disabled:opacity-50"
      >
        로그인
      </button>
    </form>
  );
}
