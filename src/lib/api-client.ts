import type {
  AnswerExplanationDto,
  ChoiceHardeningJobDto,
  ChoiceHardeningJobPageDto,
  ChoiceHardeningJobSummaryDto,
  ChoiceHardeningListStatusDto,
  ChoiceCountDto,
  CorrectAnswerCountDto,
  FactualReviewDto,
  GenerationEngineDto,
  GenerationJobDto,
  GenerationJobSummaryDto,
  GenerationRunLogDto,
  KeywordDto,
  KeywordRefDto,
  KeywordSuggestionDto,
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
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      credentials: "include",
    });
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      "네트워크 연결이 끊겼습니다. 연결을 확인한 뒤 다시 시도해 주세요",
      0,
    );
  }
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
      if (params.keywordId) searchParams.set("keywordId", String(params.keywordId));
      if (params.type) searchParams.set("type", params.type);
      if (params.sort) searchParams.set("sort", params.sort);
      if (params.page) searchParams.set("page", String(params.page));
      if (params.search) searchParams.set("search", params.search);
      if (params.search && params.searchIn && params.searchIn.length > 0) {
        searchParams.set("searchIn", params.searchIn.join(","));
      }
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
    explain: (id: number, engine: GenerationEngineDto) =>
      request<AnswerExplanationDto>(`/api/questions/${id}/explain`, {
        method: "POST",
        body: JSON.stringify({ engine }),
      }),
    hardenChoices: (id: number, engine: GenerationEngineDto, force = false) =>
      request<{ job: ChoiceHardeningJobDto }>(`/api/questions/${id}/harden-choices`, {
        method: "POST",
        body: JSON.stringify({ engine, ...(force ? { force: true } : {}) }),
      }),
    getHardenChoices: (id: number, jobId: number) =>
      request<{ job: ChoiceHardeningJobDto }>(
        `/api/questions/${id}/harden-choices/${jobId}`,
      ),
    applyHardenChoices: (id: number, jobId: number) =>
      request<{ ok: true }>(
        `/api/questions/${id}/harden-choices/${jobId}/apply`,
        { method: "POST" },
      ),
    dismissHardenChoices: (id: number, jobId: number) =>
      request<{ ok: true }>(
        `/api/questions/${id}/harden-choices/${jobId}/dismiss`,
        { method: "POST" },
      ),
    reviewFact: (id: number, engine: GenerationEngineDto, concern: string) =>
      request<FactualReviewDto>(`/api/questions/${id}/review-fact`, {
        method: "POST",
        body: JSON.stringify({ engine, concern }),
      }),
    addKeyword: (id: number, name: string) =>
      request<KeywordRefDto>(`/api/questions/${id}/keywords`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    removeKeyword: (id: number, keywordId: number) =>
      request<{ ok: true }>(`/api/questions/${id}/keywords/${keywordId}`, {
        method: "DELETE",
      }),
    suggestKeywords: (id: number, engine: GenerationEngineDto) =>
      request<KeywordSuggestionDto>(`/api/questions/${id}/keyword-suggestions`, {
        method: "POST",
        body: JSON.stringify({ engine }),
      }),
  },
  hardenJobs: {
    summary: () => request<ChoiceHardeningJobSummaryDto>("/api/harden-jobs"),
    page: (status: ChoiceHardeningListStatusDto, page: number) =>
      request<ChoiceHardeningJobPageDto>(
        `/api/harden-jobs?status=${status}&page=${page}`,
      ),
    pendingCount: () =>
      request<{ count: number }>("/api/harden-jobs/pending-count"),
  },
  keywords: {
    list: (topicId?: number) =>
      request<{ keywords: KeywordDto[] }>(
        `/api/keywords${topicId ? `?topicId=${topicId}` : ""}`,
      ),
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
      correctAnswerCount: CorrectAnswerCountDto;
      choiceCount: ChoiceCountDto;
      referenceFiles: string[];
      sourceQuestionIds?: number[];
    }) =>
      request<{ job: GenerationJobDto }>("/api/generate", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    get: (id: number) =>
      request<{ job: GenerationJobDto }>(`/api/generate/${id}`),
    diagnostics: (id: number) =>
      request<{ runs: GenerationRunLogDto[] }>(`/api/generate/${id}/diagnostics`),
    list: () =>
      request<{ jobs: GenerationJobSummaryDto[] }>("/api/generate"),
    approve: (id: number, indices: number[]) =>
      request<{ savedCount: number; job: GenerationJobDto }>(
        `/api/generate/${id}/approve`,
        { method: "POST", body: JSON.stringify({ indices }) },
      ),
    remove: (id: number) =>
      request<{ ok: true }>(`/api/generate/${id}`, { method: "DELETE" }),
    keywordTag: (input: { topicId: number; engine: GenerationEngineDto }) =>
      request<{ job: GenerationJobDto }>("/api/generate/keyword-tag", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    reviseItem: (
      id: number,
      index: number,
      input: { engine: GenerationEngineDto; instructions?: string },
    ) =>
      request<{ job: GenerationJobDto }>(`/api/generate/${id}/items/${index}/revision`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    setRevisionUsage: (id: number, index: number, useRevision: boolean) =>
      request<{ job: GenerationJobDto }>(`/api/generate/${id}/items/${index}/revision`, {
        method: "PATCH",
        body: JSON.stringify({ useRevision }),
      }),
  },
  study: {
    getQuestion: (id: number) =>
      request<StudyQuestionDto>(`/api/study/questions/${id}`),
    queue: (mode: "srs" | "practice" | "unlearned", topicId?: number, keywordId?: number) => {
      const searchParams = new URLSearchParams({ mode });
      if (topicId) searchParams.set("topicId", String(topicId));
      if (keywordId) searchParams.set("keywordId", String(keywordId));
      return request<StudyQuestionDto[]>(`/api/study/queue?${searchParams}`);
    },
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
