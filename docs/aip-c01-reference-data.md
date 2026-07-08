# AIP-C01 문제 생성용 참고 데이터 가이드

작성일: 2026-07-09
대상 시험: AWS Certified Generative AI Developer – Professional (AIP-C01)

AIP-C01은 2025년 출시된 최신 시험이라 Claude/Codex/Antigravity 모두 학습 데이터가
부족하다. 핵심 원칙: **모델의 기억에 의존하지 않고, 제공한 자료에 근거해서만 출제하게
만든다.**

## 시험 개요

5개 도메인 (공식 Exam Guide 기준):

| 도메인 | 비중 |
|---|---|
| D1. Foundation Model Integration, Data Management, and Compliance | 31% |
| D2. Implementation and Integration | 26% |
| D3. AI Safety, Security, and Governance | 20% |
| D4. Operational Efficiency and Optimization for GenAI Applications | 12% |
| D5. Testing, Validation, and Troubleshooting | 11% |

- 공식 시험 가이드: <https://docs.aws.amazon.com/aws-certification/latest/ai-professional-01/ai-professional-01.html>
- Exam Guide PDF: <https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/certification/approved/pdfs/docs-aip/AWS-Certified-Generative-AI-Developer-Pro_Exam-Guide.pdf>

## 우선순위별 데이터 목록

| 우선순위 | 자료 | 왜 필요한가 | 준비 방법 |
|---|---|---|---|
| **필수 1** | 공식 Exam Guide (AIP-C01) | 5개 도메인·task statement·**in-scope/out-of-scope 서비스 목록**이 출제 범위의 유일한 공식 정의 | 공식 PDF를 markdown으로 변환 |
| **필수 2** | 공식 샘플 문항 (AWS 제공 practice questions) | 문제 **스타일 앵커** — Professional 레벨 특유의 긴 시나리오, "회사 X가 ~하려 한다. 가장 적합한 방법은?" 톤, 오답 보기의 그럴듯함을 모델이 흉내낼 표본 | Skill Builder 무료 샘플 문항 10~20개를 md로 정리 (복제가 아닌 스타일 참고용으로 명시) |
| **필수 3** | 도메인별 AWS 서비스 핵심 정리 | 정답의 사실적 근거. GenAI 서비스는 변화가 빨라 모델 기억이 자주 틀림 | Bedrock(Agents, Knowledge Bases, Guardrails, 모델 평가, 추론 옵션·가격 모델), SageMaker AI, RAG/벡터 스토어, 프롬프트 엔지니어링, 보안(IAM·KMS·PrivateLink·스코핑 매트릭스), 모니터링·비용 최적화 — 공식 문서/FAQ를 도메인별 md 파일로 요약 |
| 권장 4 | AWS 공식 백서·블로그 | 도메인 3(안전·보안·거버넌스 20%)은 서비스 문서보다 백서가 원천 | GenAI Security Scoping Matrix, Responsible AI 문서, Well-Architected GenAI Lens 요약 |
| 권장 5 | 본인 학습 노트·오답 노트 | 약점 집중 출제 | 공부하면서 축적, 파일 하나로 |
| 선택 6 | 커뮤니티 학습 자료 요약 (Tutorials Dojo study path 등) | 실제 응시자 관점의 강조점 | 개인 학습용 요약만 |

## 자료 포맷 규칙 (세 CLI 공통으로 안전하게)

- **md/txt만** — Claude는 PDF를 읽지만 Codex·Antigravity는 불안정. PDF는 반드시
  텍스트로 변환해서 넣는다.
- **파일 하나 = 주제 하나**, 수십 KB 이내로 분할. 파일명에 도메인 접두사(`d1-`,
  `d2-`…)를 붙여 생성 화면 체크박스에서 고르기 쉽게 한다.
- 각 파일 상단에 **스냅샷 날짜**를 기재한다 (GenAI 서비스는 몇 달 만에 바뀌므로
  "2026-07 기준" 명시).
- 저작권 있는 자료(샘플 문항, 유료 학습 자료 요약)가 포함되므로
  `generation_reference/`는 git에 커밋하지 않는다 (`.gitignore` 등록).

## 폴더 구성

```
generation_reference/aip-c01/
  common/00-exam-guide.md        # 도메인·task statement·범위 서비스
  common/01-style-examples.md    # 공식 샘플 문항 (스타일 참고)
  d1/bedrock-models-data.md      # 도메인1: FM 통합·데이터·컴플라이언스 (31%)
  d2/implementation.md           # 도메인2: 구현·통합 (26%)
  d3/safety-security.md          # 도메인3: 안전·보안·거버넌스 (20%)
  d4/optimization.md             # 도메인4: 운영 효율·최적화 (12%)
  d5/testing-troubleshooting.md  # 도메인5: 테스트·검증 (11%)
  notes/weak-areas.md            # 오답 노트
```

## 주제(topic) 운용

도메인별로 topic 5개를 만들고(`AIP-C01 D1 — FM 통합` …), 다섯 topic 모두
`referenceDir`를 같은 `aip-c01`로 지정한다. 생성 시 파일 체크박스에서 `common/` +
해당 도메인 파일만 선택한다. SRS 진척도·통계가 도메인별로 나뉘어 약점 도메인이
보인다.
