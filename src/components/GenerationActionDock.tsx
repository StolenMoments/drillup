import type { GenerationJobTypeDto } from "@/lib/api-types";

interface GenerationActionDockProps {
  type: GenerationJobTypeDto;
  selectedCount: number;
  appliedRevisionCount: number;
  runningRevisionCount: number;
  saving: boolean;
  message: string;
  onSave: () => void;
}

function saveButtonLabel(
  type: GenerationJobTypeDto,
  selectedCount: number,
  saving: boolean,
): string {
  if (saving) return type === "KEYWORD_TAGGING" ? "키워드 적용 중…" : "저장 중…";
  if (type === "KEYWORD_TAGGING") return `선택한 ${selectedCount}개 문제에 적용`;
  return `선택한 ${selectedCount}개 문제 저장`;
}

export default function GenerationActionDock({
  type,
  selectedCount,
  appliedRevisionCount,
  runningRevisionCount,
  saving,
  message,
  onSave,
}: GenerationActionDockProps) {
  const hasRunningRevision = runningRevisionCount > 0;
  const disabled = selectedCount === 0 || saving || hasRunningRevision;
  const statusMessage = hasRunningRevision
    ? `⏳ 수정본 ${runningRevisionCount}개를 확인하는 중입니다. 확인이 끝나면 저장할 수 있습니다.`
    : message;

  return (
    <section
      className="generation-action-dock"
      role="region"
      aria-label="생성 결과 저장 작업"
    >
      <div className="generation-action-dock-inner">
        <div className="generation-action-dock-summary">
          <div className="generation-action-dock-counts">
            <span>
              선택한 <strong>{selectedCount}</strong>개
            </span>
            {type === "QUESTION_GENERATION" && (
              <span className="generation-action-dock-revision-count">
                수정본 적용 <strong>{appliedRevisionCount}</strong>개
              </span>
            )}
          </div>
          <p className="generation-action-dock-message" aria-live="polite">
            {statusMessage ||
              (type === "QUESTION_GENERATION"
                ? "저장할 문항을 확인한 뒤 마지막에 한 번에 저장하세요."
                : "적용할 문제를 선택한 뒤 마지막에 한 번에 반영하세요.")}
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={disabled}
          className="btn btn-success generation-action-dock-button"
        >
          {saveButtonLabel(type, selectedCount, saving)}
        </button>
      </div>
    </section>
  );
}
