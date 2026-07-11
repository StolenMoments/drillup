# AIP-C01 D3 - AI 안전, 보안, 거버넌스

> 스냅샷: 2026-07 기준  
> 출처 기반: `docs/AIP-C01 시험범위.txt`  
> 비중: 20%

## 범위 요약

D3는 입력/출력 안전, 데이터 보안, 개인 정보 보호, AI 거버넌스, 규정 준수, 책임 있는 AI를 다룬다. Guardrails, IAM, KMS, PrivateLink, CloudTrail, CloudWatch Logs, Macie, Comprehend, SageMaker Clarify, 모델 카드, 데이터 계보가 자주 연결된다.

## 작업 3.1: 입력 및 출력 안전 제어

- Bedrock Guardrails, Step Functions, Lambda, 실시간 검증으로 유해 입력을 차단한다.
- Bedrock Guardrails, 콘텐츠 조정, 유해성 탐지, 결정적 텍스트-SQL 변환으로 유해 출력을 방지한다.
- Bedrock Knowledge Bases, 사실 확인, 신뢰도 점수, 의미론적 유사성 검색, JSON Schema 구조화 출력으로 할루시네이션을 줄인다.
- Comprehend 전처리 필터, Bedrock 모델 기반 가드레일, Lambda 사후 검증, API Gateway 응답 필터링으로 심층 방어를 구성한다.
- 프롬프트 인젝션, 탈옥, 입력 삭제, 콘텐츠 필터, 안전 분류기, 적대적 테스트 워크플로로 위협을 탐지한다.

## 작업 3.2: 데이터 보안 및 개인 정보 보호

- VPC 엔드포인트, IAM 정책, Lake Formation, CloudWatch 데이터 액세스 모니터링으로 보호된 AI 환경을 만든다.
- Comprehend와 Macie로 PII를 탐지하고, Bedrock 데이터 프라이버시 기능과 Guardrails로 민감 정보를 보호한다.
- S3 수명 주기 구성으로 데이터 보존 정책을 구현한다.
- 데이터 마스킹, 익명화, Comprehend PII 탐지, Guardrails로 프라이버시 중심 AI 시스템을 구성한다.

## 작업 3.3: AI 거버넌스 및 규정 준수

- SageMaker AI 모델 카드, AWS Glue 데이터 계보, 메타데이터 태깅, CloudWatch Logs 의사 결정 로그로 규정 준수 프레임워크를 만든다.
- Glue Data Catalog, 생성 콘텐츠 소스 메타데이터, CloudTrail 감사 로깅으로 데이터 소스 추적성을 유지한다.
- 조직 정책, 규제 요구 사항, 책임 있는 AI 원칙에 맞춘 거버넌스 프레임워크를 설계한다.
- 오용, 드리프트, 정책 위반, 바이어스 드리프트, 자동 경고와 수정 워크플로, 토큰 수준 수정, 응답 로깅, AI 출력 정책 필터로 지속적 모니터링을 수행한다.

## 작업 3.4: 책임 있는 AI 원칙

- 사용자 대상 설명, 신뢰도 지표, 불확실성 정량화, 소스 속성, Bedrock 에이전트 추적으로 투명성을 제공한다.
- CloudWatch, Bedrock Prompt Management, Bedrock Prompt Flows, Bedrock 자동 모델 평가로 공정성 평가와 A/B 테스트를 수행한다.
- Bedrock Guardrails, 모델 카드, Lambda 자동 규정 준수 검사로 정책 준수 AI 시스템을 개발한다.

## 출제 포인트

- Guardrails 적용 강제는 Bedrock 호출과 IAM 조건 키의 관계를 묻는 문제가 나올 수 있다.
- CloudTrail은 API 호출 감사에 강하지만 실제 프롬프트/응답 본문 로깅 요구와는 구분한다.
- PII/민감 데이터 문제는 Macie, Comprehend, Guardrails, S3 수명 주기, IAM/KMS/PrivateLink를 요구에 맞춰 조합한다.
- 데이터 계보와 검토자 신뢰성 확인 문제는 Glue Data Catalog, 메타데이터 태깅, 소스 속성이 핵심이다.
- 책임 있는 AI는 투명성, 공정성, 설명 가능성, 모델 카드, 지속 모니터링을 서비스 기능과 연결해 묻는다.
