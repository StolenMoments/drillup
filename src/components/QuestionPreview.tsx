import { Fragment } from "react";
import type { ImportQuestion } from "@/core/import-schema";
import { diffText } from "@/core/text-diff";
import { mcqAnswerIndices } from "@/core/types";

export type QuestionDiffSide = "original" | "revision";

interface QuestionPreviewProps {
  question: ImportQuestion;
  revealed: boolean;
  diffAgainst?: ImportQuestion;
  diffSide?: QuestionDiffSide;
}

function DiffText({
  value,
  against,
  side,
}: {
  value: string;
  against?: string;
  side?: QuestionDiffSide;
}) {
  if (!side) return value;

  const originalText = side === "original" ? value : against ?? "";
  const revisedText = side === "original" ? against ?? "" : value;

  return diffText(originalText, revisedText).map((part, index) => {
    if (part.type === "equal") {
      return <Fragment key={`${part.type}-${index}`}>{part.text}</Fragment>;
    }
    if (side === "original" && part.type === "delete") {
      return (
        <del key={`${part.type}-${index}`} className="diff-deleted">
          {part.text}
        </del>
      );
    }
    if (side === "revision" && part.type === "insert") {
      return (
        <ins key={`${part.type}-${index}`} className="diff-added">
          {part.text}
        </ins>
      );
    }
    return null;
  });
}

function renderClozeText(question: Extract<ImportQuestion, { type: "cloze" }>, revealed: boolean) {
  return question.text.replace(/\{\{(\d+)\}\}/g, (_, id: string) => {
    if (!revealed) return "_____";
    const blank = question.blanks.find((item) => item.id === Number(id));
    return `[${blank?.answer ?? "?"}]`;
  });
}

function isComparable(
  question: ImportQuestion,
  diffAgainst: ImportQuestion | undefined,
  diffSide: QuestionDiffSide | undefined,
): diffAgainst is ImportQuestion {
  return Boolean(diffAgainst && diffSide && question.type === diffAgainst.type);
}

export default function QuestionPreview({
  question,
  revealed,
  diffAgainst,
  diffSide,
}: QuestionPreviewProps) {
  const comparable = isComparable(question, diffAgainst, diffSide);
  const side = comparable ? diffSide : undefined;

  if (question.type === "mcq") {
    const answerIndices = mcqAnswerIndices(question);
    const otherQuestion = comparable && diffAgainst.type === "mcq" ? diffAgainst : undefined;
    const otherAnswerIndices = otherQuestion ? mcqAnswerIndices(otherQuestion) : [];
    const otherExplanations = otherQuestion?.choice_explanations ?? [];

    return (
      <div className="space-y-2">
        <p className="whitespace-pre-wrap leading-7">
          <DiffText
            value={question.question}
            against={otherQuestion?.question}
            side={side}
          />
        </p>
        <ol className="space-y-1 text-sm">
          {question.choices.map((choice, index) => {
            const explanation = revealed ? question.choice_explanations?.[index] : undefined;
            const otherExplanation = revealed ? otherExplanations[index] : undefined;
            const answerLabel = revealed && answerIndices.includes(index) ? " (정답)" : "";
            const otherAnswerLabel = revealed && otherAnswerIndices.includes(index) ? " (정답)" : "";

            return (
              <li key={`${choice}-${index}`} className="text-[color:var(--muted)]">
                <span>{index + 1}. </span>
                <DiffText value={choice} against={otherQuestion?.choices[index]} side={side} />
                <DiffText value={answerLabel} against={otherAnswerLabel} side={side} />
                {explanation ? (
                  <span>
                    <span aria-hidden="true"> — </span>
                    <DiffText value={explanation} against={otherExplanation} side={side} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  const otherQuestion = comparable && diffAgainst.type === "cloze" ? diffAgainst : undefined;
  const displayText = renderClozeText(question, revealed);
  const otherDisplayText = otherQuestion ? renderClozeText(otherQuestion, revealed) : undefined;

  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap leading-7">
        <DiffText value={displayText} against={otherDisplayText} side={side} />
      </p>
      {revealed && (
        <>
          <p className="text-sm text-[color:var(--muted)]">
            빈칸 정답: {question.blanks.map((blank, index) => {
              const otherBlank = otherQuestion?.blanks[index];
              return (
                <Fragment key={`${blank.id}-${index}`}>
                  {index > 0 ? ", " : ""}
                  <span className="font-medium">{index + 1}. </span>
                  <DiffText value={blank.answer} against={otherBlank?.answer} side={side} />
                </Fragment>
              );
            })}
          </p>
          <p className="text-sm text-[color:var(--muted)]">
            오답 단어: {question.distractors.map((distractor, index) => (
              <Fragment key={`${distractor}-${index}`}>
                {index > 0 ? ", " : ""}
                <DiffText
                  value={distractor}
                  against={otherQuestion?.distractors[index]}
                  side={side}
                />
              </Fragment>
            ))}
          </p>
        </>
      )}
    </div>
  );
}
