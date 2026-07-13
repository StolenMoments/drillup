import QuestionPreview from "@/components/QuestionPreview";
import type { ImportQuestion } from "@/core/import-schema";
import { mcqAnswerIndices } from "@/core/types";

interface QuestionComparisonProps {
  original: ImportQuestion;
  revised: ImportQuestion;
  revealed: boolean;
}

function hasQuestionChanges(original: ImportQuestion, revised: ImportQuestion): boolean {
  if (original.type !== revised.type) return true;

  if (original.type === "mcq" && revised.type === "mcq") {
    return (
      original.question !== revised.question ||
      JSON.stringify(original.choices) !== JSON.stringify(revised.choices) ||
      JSON.stringify(mcqAnswerIndices(original)) !== JSON.stringify(mcqAnswerIndices(revised)) ||
      JSON.stringify(original.choice_explanations ?? []) !==
        JSON.stringify(revised.choice_explanations ?? [])
    );
  }

  if (original.type === "cloze" && revised.type === "cloze") {
    return (
      original.text !== revised.text ||
      JSON.stringify(original.blanks) !== JSON.stringify(revised.blanks) ||
      JSON.stringify(original.distractors) !== JSON.stringify(revised.distractors)
    );
  }

  return false;
}

export default function QuestionComparison({
  original,
  revised,
  revealed,
}: QuestionComparisonProps) {
  const typeChanged = original.type !== revised.type;
  const changed = hasQuestionChanges(original, revised);

  return (
    <section className="diff-comparison" aria-label="원본과 수정본 비교">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="section-title">원본 ↔ 수정본 비교</h3>
          <p className="muted mt-1 text-xs">원본과 AI가 제안한 수정본의 변경 사항입니다.</p>
        </div>
        <div className="diff-legend" aria-label="변경 범례">
          <span className="diff-legend-item">
            <del className="diff-deleted">원본 삭제</del>
          </span>
          <span className="diff-legend-item">
            <ins className="diff-added">수정본 추가</ins>
          </span>
        </div>
      </div>

      {typeChanged && (
        <p className="diff-warning" role="alert">
          ⚠️ 문제 유형이 달라 변경 강조를 적용할 수 없습니다. 각 버전을 일반 미리보기로 표시합니다.
        </p>
      )}
      {!typeChanged && !changed && <p className="diff-no-change">변경 없음</p>}

      <div className="diff-comparison-grid">
        <section className="diff-panel">
          <h4 className="diff-panel-title">원본</h4>
          <QuestionPreview
            question={original}
            revealed={revealed}
            diffAgainst={typeChanged ? undefined : revised}
            diffSide={typeChanged ? undefined : "original"}
          />
        </section>
        <section className="diff-panel">
          <h4 className="diff-panel-title">수정본</h4>
          <QuestionPreview
            question={revised}
            revealed={revealed}
            diffAgainst={typeChanged ? undefined : original}
            diffSide={typeChanged ? undefined : "revision"}
          />
        </section>
      </div>
    </section>
  );
}
