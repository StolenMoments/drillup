import { mcqAnswerIndices, type ClozePayload, type McqPayload, type QuestionType } from "./types";
import type { QuestionBlueprint } from "./question-blueprint";
import type { GenerationQuestionShape } from "./generation-shape";

function promptBody(topicName: string): string {
  return `당신은 학습용 문제 출제 전문가입니다. 주제 "${topicName}"에 대한 학습 문제를 생성해 주세요.

## 출력 형식

다른 설명 없이 아래 구조의 JSON만 출력하세요. 코드 펜스(\`\`\`)를 쓰지 마세요.

{
  "questions": [
    {
      "type": "mcq",
      "question": "질문 텍스트",
      "choices": ["보기1", "보기2", "보기3", "보기4", "보기5"],
      "answer_indices": [0],
      "choice_explanations": ["보기 1 판단 근거", "보기 2 판단 근거", "보기 3 판단 근거", "보기 4 판단 근거", "보기 5 판단 근거"],
      "explanation": "정답에 대한 간결한 해설",
      "keywords": ["핵심 개념 키워드1", "핵심 개념 키워드2"]
    },
    {
      "type": "cloze",
      "text": "핵심 개념을 설명하는 문장. 중요한 단어 자리는 {{1}}, {{2}} 형태의 빈칸으로 둔다.",
      "blanks": [
        { "id": 1, "answer": "빈칸1의 정답 단어" },
        { "id": 2, "answer": "빈칸2의 정답 단어" }
      ],
      "distractors": ["그럴듯한 오답 단어1", "오답 단어2"],
      "explanation": "해설",
      "keywords": ["핵심 개념 키워드1", "핵심 개념 키워드2"]
    }
  ]
}

## 규칙

- mcq: choices는 4~6개, 가능하면 5~6개 사용, 중복 금지, answer_index는 choices 배열 기준 정답의 0-based 인덱스.
- cloze: text의 {{n}} 자리표시자와 blanks의 id가 정확히 일치해야 함.
- cloze: distractors는 1개 이상이며 정답 단어와 겹치면 안 됨.
- cloze: 빈칸은 문장의 핵심 개념 단어에만 넣을 것.
- explanation은 한두 문장으로 간결하게 작성.
- 두 유형(mcq, cloze)을 섞어서 출제할 것.
- keywords: 문제가 다루는 핵심 개념 키워드. 짧고 직접 관련되며 중복되지 않는 명사구로 작성.
`;
}

export function buildGenerationPrompt(topicName: string): string {
  return `${promptBody(topicName)}
${EXAM_MCQ_RULES}

## Exam-style MCQ requirements

- Generate MCQ only; do not generate cloze questions.
- Each MCQ must contain 4-6 plausible choices, answer_indices (one or two zero-based indices), and choice_explanations with one factual explanation per choice.
- Use a scenario with constraints, goals, and operating conditions; ask for the best solution rather than a recall fact.
- When there are two correct answers, the question text must say "2개를 선택하세요".
${webVerificationSection("문제를 만들기 전에")}
## 추가 지시

여기에 범위, 난이도, 문제 수 같은 조건을 추가해 사용하세요.
`;
}

export interface ExistingQuestions {
  summaries: string[];
  truncated: boolean;
}

function cliMcqPromptBody(topicName: string): string {
  return `You are creating exam-quality learning questions for "${topicName}".

Return only this JSON shape, with no markdown fence:
{
  "questions": [{
    "type": "mcq",
    "question": "scenario question",
    "choices": ["choice 1", "choice 2", "choice 3", "choice 4"],
    "answer_indices": [0],
    "choice_explanations": ["why 1", "why 2", "why 3", "why 4"],
    "explanation": "short explanation",
    "keywords": ["keyword"]
  }]
}`;
}

const EXAM_MCQ_RULES = `
## Mandatory exam-style MCQ contract

Ignore any older mixed-format example above. Generate only \`mcq\` items.
Every generated MCQ must be a scenario that requires interpreting constraints, goals, and operating conditions to choose the best solution. Do not create simple recall questions.
Use 4-6 equally plausible choices. Use \`answer_indices\` with one or two unique zero-based indices, never \`answer_index\`. Include \`choice_explanations\` with exactly one factual explanation for every choice.
Include at least two distractors that are close to the correct answer: use realistic misconceptions, a partially correct solution, or a solution that misses one scenario constraint. Do not use obviously irrelevant or absurd distractors.
Avoid giveaway wording that makes a choice visibly narrow or absolute, such as "only", "always", "never", or Korean equivalents like "만", "항상", and "절대". Make distractors realistic configurations that satisfy some, but not all, requirements.
If and only if there are two correct choices, the question text must include the exact Korean phrase \`2개를 선택하세요\`.
`;

function webVerificationSection(lead: string): string {
  return [
    "## 웹 검색 기반 사실 확인",
    "",
    `${lead} 사용 가능한 WebSearch/WebFetch/브라우징 도구로 최신 정보를 확인하세요.`,
    "",
    "- 공식 문서, 벤더 문서, 표준 문서 같은 1차 출처를 우선하세요.",
    "- 블로그나 커뮤니티 글은 공식 자료가 없을 때만 보조 근거로 사용하세요.",
    "- 참고 자료와 최신 공식 웹 문서가 다르면 최신 공식 웹 문서를 우선하세요.",
    "- 웹 검색 도구를 사용할 수 없으면 추측하지 말고, 사용 가능한 참고 자료와 지식 기준으로만 진행하세요.",
    "- 출력 JSON에는 별도 출처 필드를 추가하지 마세요.",
    "",
  ].join("\n");
}

export function existingKeywordsSection(names: string[]): string {
  if (names.length === 0) return "";
  return [
    "## 키워드 규칙",
    "",
    "- 가능하면 아래 기존 키워드를 재사용하고, 딱 맞는 것이 없을 때만 새 키워드를 만드세요.",
    "- 표기 변형(대소문자, 조사, 축약형)으로 사실상 같은 키워드를 새로 만들지 마세요.",
    "",
    "### 기존 키워드 목록",
    "",
    ...names.map((name) => `- ${name}`),
    "",
  ].join("\n");
}

export interface VariantSource {
  question: string; // 원본 문제 JSON 직렬화 (payload + explanation)
}

function variantSection(sources: VariantSource[]): string {
  if (sources.length === 0) return "";
  return [
    "## 변형 출제 (원본 문제)",
    "",
    "아래 원본 문제들과 같은 개념을 다른 각도·형태·상황으로 묻는 문제를 만드세요.",
    "",
    ...sources.map(
      (source, i) =>
        `### 원본 ${i + 1}\n\n\`\`\`json\n${source.question}\n\`\`\``,
    ),
    "",
    "- 원본과 표현만 바꾼 문제는 금지합니다 (중복 금지 규칙과 같은 기준).",
    "- 원본이 mcq면 cloze로, cloze면 mcq로 바꾸는 유형 전환도 좋은 변형입니다.",
    "",
  ].join("\n");
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
    "- 사실 우선순위: 최신 공식 웹 문서 > 참고 자료 > 당신의 기억.",
    "- 참고 자료는 출제 범위와 스타일의 근거입니다. 자료에 없는 범위를 기억이나 추측으로 출제하지 마세요.",
    "- 서비스가 특정 기능을 기본 제공한다는 주장은 자료에 적혀 있어도 공식 웹 문서로 확인하고, 확인할 수 없으면 그 주장을 정답의 근거로 삼지 마세요.",
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
  existingKeywords: string[] = [],
  variantSources: VariantSource[] = [],
): string {
  const extra = instructions.trim();
  return `${cliMcqPromptBody(topicName)}
${EXAM_MCQ_RULES}
${webVerificationSection("문제를 만들기 전에")}${referenceSection(referenceFiles, "문제를 만들기 전에")}${variantSection(variantSources)}${existingKeywordsSection(existingKeywords)}${dedupSection(existing)}

## 추가 지시

${extra || "(없음)"}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}

function mcqExplanationSection(payload: McqPayload): string {
  const correctText = mcqAnswerIndices(payload).map((index) => payload.choices[index]).join(", ");
  const choiceLines = payload.choices
    .map((choice) => `- ${choice}`)
    .join("\n");
  return `## 문제 (객관식)

질문: ${payload.question}

보기:
${choiceLines}

정답: "${correctText}"`;
}

function clozeExplanationSection(payload: ClozePayload): string {
  const answers = payload.blanks
    .map((blank) => `${blank.id}번 = ${blank.answer}`)
    .join(", ");
  return `## 문제 (빈칸 채우기)

본문: ${payload.text}

정답: ${answers}
오답 후보(distractors): ${payload.distractors.join(", ")}`;
}

export function buildAnswerExplanationPrompt(
  type: QuestionType,
  payload: McqPayload | ClozePayload,
  resultPath: string,
): string {
  const questionSection =
    type === "MCQ"
      ? mcqExplanationSection(payload as McqPayload)
      : clozeExplanationSection(payload as ClozePayload);
  const wrongGuide =
    type === "MCQ"
      ? "각 오답 보기가 왜 틀렸는지, 보기 텍스트를 그대로 인용해서 보기마다 각각 설명하세요."
      : "각 오답 후보(distractor)가 왜 그 빈칸에 맞지 않는지 각각 설명하세요.";
  const numberingGuide =
    type === "MCQ"
      ? "\n- 보기를 가리킬 때 번호나 순서(1번, 2번, 첫 번째, 마지막 등)로 지칭하지 마세요. 학습자 화면에 표시되는 보기 순서는 매번 무작위로 바뀌므로, 반드시 보기 텍스트를 그대로 인용하거나 그 내용을 풀어서 설명하세요."
      : "";
  const mcqSourceGuide = type === "MCQ"
    ? `- 각 보기마다 AWS 공식 문서 하나를 근거로 제시하세요. WebSearch, WebFetch 또는 브라우저 도구로 문서가 실제로 해당 판단을 뒷받침하는지 확인한 뒤 사용하세요.
- 문서 URL은 반드시 https://docs.aws.amazon.com/ 으로 시작하는 AWS 공식 문서여야 합니다. 블로그, FAQ, 검색 결과, AWS 외부 사이트는 사용하지 마세요.
- choice_explanations에는 모든 보기를 한 번씩만 넣고, choice에는 위 보기 텍스트를 글자 하나도 바꾸지 않고 그대로 넣으세요.`
    : "";
  const outputShape = type === "MCQ"
    ? `{
  "explanation": "여기에 전체 해설 텍스트",
  "factual_concern": "(선택) 정답 표기가 사실과 다르다고 판단한 이유와 근거 URL",
  "choice_explanations": [
    {
      "choice": "위 보기 텍스트를 그대로 복사",
      "explanation": "이 보기가 맞거나 틀린 이유",
      "aws_reference": {
        "title": "AWS 공식 문서 제목",
        "url": "https://docs.aws.amazon.com/..."
      }
    }
  ]
}`
    : `{
  "explanation": "여기에 전체 해설 텍스트",
  "factual_concern": "(선택) 정답 표기가 사실과 다르다고 판단한 이유와 근거 URL"
}`;

  return `당신은 학습 문제 해설 전문가입니다. 아래 문제에 대해 정답 근거와 오답이 틀린 이유를 설명해 주세요.

${questionSection}

## 요구 사항

- 정답(빈칸 정답 포함)이 왜 맞는지 먼저 설명하세요.
- ${wrongGuide}${numberingGuide}
${mcqSourceGuide}
- 이 문제의 정답 표기 자체가 최신 공식 문서와 다르다고 판단되면, 해설은 위 지침대로 작성하되 출력 JSON의 factual_concern 필드에 무엇이 왜 다른지와 근거 공식 문서 URL을 함께 적으세요. 확신이 없으면 factual_concern을 넣지 마세요.
- 한국어로, 학습자가 이해하기 쉽게 간결히 작성하세요. 마크다운 기호(#, *, - 등) 없이 일반 문장과 줄바꿈만 사용하세요.

## 출력 형식

다른 설명 없이 아래 구조의 JSON만 출력하세요. 코드 펜스(\`\`\`)를 쓰지 마세요.

${outputShape}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}

export function buildCliVerifyPrompt(
  topicName: string,
  items: Array<{ index: number; question: unknown; blueprint?: QuestionBlueprint }>,
  resultPath: string,
  referenceFiles: string[] = [],
  shape?: GenerationQuestionShape,
): string {
  const listing = items
    .map(
      (item) =>
        `### 문제 ${item.index}\n\n\`\`\`json\n${JSON.stringify(item.question, null, 2)}\n\`\`\``,
    )
    .join("\n\n");
  const blueprintListing = items.filter((item) => item.blueprint).map((item) => `Question ${item.index}: ${JSON.stringify(item.blueprint)}`).join("\n");

  return `당신은 학습용 문제 검수 전문가입니다. 주제 "${topicName}"에 대해 생성된 아래 문제들을 검증해 주세요.

## 판정 기준

각 문제를 다음 기준으로 판정하세요. 하나라도 어긋나면 "fail"입니다.

1. 정답 정확성: 정답이 사실적으로 정확한가? mcq는 answer_index가 가리키는 보기가 실제 정답인가? cloze는 빈칸 정답 단어가 문맥상 올바른가?
2. 문제 품질: 질문이 명확하고 모호하지 않은가? mcq 보기 중 정답으로 볼 수 있는 것이 2개 이상은 아닌가? 해설(explanation)이 정답과 모순되지 않는가?

${webVerificationSection("판정하기 전에")}${referenceSection(referenceFiles, "판정하기 전에")}
## Exam quality gates

Fail an MCQ unless: ${shape ? `answer_indices has exactly ${shape.correctAnswerCount} unique in-range values; it has exactly ${shape.choiceCount} choices; ${shape.correctAnswerCount === 2 ? 'the question includes the exact Korean phrase "2개를 선택하세요"' : 'the question does not ask the learner to choose two answers'};` : 'answer_indices has exactly 1 or 2 unique in-range values; the question says "2개를 선택하세요" exactly when there are two answers;'} every choice is plausible; at least two distractors are close-but-wrong through a realistic misconception, partial solution, or missed constraint; distractors avoid giveaway narrow or absolute wording such as "only", "always", "never", "만", "항상", and "절대"; the scenario's constraints and goal determine the best answer; no additional choice could reasonably be correct; and choice_explanations exists for every choice and is factually correct.
## 검증 대상 문제

${blueprintListing ? `## Blueprint conformance\nUse the blueprint as design intent, but factual accuracy overrides the blueprint: if a blueprint fact, the designated correct answer, or a service capability claim contradicts current official documentation, fail that question and explain why. Fail decorative constraints and presentation clues: only correct choices are longer or more specific; only correct choices repeat scenario wording/order; distractors disproportionately use direct implementation, manual work, custom development, or unconditional wording; choices use different architectural granularity; or service names alone reveal the answer.\n${blueprintListing}\n` : ""}
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

export function buildCliKeywordTagPrompt(
  topicName: string,
  questions: Array<{ id: number; summary: string }>,
  existingKeywords: string[],
  resultPath: string,
): string {
  const listing = questions
    .map((question) => `- (id=${question.id}) ${question.summary}`)
    .join("\n");

  return `당신은 학습 문제 분류 전문가입니다. 주제 "${topicName}"의 아래 문제들에 핵심 개념 키워드를 부여해 주세요.

## 대상 문제 목록

${listing}

${existingKeywordsSection(existingKeywords)}## 출력 형식

다른 설명 없이 아래 구조의 JSON만 작성하세요.

{
  "assignments": [
    { "id": 123, "keywords": ["키워드1", "키워드2"] }
  ]
}

- 위 목록의 모든 문제에 대해 assignment를 하나씩 만드세요. id는 목록의 (id=N)을 그대로 사용하세요.
- keywords는 문제가 다루는 핵심 개념만 짧고 직접 관련되며 중복되지 않는 명사구로 작성하세요.

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}

const blueprintContract = `{
  "blueprints": [{
    "id": "b1", "domainTask": "task", "testedDistinction": "distinction",
    "referenceFacts": [{ "id": "f1", "statement": "fact", "sourceFile": "reference file path" }],
    "constraints": [{ "id": "c1", "statement": "constraint", "kind": "FUNCTIONAL", "factIds": ["f1"] }],
    "choices": [{ "id": "a", "solution": "solution", "serviceNames": ["service"], "satisfiedConstraintIds": ["c1"], "violatedConstraintIds": [], "misconception": null, "correct": true }],
    "reasoningSteps": ["step one", "step two"]
  }]
}`;

export function buildCliQuestionBlueprintPrompt(
  topicName: string,
  instructions: string,
  resultPath: string,
  existing: ExistingQuestions,
  referenceFiles: string[] = [],
  existingKeywords: string[] = [],
  variantSources: VariantSource[] = [],
  shape?: GenerationQuestionShape,
): string {
  const shapeRequirement = shape
    ? `Design 3-5 independent constraints, exactly ${shape.choiceCount} choices, exactly ${shape.correctAnswerCount} correct choices, and at least two close distractors that each miss exactly one constraint. ${shape.correctAnswerCount === 2 ? 'The final question must include the exact Korean phrase "2개를 선택하세요".' : "The final question must not ask the learner to choose two answers."}`
    : "Design 3-5 independent constraints, 4-6 choices, 1-2 correct choices, and at least two close distractors that each miss exactly one constraint.";
  return `Create structural question blueprints for "${topicName}", not final question prose.
Read every supplied reference first. Each referenceFacts.sourceFile must be one of those exact paths. constraint.kind must be exactly one of FUNCTIONAL, SECURITY, PERFORMANCE, COST, OPERATIONS, INTEGRATION, or COMPLIANCE (never variants such as OPERATIONAL). ${shapeRequirement} Use at least three distinct services across choices. Do not choose an answer first and fill distractors afterward.
Use \`"misconception": null\` for correct choices. Every distractor must have a nonblank misconception explaining why it is wrong.
Do not expose blueprint metadata in a final question; this output is planning data only.
${referenceSection(referenceFiles, "Before planning")}${variantSection(variantSources)}${existingKeywordsSection(existingKeywords)}${dedupSection(existing)}
Additional instructions:
${instructions.trim() || "(none)"}

Output only JSON matching this contract:
${blueprintContract}

Write the JSON as UTF-8 to ${resultPath}; do not print it to stdout.`;
}

export function buildCliQuestionBlueprintRepairPrompt(
  failedBlueprints: QuestionBlueprint[],
  violations: string,
  resultPath: string,
  shape?: GenerationQuestionShape,
): string {
  return `Repair only the requested question blueprints below. Return exactly one repaired blueprint for each listed id, with the same id. Do not add or remove ids. Correct the listed structural violations while retaining the intended domain task and referenced facts.${shape ? ` Each blueprint must contain exactly ${shape.choiceCount} choices and exactly ${shape.correctAnswerCount} correct choices.` : ""}
Violations:
${violations}
Blueprints:
\`\`\`json
${JSON.stringify(failedBlueprints, null, 2)}
\`\`\`
Output only ${blueprintContract} and write it to ${resultPath}.`;
}

export function buildCliGenerationFromBlueprintPrompt(
  topicName: string,
  blueprints: QuestionBlueprint[],
  resultPath: string,
  referenceFiles: string[] = [],
  shape?: GenerationQuestionShape,
): string {
  return `Write final MCQ questions for "${topicName}" from the blueprints below. Preserve their array order and produce exactly one question per blueprint in that order. Preserve facts, correctness, constraints, and service relationships. Do not expose blueprint ids, correctness flags, satisfied/violated constraints, misconceptions, or other planning metadata. Make each scenario naturally include every constraint and make choices comparable in specificity and structure.${shape ? ` Each final MCQ must have exactly ${shape.choiceCount} choices and exactly ${shape.correctAnswerCount} correct choices.${shape.correctAnswerCount === 2 ? ' Include the exact Korean phrase "2개를 선택하세요" in every question.' : ' Do not ask the learner to choose two answers.'}` : ""}
${referenceSection(referenceFiles, "Before writing")}
Blueprints:
\`\`\`json
${JSON.stringify(blueprints, null, 2)}
\`\`\`
${cliMcqPromptBody(topicName)}
Write JSON only to ${resultPath}; do not print it to stdout.`;
}

export function buildCliRevisionPrompt(
  topicName: string,
  question: unknown,
  instructions: string,
  resultPath: string,
  referenceFiles: string[] = [],
  blueprint?: QuestionBlueprint,
  shape?: GenerationQuestionShape,
): string {
  const questionWithBlueprint = blueprint ? { question, blueprint, blueprintGuide: "Keep the blueprint's tested distinction and structure, but correct factual errors: if a blueprint fact or the designated answer contradicts current official documentation, fix the question accordingly and explain in the comment." } : question;
  return `당신은 학습 문제 검증 및 개선 전문가입니다. 주제 "${topicName}"의 아래 문제를 검증하고 개선하세요.

${webVerificationSection("검증하기 전에")}${referenceSection(referenceFiles, "검증하기 전에")}## 대상 문제

\`\`\`json
${JSON.stringify(questionWithBlueprint, null, 2)}
\`\`\`

## 검증 기준

${shape ? `- 객관식은 선지가 정확히 ${shape.choiceCount}개이고 정답이 정확히 ${shape.correctAnswerCount}개여야 합니다.${shape.correctAnswerCount === 2 ? ' 질문에 "2개를 선택하세요"를 정확히 포함하세요.' : ' 질문에서 두 개를 선택하라고 안내하지 마세요.'}` : ""}
- 정답과 answer_index 또는 빈칸 답이 사실에 맞는지 확인합니다.
- 질문의 명확성, 복수 정답 가능성, 해설의 일관성을 확인합니다.
- 문제 유형(mcq 또는 cloze)은 유지하고, 수정이 필요하면 더 정확하고 명확한 문제로 고칩니다.

## 추가 요청

${instructions.trim() || "(없음)"}

## 출력 형식

다른 설명 없이 아래 JSON만 ${resultPath}에 UTF-8로 저장하세요. stdout에는 결과 JSON을 출력하지 마세요.

{
  "verdict": "pass",
  "comment": "검증 결과와 수정 이유",
  "revised_question": { "type": "mcq" }
}

- revised_question은 반드시 완전한 가져오기 문제 형식이어야 합니다.
- 이미 적절한 문제여도 revised_question에는 검증한 문제 전체를 넣으세요.
`;
}

export function buildKeywordSuggestionPrompt(
  topicName: string,
  question: { type: QuestionType; payload: unknown; explanation: string | null },
  existingKeywords: string[],
  assignedKeywords: string[],
  resultPath: string,
): string {
  const existingSection = existingKeywords.length
    ? [
        "## 기존 키워드 목록",
        "",
        "가능하면 아래 표준 표기를 재사용하세요.",
        "",
        ...existingKeywords.map((name) => `- ${name}`),
        "",
      ].join("\n")
    : "";
  const assignedSection = assignedKeywords.length
    ? [
        "## 이미 부여된 키워드",
        "",
        ...assignedKeywords.map((name) => `- ${name}`),
        "",
        "위 키워드는 결과에 다시 넣지 마세요.",
        "",
      ].join("\n")
    : "";

  return `당신은 학습 문제 분류 전문가입니다. 주제 "${topicName}"의 한 문제를 보고 추가할 핵심 개념 키워드를 추천해 주세요.

## 대상 문제

\`\`\`json
${JSON.stringify(question, null, 2)}
\`\`\`

${existingSection}${assignedSection}## 출력 형식

다른 설명 없이 아래 구조의 JSON만 작성하세요.

{
  "keywords": ["키워드1", "키워드2"]
}

## 규칙

- 문제가 직접 다루는 핵심 개념만 짧은 명사구로 추천하세요.
- keywords는 비어 있지 않아야 하며 짧고 직접 관련되고 중복되지 않아야 합니다.
- 표기 변형과 이미 부여된 키워드는 넣지 마세요.

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}

export function buildChoiceHardeningPrompt(
  topicName: string,
  payload: McqPayload,
  resultPath: string,
): string {
  const target = {
    question: payload.question,
    choices: payload.choices,
    answer_indices: mcqAnswerIndices(payload),
  };
  return `당신은 학습 문제 개선 전문가입니다. 주제 "${topicName}"의 아래 객관식 문제는 오답 선지가 너무 쉬워 정답이 쉽게 드러납니다. 오답 선지만 더 어려운 오답으로 교체하세요.

${webVerificationSection("선지를 교체하기 전에")}## 대상 문제

\`\`\`json
${JSON.stringify(target, null, 2)}
\`\`\`

## 불변 조건 (반드시 준수)

- question 텍스트를 한 글자도 바꾸지 마세요.
- answer_indices 값과 그 위치의 정답 선지 텍스트를 한 글자도 바꾸지 마세요.
- 선지 개수를 바꾸지 마세요.
- 오답 선지만 교체할 수 있으며, 최소 1개는 반드시 교체하세요.
- 정답 선지 자체가 최신 공식 문서와 다르다고 판단되면, 교체 작업은 위 규칙대로 진행하되 factual_concern 필드에 이유와 근거 공식 문서 URL을 적으세요. 확신이 없으면 넣지 마세요.
${EXAM_MCQ_RULES}
## 출력 형식

다른 설명 없이 아래 구조의 JSON만 작성하세요.

{
  "comment": "어떤 오답을 왜 교체했는지 간결한 한국어 설명",
  "factual_concern": "(선택) 정답 선지가 사실과 다르다고 판단한 이유와 근거 URL",
  "revised": {
    "question": "원본과 동일한 질문",
    "choices": ["교체 반영된 전체 선지 배열"],
    "answer_indices": [0],
    "choice_explanations": ["선지별 판단 근거 (선지 수와 동일한 개수)"]
  }
}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
