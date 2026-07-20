import {
  mcqAnswerIndices,
  type ClozePayload,
  type McqPayload,
  type QuestionType,
} from "./types";

function mcqSection(payload: McqPayload): string {
  const correctText = mcqAnswerIndices(payload)
    .map((index) => payload.choices[index])
    .join(", ");
  const choiceLines = payload.choices.map((choice) => `- ${choice}`).join("\n");
  return `## 문제 (객관식)

질문: ${payload.question}

보기:
${choiceLines}

정답: "${correctText}"`;
}

function clozeSection(payload: ClozePayload): string {
  const answers = payload.blanks
    .map((blank) => `${blank.id}번 = ${blank.answer}`)
    .join(", ");
  return `## 문제 (빈칸 채우기)

본문: ${payload.text}

정답: ${answers}
오답 후보(distractors): ${payload.distractors.join(", ")}`;
}

export function buildNoteExtractPrompt(
  type: QuestionType,
  payload: McqPayload | ClozePayload,
  explanation: string | null,
  currentNote: string,
  resultPath: string,
): string {
  const questionSection =
    type === "MCQ"
      ? mcqSection(payload as McqPayload)
      : clozeSection(payload as ClozePayload);
  const explanationText = explanation?.trim() || "(해설 없음)";
  const noteText = currentNote.trim() || "(아직 노트가 비어 있습니다)";

  return `당신은 자격증 학습 노트 작성을 돕는 전문가입니다. 아래 문제에서 시험 대비에 가치 있는 핵심 내용을 뽑아, 사용자의 기존 노트에 덧붙일 항목만 작성하세요.

${questionSection}

## 해설

${explanationText}

## 사용자의 현재 노트

\`\`\`markdown
${noteText}
\`\`\`

## 추출 규칙 (반드시 준수)

- 서비스 간 관계, 서비스의 핵심 기능, 선택 기준처럼 다음에 비슷한 문제를 만났을 때 도움이 될 내용만 뽑으세요.
- 현재 노트에 이미 있는 내용은 절대 다시 추출하지 마세요. 표현만 다른 같은 내용도 중복으로 봅니다.
- 이 문제에만 해당하는 지엽적인 사실(문항 번호, 특정 수치 예시 등)은 넣지 마세요.
- 문제와 해설에 근거한 내용만 쓰고, 근거 없는 새로운 사실을 지어내지 마세요.
- 마크다운 목록(\`- \`) 형태로, 항목당 한 줄로 간결하게 쓰세요. 필요하면 \`## 소제목\`으로 묶어도 됩니다.
- 한국어로 쓰고, 서비스명 등 고유명사는 원문 표기 그대로 두세요.
- 기존 노트에 없는 새로운 항목이 하나도 없다면, note에 빈 문자열("")을 넣으세요.

## 출력 형식

다른 설명 없이 아래 구조의 JSON만 작성하세요.

{
  "note": "- 추출한 항목\\n- 또 다른 항목"
}

새로 추가할 내용이 없을 때:

{
  "note": ""
}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
