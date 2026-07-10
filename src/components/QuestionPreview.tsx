import type { ImportQuestion } from "@/core/import-schema";
import { mcqAnswerIndices } from "@/core/types";

export default function QuestionPreview({
  question,
  revealed,
}: {
  question: ImportQuestion;
  revealed: boolean;
}) {
  if (question.type === "mcq") {
    const answerIndices = mcqAnswerIndices(question);
    return (
      <div className="space-y-2">
        <p className="leading-7">{question.question}</p>
        <ol className="space-y-1 text-sm">
          {question.choices.map((choice, index) => (
            <li
              key={choice}
              className={
                revealed && answerIndices.includes(index)
                  ? "font-semibold text-[color:var(--success)]"
                  : "text-[color:var(--muted)]"
              }
            >
              {index + 1}. {choice}
              {revealed && answerIndices.includes(index) ? " (정답)" : ""}
              {revealed && question.choice_explanations?.[index] ? ` — ${question.choice_explanations[index]}` : ""}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const displayText = question.text.replace(/\{\{(\d+)\}\}/g, (_, id) => {
    if (!revealed) return "_____";
    const blank = question.blanks.find((item) => item.id === Number(id));
    return `[${blank?.answer ?? "?"}]`;
  });

  return (
    <div className="space-y-2">
      <p className="leading-7">{displayText}</p>
      {revealed && (
        <p className="text-sm text-[color:var(--muted)]">
          오답 단어: {question.distractors.join(", ")}
        </p>
      )}
    </div>
  );
}
