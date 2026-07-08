"use client";

import { api } from "@/lib/api-client";

export default function LogoutButton() {
  async function logout() {
    await api.auth.logout();
    window.location.href = "/login";
  }

  return (
    <button onClick={logout} className="text-slate-500 hover:text-slate-300">
      로그아웃
    </button>
  );
}
