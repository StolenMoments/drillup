# AIP-C01 D1 - FM 통합, 데이터 관리, 컴플라이언스

> 스냅샷: 2026-07 기준  
> 출처 기반: `docs/AIP-C01 시험범위.txt`  
> 비중: 31%

## 범위 요약

D1은 요구 사항 분석, FM 선택, 데이터 검증/처리, 벡터 저장소, 검색 메커니즘, 프롬프트 엔지니어링과 거버넌스를 다룬다. 전체 시험에서 가장 비중이 크므로 RAG, Bedrock, SageMaker AI, 벡터 검색, 프롬프트 관리, 데이터 품질을 묶은 시나리오를 많이 출제한다.

## 작업 1.1: 요구 사항 분석 및 GenAI 솔루션 설계

- 비즈니스 요구 사항과 기술 제약에 맞는 포괄적 아키텍처를 설계한다.
- 적절한 FM, 통합 패턴, 배포 전략을 선택한다.
- 전체 배포 전에 Amazon Bedrock 등을 사용해 개념 증명으로 실현 가능성, 성능, 비즈니스 가치를 검증한다.
- AWS Well-Architected Framework와 AWS Well-Architected Tool Generative AI Lens를 사용해 표준화된 기술 구성 요소를 만든다.

## 작업 1.2: FM 선택 및 구성

- 성능 벤치마크, 역량 분석, 한계 평가를 기반으로 FM을 평가하고 선택한다.
- Lambda, API Gateway, AWS AppConfig 등을 사용해 코드 수정 없이 동적 모델 선택 또는 공급자 전환이 가능한 아키텍처를 설계한다.
- 서비스 중단에도 운영 가능한 복원력을 설계한다. 예: Step Functions 서킷 브레이커, Bedrock 크로스 리전 추론, 크로스 리전 모델 배포, 성능 저하 전략.
- 사용자 지정 FM 배포와 수명 주기를 관리한다. 예: SageMaker AI, LoRA와 어댑터 같은 파라미터 효율 튜닝, SageMaker Model Registry, 자동 배포 파이프라인, 롤백, 모델 사용 중지/교체.

## 작업 1.3: FM용 데이터 검증 및 처리 파이프라인

- AWS Glue Data Quality, SageMaker Data Wrangler, Lambda, CloudWatch 지표를 사용해 데이터 품질 표준 충족 여부를 검증한다.
- 텍스트, 이미지, 오디오, 표 형식 데이터를 처리한다. 예: Bedrock 멀티모달 모델, SageMaker Processing, Amazon Transcribe, 멀티모달 파이프라인.
- Bedrock API JSON 요청, SageMaker AI 엔드포인트 입력, 대화형 애플리케이션의 대화 형식처럼 모델별 입력 형식을 맞춘다.
- Bedrock 텍스트 재작성, Comprehend 엔터티 추출, Lambda 정규화로 입력 데이터 품질을 높인다.

## 작업 1.4: 벡터 저장소 설계 및 구현

- Bedrock Knowledge Bases, OpenSearch Service, Amazon RDS, DynamoDB 등으로 벡터 데이터베이스 아키텍처를 설계한다.
- S3 객체 메타데이터, 사용자 지정 속성, 태깅 시스템으로 검색 정밀도와 컨텍스트 인식을 높인다.
- OpenSearch 샤딩, 다중 인덱스, 계층적 인덱싱으로 대규모 시맨틱 검색 성능을 최적화한다.
- 문서 관리 시스템, 지식 기반, 내부 위키를 GenAI 애플리케이션과 통합한다.
- 증분 업데이트, 실시간 변경 감지, 자동 동기화, 예약 새로 고침으로 벡터 저장소 최신성을 유지한다.

## 작업 1.5: FM 증강 검색 메커니즘 설계

- Bedrock 청킹, Lambda 기반 고정 크기 청킹, 콘텐츠 구조 기반 계층적 청킹으로 검색 성능을 최적화한다.
- Amazon Titan 임베딩과 Bedrock 임베딩 모델을 차원, 도메인 적합성, 성능 특성 기준으로 평가한다.
- OpenSearch 벡터 검색, pgvector 지원 Aurora, Bedrock Knowledge Bases 관리형 벡터 스토어를 구성한다.
- OpenSearch 시맨틱 검색, 하이브리드 검색, Bedrock 리랭커 모델로 관련성과 정확성을 개선한다.
- Bedrock 쿼리 확장, Lambda 쿼리 분해, Step Functions 쿼리 변환으로 검색 효율과 결과 품질을 높인다.
- 함수 호출 인터페이스, MCP 클라이언트, 표준 API 패턴으로 FM과 검색을 일관되게 통합한다.

## 작업 1.6: 프롬프트 엔지니어링 전략 및 거버넌스

- Bedrock Prompt Management로 역할 정의, 파라미터화된 템플릿, 버전 관리(draft→version 스냅샷)를 제공한다. 네이티브 승인·반려 워크플로는 없으므로, 배포 전 승인이 필요하면 외부 프로세스(티켓 승인, 코드 리뷰 등)와 결합해야 한다.
- Bedrock Guardrails로 책임 있는 AI 지침을 적용하고 응답 형식을 템플릿으로 통제한다.
- Step Functions, Comprehend, DynamoDB로 대화 컨텍스트, 의도 인식, 대화 기록 저장을 구현한다.
- S3 템플릿 리포지토리, CloudTrail 사용 추적, CloudWatch Logs 액세스 기록으로 프롬프트 운영을 감사한다.
- Lambda 출력 확인, Step Functions 엣지 케이스 테스트, CloudWatch 프롬프트 회귀 테스트로 품질을 보증한다.
- 구조화된 입력, 출력 형식 지정, 추론 패턴, 피드백 루프로 응답 품질을 반복 개선한다.
- Bedrock Prompt Flows로 순차 프롬프트 체인, 조건부 분기, 재사용 가능한 구성 요소, 전처리/후처리를 설계한다.

## 출제 포인트

- RAG 문제에서는 저장소 선택, 청킹, 임베딩, 검색, 리랭킹, 최신성 유지 요구를 함께 묻는다.
- 모델 선택 문제에서는 성능, 비용, 리전 가용성, 복원력, 전환 가능성을 함께 고려한다.
- 프롬프트 거버넌스 문제에서는 Prompt Management, Guardrails, CloudTrail, CloudWatch Logs, S3 저장소 역할을 구분한다.
- 데이터 품질 문제에서는 Glue Data Quality, Data Wrangler, Lambda, Comprehend, Transcribe, SageMaker Processing의 목적 차이를 묻는다.
