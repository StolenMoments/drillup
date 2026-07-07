import type {
  QuestionDetailDto,
  QuestionListItemDto,
  ReviewResultDto,
  StatsOverviewDto,
  StudyQuestionDto,
  SubmitReviewInput,
  TopicDto,
} from "./api-types";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  const body: unknown = await res.json().catch(() => null);

  if (
    res.status === 401 &&
    typeof window !== "undefined" &&
    !window.location.pathname.startsWith("/login")
  ) {
    window.location.href = "/login";
  }

  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)
      ?.error;
    throw new ApiError(
      err?.code ?? "UNKNOWN",
      err?.message ?? `요청 실패 (HTTP ${res.status})`,
      res.status,
    );
  }

  return body as T;
}

export const api = {
  auth: {
    login: (password: string) =>
      request<{ ok: true }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  },
  topics: {
    list: () => request<TopicDto[]>("/api/topics"),
    create: (input: { name: string; description?: string }) =>
      request<TopicDto>("/api/topics", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (id: number, input: { name?: string; description?: string }) =>
      request<TopicDto>(`/api/topics/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (id: number) =>
      request<{ ok: true }>(`/api/topics/${id}`, { method: "DELETE" }),
  },
  questions: {
    list: (topicId?: number) =>
      request<QuestionListItemDto[]>(
        `/api/questions${topicId ? `?topicId=${topicId}` : ""}`,
      ),
    get: (id: number) => request<QuestionDetailDto>(`/api/questions/${id}`),
    update: (
      id: number,
      input: { payload: unknown; explanation: string | null },
    ) =>
      request<QuestionDetailDto>(`/api/questions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (id: number) =>
      request<{ ok: true }>(`/api/questions/${id}`, { method: "DELETE" }),
  },
  import: {
    submit: (topicId: number, questions: unknown[]) =>
      request<{ savedCount: number }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ topicId, questions }),
      }),
  },
  study: {
    queue: (mode: "srs" | "practice", topicId?: number) =>
      request<StudyQuestionDto[]>(
        `/api/study/queue?mode=${mode}${topicId ? `&topicId=${topicId}` : ""}`,
      ),
    submitReview: (input: SubmitReviewInput) =>
      request<ReviewResultDto>("/api/reviews", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  },
  stats: {
    overview: () => request<StatsOverviewDto>("/api/stats/overview"),
  },
};
