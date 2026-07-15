"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type {
  GenerationEngineDto,
  KeywordDto,
  QuestionListPageDto,
  QuestionListSortDto,
  QuestionSearchFieldDto,
  QuestionTypeDto,
  TopicDto,
} from "@/lib/api-types";

const emptyPage: QuestionListPageDto = {
  items: [],
  page: 1,
  pageSize: 15,
  totalItems: 0,
  totalPages: 1,
};

function visibleRange(pageData: QuestionListPageDto): string {
  if (pageData.totalItems === 0) return "0 / 0";
  const start = (pageData.page - 1) * pageData.pageSize + 1;
  const end = Math.min(pageData.page * pageData.pageSize, pageData.totalItems);
  return `${start}-${end} / ${pageData.totalItems}`;
}

function accuracyText(question: QuestionListPageDto["items"][number]): string {
  if (question.attempts === 0) return "미학습";
  return `${Math.round((question.correctCount / question.attempts) * 100)}% (${question.correctCount}/${question.attempts})`;
}

export default function QuestionsPage() {
  const router = useRouter();
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [keywordId, setKeywordId] = useState<number | "">("");
  const [keywords, setKeywords] = useState<KeywordDto[]>([]);
  const [tagEngine, setTagEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [tagging, setTagging] = useState(false);
  const [typeFilter, setTypeFilter] = useState<QuestionTypeDto | "">("");
  const [sort, setSort] = useState<QuestionListSortDto>("latest");
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchFieldsDraft, setSearchFieldsDraft] = useState<
    QuestionSearchFieldDto[]
  >(["body"]);
  const [committedSearch, setCommittedSearch] = useState("");
  const [committedSearchFields, setCommittedSearchFields] = useState<
    QuestionSearchFieldDto[]
  >(["body"]);
  const [pageData, setPageData] = useState<QuestionListPageDto>(emptyPage);
  const [message, setMessage] = useState("");
  const requestIdRef = useRef(0);

  const reload = useCallback(
    async (options: {
      selectedTopicId: number | "";
      selectedKeywordId: number | "";
      selectedType: QuestionTypeDto | "";
      selectedSort: QuestionListSortDto;
      selectedPage: number;
      selectedSearch: string;
      selectedSearchFields: QuestionSearchFieldDto[];
    }) => {
      const requestId = ++requestIdRef.current;
      try {
        const [topicList, keywordList, questionPage] = await Promise.all([
          api.topics.list(),
          api.keywords.list(),
          api.questions.list({
            topicId:
              options.selectedTopicId === ""
                ? undefined
                : options.selectedTopicId,
            keywordId:
              options.selectedKeywordId === ""
                ? undefined
                : options.selectedKeywordId,
            type: options.selectedType === "" ? undefined : options.selectedType,
            sort: options.selectedSort,
            page: options.selectedPage,
            search: options.selectedSearch || undefined,
            searchIn: options.selectedSearch
              ? options.selectedSearchFields
              : undefined,
          }),
        ]);
        if (requestId !== requestIdRef.current) return;
        setTopics(topicList);
        setKeywords(keywordList.keywords);
        setPageData(questionPage);
        if (questionPage.page !== options.selectedPage) {
          setPage(questionPage.page);
        }
        setMessage("");
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        setMessage(
          error instanceof Error ? error.message : "목록을 불러오지 못했습니다",
        );
      }
    },
    [],
  );

  useEffect(() => {
    void Promise.resolve().then(() =>
      reload({
        selectedTopicId: topicId,
        selectedKeywordId: keywordId,
        selectedType: typeFilter,
        selectedSort: sort,
        selectedPage: page,
        selectedSearch: committedSearch,
        selectedSearchFields: committedSearchFields,
      }),
    );
  }, [
    topicId,
    keywordId,
    typeFilter,
    sort,
    page,
    committedSearch,
    committedSearchFields,
    reload,
  ]);

  function resetPage() {
    setPage(1);
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCommittedSearch(searchDraft.trim());
    setCommittedSearchFields(searchFieldsDraft);
    resetPage();
  }

  function toggleSearchField(field: QuestionSearchFieldDto) {
    setSearchFieldsDraft((current) =>
      current.includes(field)
        ? current.filter((f) => f !== field)
        : [...current, field],
    );
  }

  async function removeQuestion(id: number) {
    if (!window.confirm("이 문제를 삭제할까요?")) return;
    await api.questions.remove(id);

    if (pageData.items.length === 1 && pageData.page > 1) {
      setPage(pageData.page - 1);
      return;
    }

    await reload({
      selectedTopicId: topicId,
      selectedKeywordId: keywordId,
      selectedType: typeFilter,
      selectedSort: sort,
      selectedPage: pageData.page,
      selectedSearch: committedSearch,
      selectedSearchFields: committedSearchFields,
    });
  }

  async function renameTopic() {
    if (topicId === "") return;
    const current = topics.find((topic) => topic.id === topicId);
    const name = window.prompt("새 주제 이름", current?.name ?? "");
    if (!name?.trim()) return;

    try {
      await api.topics.update(topicId, { name: name.trim() });
      await reload({
        selectedTopicId: topicId,
        selectedKeywordId: keywordId,
        selectedType: typeFilter,
        selectedSort: sort,
        selectedPage: page,
        selectedSearch: committedSearch,
        selectedSearchFields: committedSearchFields,
      });
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이름 변경 실패");
    }
  }

  async function editReferenceDir() {
    if (topicId === "") return;
    const current = topics.find((topic) => topic.id === topicId);
    const dir = window.prompt(
      "참고 자료 폴더 (generation_reference/ 기준 상대 경로, 비우면 해제)",
      current?.referenceDir ?? "",
    );
    if (dir === null) return;

    try {
      await api.topics.update(topicId, {
        referenceDir: dir.trim() === "" ? null : dir.trim(),
      });
      await reload({
        selectedTopicId: topicId,
        selectedKeywordId: keywordId,
        selectedType: typeFilter,
        selectedSort: sort,
        selectedPage: page,
        selectedSearch: committedSearch,
        selectedSearchFields: committedSearchFields,
      });
      setMessage("✅ 참고 자료 폴더를 설정했습니다");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "참고 자료 폴더 설정 실패",
      );
    }
  }

  async function removeTopic() {
    if (topicId === "") return;
    if (
      !window.confirm(
        "주제와 포함된 문제가 모두 삭제됩니다. 계속할까요?",
      )
    ) {
      return;
    }
    await api.topics.remove(topicId);
    setTopicId("");
    resetPage();
  }

  async function runKeywordTag() {
    if (topicId === "" || tagging) return;
    setTagging(true);
    try {
      const { job } = await api.generate.keywordTag({ topicId, engine: tagEngine });
      router.push(`/generate/${job.id}`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "키워드 부여 요청에 실패했습니다",
      );
      setTagging(false);
    }
  }

  const questions = pageData.items;

  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">문제 목록</h1>
          <p className="page-subtitle">
            주제별로 문제를 묶고, 필요한 경우 원본 payload와 해설을 수정합니다.
          </p>
        </div>
      </div>

      <div className="surface surface-pad flex flex-wrap items-center gap-2">
        <select
          value={topicId}
          onChange={(event) => {
            setTopicId(event.target.value ? Number(event.target.value) : "");
            resetPage();
          }}
          className="field w-auto min-w-52"
        >
          <option value="">전체 주제</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name} ({topic.questionCount})
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(event) => {
            setTypeFilter(event.target.value as QuestionTypeDto | "");
            resetPage();
          }}
          className="field w-auto min-w-36"
        >
          <option value="">전체 유형</option>
          <option value="MCQ">객관식</option>
          <option value="CLOZE">빈칸</option>
        </select>
        <select
          value={keywordId}
          onChange={(event) => {
            setKeywordId(event.target.value ? Number(event.target.value) : "");
            resetPage();
          }}
          className="field w-auto min-w-44"
        >
          <option value="">전체 키워드</option>
          {keywords.map((keyword) => (
            <option key={keyword.id} value={keyword.id}>
              {keyword.name} ({keyword.questionCount})
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as QuestionListSortDto);
            resetPage();
          }}
          className="field w-auto min-w-44"
        >
          <option value="latest">최신순</option>
          <option value="accuracyAsc">정답률 낮은순</option>
          <option value="accuracyDesc">정답률 높은순</option>
        </select>
        <form
          onSubmit={submitSearch}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            type="text"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="검색어"
            className="field w-auto min-w-48"
          />
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={searchFieldsDraft.includes("body")}
              onChange={() => toggleSearchField("body")}
            />
            본문
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={searchFieldsDraft.includes("choices")}
              onChange={() => toggleSearchField("choices")}
            />
            선택지
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={searchFieldsDraft.includes("explanation")}
              onChange={() => toggleSearchField("explanation")}
            />
            해설
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={searchFieldsDraft.includes("keyword")}
              onChange={() => toggleSearchField("keyword")}
            />
            키워드
          </label>
          <button
            type="submit"
            className="btn btn-secondary min-h-9 px-3 text-sm"
          >
            검색
          </button>
        </form>
        {topicId !== "" && (
          <>
            <button
              onClick={renameTopic}
              className="btn btn-secondary min-h-9 px-3 text-sm"
            >
              주제 이름 변경
            </button>
            <button
              onClick={editReferenceDir}
              className="btn btn-secondary min-h-9 px-3 text-sm"
            >
              참고 자료 폴더
            </button>
            <button
              onClick={removeTopic}
              className="btn btn-danger min-h-9 px-3 text-sm"
            >
              주제 삭제
            </button>
            <select
              value={tagEngine}
              onChange={(event) =>
                setTagEngine(event.target.value as GenerationEngineDto)
              }
              className="field w-auto min-w-32"
            >
              <option value="CLAUDE">claude code</option>
              <option value="CODEX">codex</option>
              <option value="ANTIGRAVITY">antigravity</option>
            </select>
            <button
              type="button"
              onClick={runKeywordTag}
              disabled={tagging}
              className="btn btn-secondary min-h-9 px-3 text-sm"
            >
              {tagging ? "요청 중..." : "🏷️ 키워드 일괄 부여"}
            </button>
          </>
        )}
      </div>

      {message && <p className="text-sm text-[color:var(--danger)]">{message}</p>}

      {questions.length === 0 ? (
        <p className="empty-state">문제가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {questions.map((question) => (
            <li
              key={question.id}
              className="list-row flex items-center gap-3 p-3"
            >
              <span className="chip">
                {question.type === "MCQ" ? "객관식" : "빈칸"}
              </span>
              <span className="shrink-0 text-sm text-[color:var(--subtle)]">
                #{question.id}
              </span>
              <Link
                href={`/questions/${question.id}`}
                className="min-w-0 flex-1 truncate font-medium text-[color:var(--text)] hover:text-[color:var(--brand)] hover:underline focus-visible:rounded-sm"
              >
                {question.preview}
              </Link>
              <span className="shrink-0 text-sm text-[color:var(--muted)]">
                {accuracyText(question)}
              </span>
              <Link
                href={`/questions/${question.id}/edit`}
                className="shrink-0 text-sm font-semibold text-[color:var(--brand)]"
              >
                수정
              </Link>
              <button
                onClick={() => removeQuestion(question.id)}
                className="shrink-0 text-sm font-semibold text-[color:var(--danger)]"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="pagination-bar">
        <button
          type="button"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={pageData.page <= 1}
          className="btn btn-secondary min-h-9 px-3 text-sm"
        >
          이전
        </button>
        <span className="pagination-summary">
          {pageData.page} / {pageData.totalPages} 페이지
        </span>
        <span className="pagination-summary">{visibleRange(pageData)}</span>
        <button
          type="button"
          onClick={() =>
            setPage((current) => Math.min(pageData.totalPages, current + 1))
          }
          disabled={pageData.page >= pageData.totalPages}
          className="btn btn-secondary min-h-9 px-3 text-sm"
        >
          다음
        </button>
      </div>
    </div>
  );
}
