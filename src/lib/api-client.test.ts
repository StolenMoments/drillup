import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api-client";

describe("api.questions.list", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ items: [], page: 1, pageSize: 15, totalItems: 0, totalPages: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search와 searchIn을 쿼리스트링으로 직렬화한다", async () => {
    await api.questions.list({ search: "특별", searchIn: ["body", "keyword"] });

    const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const query = new URL(calledUrl, "http://localhost").searchParams;
    expect(query.get("search")).toBe("특별");
    expect(query.get("searchIn")).toBe("body,keyword");
  });

  it("search가 없으면 search/searchIn 쿼리를 붙이지 않는다", async () => {
    await api.questions.list({ topicId: 1 });

    const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("search=");
    expect(calledUrl).not.toContain("searchIn=");
  });
});
