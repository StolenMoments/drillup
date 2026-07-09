function promptBody(topicName: string): string {
  return `당신은 학습용 문제 출제 전문가입니다. 주제 "${topicName}"에 대한 학습 문제를 생성해 주세요.

## 출력 형식

다른 설명 없이 아래 구조의 JSON만 출력하세요. 코드 펜스(\`\`\`)를 쓰지 마세요.

{
  "questions": [
    {
      "type": "mcq",
      "question": "질문 텍스트",
      "choices": ["보기1", "보기2", "보기3", "보기4"],
      "answer_index": 0,
      "explanation": "정답에 대한 간결한 해설"
    },
    {
      "type": "cloze",
      "text": "핵심 개념을 설명하는 문장. 중요한 단어 자리는 {{1}}, {{2}} 형태의 빈칸으로 둔다.",
      "blanks": [
        { "id": 1, "answer": "빈칸1의 정답 단어" },
        { "id": 2, "answer": "빈칸2의 정답 단어" }
      ],
      "distractors": ["그럴듯한 오답 단어1", "오답 단어2"],
      "explanation": "해설"
    }
  ]
}

## 규칙

- mcq: choices는 정확히 4개, 중복 금지, answer_index는 0~3.
- cloze: text의 {{n}} 자리표시자와 blanks의 id가 정확히 일치해야 함.
- cloze: distractors는 1개 이상이며 정답 단어와 겹치면 안 됨.
- cloze: 빈칸은 문장의 핵심 개념 단어에만 넣을 것.
- explanation은 한두 문장으로 간결하게 작성.
- 두 유형(mcq, cloze)을 섞어서 출제할 것.
`;
}

export function buildGenerationPrompt(topicName: string): string {
  return `${promptBody(topicName)}
## 추가 지시

여기에 범위, 난이도, 문제 수 같은 조건을 추가해 사용하세요.
`;
}

export interface ExistingQuestions {
  summaries: string[];
  truncated: boolean;
}

function dedupSection(existing: ExistingQuestions): string {
  const lines = [
    "## 중복 금지",
    "",
    "- 이번에 생성하는 문제들끼리 질문 내용이 중복되면 안 됩니다.",
  ];
  if (existing.summaries.length > 0) {
    lines.push(
      "- 아래 기존 문제 목록과 질문 내용이 같거나 표현만 바꾼 문제는 출제하지 마세요.",
      "",
      "### 기존 문제 목록",
      "",
      ...existing.summaries.map((summary) => `- ${summary}`),
    );
    if (existing.truncated) {
      lines.push("", "(이 외에도 기존 문제가 더 있습니다. 위 목록은 일부입니다.)");
    }
  }
  return lines.join("\n");
}

function referenceSection(files: string[], lead: string): string {
  if (files.length === 0) return "";
  return [
    "## 참고 자료 (반드시 먼저 읽을 것)",
    "",
    `${lead} 아래 파일들을 모두 읽으세요:`,
    "",
    ...files.map((file) => `- ${file}`),
    "",
    "- 문제와 정답의 사실 관계는 반드시 위 자료 내용에 근거해야 합니다.",
    "- 자료에 없는 내용을 기억이나 추측으로 출제하지 마세요.",
    "- 자료와 당신의 기억이 다르면 자료를 우선하세요.",
    "- 읽을 수 없는 파일이 있으면 그 파일은 무시하고 진행하세요.",
    "",
  ].join("\n");
}

export function buildCliGenerationPrompt(
  topicName: string,
  instructions: string,
  resultPath: string,
  existing: ExistingQuestions,
  referenceFiles: string[] = [],
): string {
  const extra = instructions.trim();
  return `${promptBody(topicName)}
${referenceSection(referenceFiles, "문제를 만들기 전에")}${dedupSection(existing)}

## 추가 지시

${extra || "(없음)"}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}

export function buildCliVerifyPrompt(
  topicName: string,
  items: Array<{ index: number; question: unknown }>,
  resultPath: string,
  referenceFiles: string[] = [],
): string {
  const listing = items
    .map(
      (item) =>
        `### 문제 ${item.index}\n\n\`\`\`json\n${JSON.stringify(item.question, null, 2)}\n\`\`\``,
    )
    .join("\n\n");

  return `당신은 학습용 문제 검수 전문가입니다. 주제 "${topicName}"에 대해 생성된 아래 문제들을 검증해 주세요.

## 판정 기준

각 문제를 다음 기준으로 판정하세요. 하나라도 어긋나면 "fail"입니다.

1. 정답 정확성: 정답이 사실적으로 정확한가? mcq는 answer_index가 가리키는 보기가 실제 정답인가? cloze는 빈칸 정답 단어가 문맥상 올바른가?
2. 문제 품질: 질문이 명확하고 모호하지 않은가? mcq 보기 중 정답으로 볼 수 있는 것이 2개 이상은 아닌가? 해설(explanation)이 정답과 모순되지 않는가?

${referenceSection(referenceFiles, "판정하기 전에")}
## 검증 대상 문제

${listing}

## 출력 형식

다른 설명 없이 아래 구조의 JSON만 작성하세요. 위의 모든 문제에 대해 verdict를 하나씩 내야 합니다.

{
  "verdicts": [
    { "index": 0, "verdict": "pass", "comment": "" },
    { "index": 1, "verdict": "fail", "comment": "간결한 사유" }
  ]
}

- index는 위 "문제 N" 제목의 N을 그대로 사용하세요.
- verdict는 "pass" 또는 "fail"만 허용됩니다.
- comment는 fail이면 사유를 반드시 적고, pass면 빈 문자열이나 짧은 의견을 적으세요.

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
