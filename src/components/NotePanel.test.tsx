// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notesApiMock = vi.hoisted(() => ({
  applyTidy: vi.fn(),
  dismissTidy: vi.fn(),
  extract: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  tidy: vi.fn(),
  tidyJob: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
  api: { notes: notesApiMock },
}));

import NotePanel from "./NotePanel";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function note(
  content = "",
  activeTidyJob: {
    id: number;
    status: "RUNNING" | "SUCCEEDED" | "FAILED";
  } | null = null,
) {
  return {
    content,
    updatedAt: content ? "2026-07-20T00:00:00.000Z" : null,
    activeTidyJob,
  };
}

function tidyJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 17,
    topicId: 3,
    sourceHash: "a".repeat(64),
    engine: "CLAUDE" as const,
    status: "SUCCEEDED" as const,
    preview: "## 정리 초안\n\n- 핵심",
    errorMessage: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    startedAt: "2026-07-20T00:00:01.000Z",
    finishedAt: "2026-07-20T00:00:03.000Z",
    appliedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

async function renderPanel() {
  await act(async () => {
    render(<NotePanel topicId={3} questionId={42} onClose={vi.fn()} />);
  });
}

describe("NotePanel", () => {
  beforeEach(() => {
    for (const mock of Object.values(notesApiMock)) mock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("빈 노트를 불러오면 첫 편집 방법을 안내한다", async () => {
    notesApiMock.get.mockResolvedValue(note());

    await renderPanel();

    expect(screen.getByRole("dialog", { name: "주제 노트" })).toBeVisible();
    expect(
      screen.getByText("아직 노트가 없습니다. 편집을 눌러 첫 내용을 적어 보세요."),
    ).toBeVisible();
  });

  it("마크다운을 편집해 저장하고 성공 피드백과 렌더링을 보여준다", async () => {
    notesApiMock.get.mockResolvedValue(note());
    notesApiMock.save.mockResolvedValue(note("# 핵심\n\n- 항목"));
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    fireEvent.change(screen.getByRole("textbox", { name: "노트 내용" }), {
      target: { value: "# 핵심\n\n- 항목" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
    });

    expect(notesApiMock.save).toHaveBeenCalledWith(3, "# 핵심\n\n- 항목");
    expect(screen.getByText("저장했습니다 ✅")).toBeVisible();
    expect(screen.getByRole("heading", { name: "핵심" })).toBeVisible();
    expect(screen.getByText("항목")).toBeVisible();
  });

  it("저장 실패 시 오류와 작성 중인 초안을 유지한다", async () => {
    notesApiMock.get.mockResolvedValue(note("기존 내용"));
    notesApiMock.save.mockRejectedValue(new Error("저장 서버 오류"));
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    const textarea = screen.getByRole("textbox", { name: "노트 내용" });
    fireEvent.change(textarea, { target: { value: "지키고 싶은 초안" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("저장 서버 오류");
    expect(textarea).toHaveValue("지키고 싶은 초안");
  });

  it("완료된 활성 AI 정리 작업을 다시 열어 초안 비교를 이어간다", async () => {
    notesApiMock.get.mockResolvedValue(
      note("## 현재 노트\n\n- 원본", { id: 17, status: "SUCCEEDED" }),
    );
    notesApiMock.tidyJob.mockResolvedValue({ job: tidyJob() });

    await renderPanel();

    expect(notesApiMock.tidyJob).toHaveBeenCalledWith(17);
    expect(screen.getByRole("status")).toHaveTextContent("정리 초안 도착");
    expect(screen.getByRole("heading", { name: "정리 초안" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "현재 노트 보기" }));
    expect(screen.getByRole("heading", { name: "현재 노트" })).toBeVisible();
  });

  it("진행 중인 polling을 겹치지 않고 응답 완료 후 다음 조회를 예약한다", async () => {
    vi.useFakeTimers();
    const pendingPoll = deferred<{ job: ReturnType<typeof tidyJob> }>();
    notesApiMock.get.mockResolvedValue(
      note("현재 노트", { id: 17, status: "RUNNING" }),
    );
    notesApiMock.tidyJob
      .mockResolvedValueOnce({
        job: tidyJob({ status: "RUNNING", preview: null }),
      })
      .mockImplementationOnce(() => pendingPoll.promise)
      .mockResolvedValue({
        job: tidyJob({ status: "RUNNING", preview: null }),
      });
    await renderPanel();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(notesApiMock.tidyJob).toHaveBeenCalledTimes(2);

    await act(async () => {
      pendingPoll.resolve({
        job: tidyJob({ status: "RUNNING", preview: null }),
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(notesApiMock.tidyJob).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(notesApiMock.tidyJob).toHaveBeenCalledTimes(3);
  });

  it("이전 topic의 늦은 polling 응답이 새 topic에서 폐기한 상태를 되살리지 않는다", async () => {
    vi.useFakeTimers();
    const stalePoll = deferred<{ job: ReturnType<typeof tidyJob> }>();
    notesApiMock.get.mockImplementation((topicId: number) =>
      Promise.resolve(
        topicId === 3
          ? note("이전 노트", { id: 17, status: "RUNNING" })
          : note("새 노트", { id: 27, status: "SUCCEEDED" }),
      ),
    );
    let oldJobReads = 0;
    notesApiMock.tidyJob.mockImplementation((jobId: number) => {
      if (jobId === 27) {
        return Promise.resolve({
          job: tidyJob({ id: 27, topicId: 4, preview: "새 정리 초안" }),
        });
      }
      oldJobReads += 1;
      if (oldJobReads === 1) {
        return Promise.resolve({
          job: tidyJob({ status: "RUNNING", preview: null }),
        });
      }
      return stalePoll.promise;
    });
    notesApiMock.dismissTidy.mockResolvedValue({ ok: true });

    let rerender!: ReturnType<typeof render>["rerender"];
    await act(async () => {
      ({ rerender } = render(
        <NotePanel topicId={3} questionId={42} onClose={vi.fn()} />,
      ));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      rerender(<NotePanel topicId={4} questionId={43} onClose={vi.fn()} />);
    });

    expect(screen.getByRole("status")).toHaveTextContent("정리 초안 도착");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "폐기" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("폐기했습니다");

    await act(async () => {
      stalePoll.resolve({
        job: tidyJob({ status: "RUNNING", preview: null }),
      });
      await Promise.resolve();
    });

    expect(screen.queryByText("🤖 AI 정리 중...")).not.toBeInTheDocument();
    expect(screen.getByText("새 노트")).toBeVisible();
  });

  it("topic 변경 시 이전 UI와 draft를 즉시 지우고 새 topic에 새 draft만 저장한다", async () => {
    const nextTopic = deferred<ReturnType<typeof note>>();
    notesApiMock.get.mockImplementation((topicId: number) =>
      topicId === 3 ? Promise.resolve(note("이전 노트")) : nextTopic.promise,
    );
    notesApiMock.save.mockImplementation((topicId: number, content: string) =>
      Promise.resolve(note(content)),
    );

    let rerender!: ReturnType<typeof render>["rerender"];
    await act(async () => {
      ({ rerender } = render(
        <NotePanel topicId={3} questionId={42} onClose={vi.fn()} />,
      ));
    });
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    fireEvent.change(screen.getByRole("textbox", { name: "노트 내용" }), {
      target: { value: "이전 topic draft" },
    });

    await act(async () => {
      rerender(<NotePanel topicId={4} questionId={43} onClose={vi.fn()} />);
    });
    expect(screen.queryByDisplayValue("이전 topic draft")).not.toBeInTheDocument();
    expect(screen.queryByText("이전 노트")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");

    await act(async () => {
      nextTopic.resolve(note("새 topic 노트"));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    const textarea = screen.getByRole("textbox", { name: "노트 내용" });
    expect(textarea).toHaveValue("새 topic 노트");
    fireEvent.change(textarea, { target: { value: "새 topic draft" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
    });

    expect(notesApiMock.save).toHaveBeenCalledTimes(1);
    expect(notesApiMock.save).toHaveBeenCalledWith(4, "새 topic draft");
  });

  it("Tab과 Shift+Tab이 dialog의 첫 요소와 마지막 요소 사이를 순환한다", async () => {
    notesApiMock.get.mockResolvedValue(note("노트 내용"));
    await renderPanel();
    const closeButton = screen.getByRole("button", { name: "닫기" });
    const extractButton = screen.getByRole("button", { name: "AI 추출" });

    expect(closeButton).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(extractButton).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(closeButton).toHaveFocus();
  });

  it("저장 중에는 textarea를 잠가 요청 이후 입력 유실을 막는다", async () => {
    const pendingSave = deferred<ReturnType<typeof note>>();
    notesApiMock.get.mockResolvedValue(note("기존 내용"));
    notesApiMock.save.mockReturnValue(pendingSave.promise);
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    fireEvent.change(screen.getByRole("textbox", { name: "노트 내용" }), {
      target: { value: "저장할 내용" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(screen.getByRole("textbox", { name: "노트 내용" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "저장 중..." })).toBeDisabled();

    await act(async () => {
      pendingSave.resolve(note("저장할 내용"));
      await Promise.resolve();
    });
  });

  it("AI 실패는 alert로, 도착한 초안은 polite status로 알린다", async () => {
    notesApiMock.get.mockResolvedValue(
      note("현재 노트", { id: 17, status: "RUNNING" }),
    );
    notesApiMock.tidyJob.mockResolvedValue({
      job: tidyJob({
        status: "FAILED",
        preview: null,
        errorMessage: "엔진 연결 실패",
      }),
    });
    await renderPanel();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "정리 실패 ❌ 엔진 연결 실패",
    );

    cleanup();
    notesApiMock.get.mockResolvedValue(
      note("현재 노트", { id: 27, status: "SUCCEEDED" }),
    );
    notesApiMock.tidyJob.mockResolvedValue({
      job: tidyJob({ id: 27, preview: "도착한 초안" }),
    });
    await renderPanel();

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveTextContent("정리 초안 도착");
  });

  it("AI 추출 결과를 미리보기로 보여주고 노트 끝에 덧붙여 저장한다", async () => {
    notesApiMock.get.mockResolvedValue(note("## 기존\n\n- 이미 아는 것"));
    notesApiMock.extract.mockResolvedValue({
      engine: "CLAUDE",
      extracted: "- S3는 객체 스토리지",
    });
    notesApiMock.save.mockImplementation((_topicId: number, content: string) =>
      Promise.resolve(note(content)),
    );
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "AI 추출" }));
    });

    expect(notesApiMock.extract).toHaveBeenCalledWith(42, "CLAUDE");
    expect(screen.getByText("S3는 객체 스토리지")).toBeVisible();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "노트에 추가" }));
    });

    expect(notesApiMock.save).toHaveBeenCalledWith(
      3,
      "## 기존\n\n- 이미 아는 것\n\n- S3는 객체 스토리지",
    );
    expect(screen.getByText("노트에 추가했습니다 ✅")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "노트에 추가" }),
    ).not.toBeInTheDocument();
  });

  it("빈 노트에서는 추출 결과를 그대로 저장한다", async () => {
    notesApiMock.get.mockResolvedValue(note());
    notesApiMock.extract.mockResolvedValue({
      engine: "CLAUDE",
      extracted: "- 첫 항목",
    });
    notesApiMock.save.mockImplementation((_topicId: number, content: string) =>
      Promise.resolve(note(content)),
    );
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "AI 추출" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "노트에 추가" }));
    });

    expect(notesApiMock.save).toHaveBeenCalledWith(3, "- 첫 항목");
  });

  it("추출할 새 내용이 없으면 안내만 보여준다", async () => {
    notesApiMock.get.mockResolvedValue(note("## 기존\n\n- 이미 아는 것"));
    notesApiMock.extract.mockResolvedValue({
      engine: "CLAUDE",
      extracted: "",
    });
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "AI 추출" }));
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "추가할 새 내용이 없습니다",
    );
    expect(
      screen.queryByRole("button", { name: "노트에 추가" }),
    ).not.toBeInTheDocument();
  });

  it("추출 저장에 실패하면 오류를 알리고 초안을 유지한다", async () => {
    notesApiMock.get.mockResolvedValue(note("기존 내용"));
    notesApiMock.extract.mockResolvedValue({
      engine: "CLAUDE",
      extracted: "- 지켜야 할 초안",
    });
    notesApiMock.save.mockRejectedValue(new Error("저장 서버 오류"));
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "AI 추출" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "노트에 추가" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("저장 서버 오류");
    expect(screen.getByText("지켜야 할 초안")).toBeVisible();
    expect(screen.getByRole("button", { name: "노트에 추가" })).toBeEnabled();
  });
});
