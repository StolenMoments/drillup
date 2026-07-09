import type {
  GenerationEngineDto,
  GenerationJobDto,
  GenerationJobSummaryDto,
  QuestionDetailDto,
  QuestionListPageDto,
  QuestionListParams,
  ReferenceFileListDto,
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
    update: (
      id: number,
      input: { name?: string; description?: string; referenceDir?: string | null },
    ) =>
      request<TopicDto>(`/api/topics/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (id: number) =>
      request<{ ok: true }>(`/api/topics/${id}`, { method: "DELETE" }),
    referenceFiles: (id: number) =>
      request<ReferenceFileListDto>(`/api/topics/${id}/reference-files`),
  },
  questions: {
    list: (params: QuestionListParams = {}) => {
      const searchParams = new URLSearchParams();
      if (params.topicId) searchParams.set("topicId", String(params.topicId));
      if (params.type) searchParams.set("type", params.type);
      if (params.sort) searchParams.set("sort", params.sort);
      if (params.page) searchParams.set("page", String(params.page));
      const query = searchParams.toString();
      return request<QuestionListPageDto>(
        `/api/questions${query ? `?${query}` : ""}`,
      );
    },
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
  generate: {
    create: (input: {
      topicId: number;
      engine: GenerationEngineDto;
      verifyEngine: GenerationEngineDto;
      instructions: string;
      referenceFiles: string[];
    }) =>
      request<{ job: GenerationJobDto }>("/api/generate", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    get: (id: number) =>
      request<{ job: GenerationJobDto }>(`/api/generate/${id}`),
    list: () =>
      request<{ jobs: GenerationJobSummaryDto[] }>("/api/generate"),
    approve: (id: number, indices: number[]) =>
      request<{ savedCount: number; job: GenerationJobDto }>(
        `/api/generate/${id}/approve`,
        { method: "POST", body: JSON.stringify({ indices }) },
      ),
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
