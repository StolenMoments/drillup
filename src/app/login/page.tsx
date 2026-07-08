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
    <form onSubmit={submit} className="surface surface-pad mx-auto mt-16 max-w-sm space-y-5">
      <div className="text-center">
        <h1 className="page-title">drillup 로그인</h1>
        <p className="page-subtitle mx-auto">개인 문제은행에 들어가 학습을 이어갑니다.</p>
      </div>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="비밀번호"
        autoFocus
        className="field"
      />
      {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
      <button
        type="submit"
        disabled={pending || password.length === 0}
        className="btn btn-primary w-full"
      >
        {pending ? "확인 중..." : "로그인"}
      </button>
    </form>
  );
}
