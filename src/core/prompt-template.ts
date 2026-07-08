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

export function buildCliGenerationPrompt(
  topicName: string,
  instructions: string,
  resultPath: string,
): string {
  const extra = instructions.trim();
  return `${promptBody(topicName)}
## 추가 지시

${extra || "(없음)"}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
