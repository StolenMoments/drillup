import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  submitReview: vi.fn(),
}));

vi.mock("@/server/study-service", () => ({
  submitReview: mocks.submitReview,
}));

import { POST } from "./route";

describe("POST /api/reviews", () => {
  it("accepts the last option of a six-choice MCQ", async () => {
    mocks.submitReview.mockResolvedValue({ isCorrect: true });

    const response = await POST(
      new Request("http://localhost/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          questionId: 1,
          mode: "PRACTICE",
          answer: { type: "MCQ", selected_indices: [5] },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.submitReview).toHaveBeenCalledWith({
      questionId: 1,
      mode: "PRACTICE",
      answer: { type: "MCQ", selected_indices: [5] },
    });
  });
});
