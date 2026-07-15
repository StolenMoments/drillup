import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  listQuestions: vi.fn(),
}));
vi.mock("@/server/question-service", () => ({ ...serviceMocks }));

import { GET } from "./route";

describe("GET /api/questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("search와 searchIn을 파싱해 listQuestions로 전달한다", async () => {
    const payload = { items: [], page: 1, pageSize: 15, totalItems: 0, totalPages: 1 };
    serviceMocks.listQuestions.mockResolvedValue(payload);

    const response = await GET(
      new Request(
        "http://localhost/api/questions?search=특별&searchIn=body,explanation",
      ),
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "특별",
        searchIn: ["body", "explanation"],
      }),
    );
    expect(await response.json()).toEqual(payload);
  });

  it("search가 없으면 searchIn을 파싱하지 않는다", async () => {
    serviceMocks.listQuestions.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 15,
      totalItems: 0,
      totalPages: 1,
    });

    await GET(new Request("http://localhost/api/questions"));

    expect(serviceMocks.listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ search: undefined, searchIn: undefined }),
    );
  });

  it("잘못된 searchIn 값은 400을 반환한다", async () => {
    const response = await GET(
      new Request("http://localhost/api/questions?search=x&searchIn=body,bogus"),
    );

    expect(response.status).toBe(400);
    expect(serviceMocks.listQuestions).not.toHaveBeenCalled();
  });
});
