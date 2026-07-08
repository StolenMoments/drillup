"use client";

import { api } from "@/lib/api-client";

export default function LogoutButton() {
  async function logout() {
    await api.auth.logout();
    window.location.href = "/login";
  }

  return (
    <button
      onClick={logout}
      className="rounded-lg px-3 py-2 text-[color:var(--subtle)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text)]"
    >
      로그아웃
    </button>
  );
}
