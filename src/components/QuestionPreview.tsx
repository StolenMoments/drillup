import type { ImportQuestion } from "@/core/import-schema";

export default function QuestionPreview({
  question,
}: {
  question: ImportQuestion;
}) {
  if (question.type === "mcq") {
    return (
      <div className="space-y-2">
        <p className="leading-7">{question.question}</p>
        <ol className="space-y-1 text-sm">
          {question.choices.map((choice, index) => (
            <li
              key={choice}
              className={
                index === question.answer_index
                  ? "font-semibold text-[color:var(--success)]"
                  : "text-[color:var(--muted)]"
              }
            >
              {index + 1}. {choice}
              {index === question.answer_index ? " (정답)" : ""}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const filledText = question.text.replace(/\{\{(\d+)\}\}/g, (_, id) => {
    const blank = question.blanks.find((item) => item.id === Number(id));
    return `[${blank?.answer ?? "?"}]`;
  });

  return (
    <div className="space-y-2">
      <p className="leading-7">{filledText}</p>
      <p className="text-sm text-[color:var(--muted)]">
        오답 단어: {question.distractors.join(", ")}
      </p>
    </div>
  );
}
