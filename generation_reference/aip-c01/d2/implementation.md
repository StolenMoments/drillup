# AIP-C01 D2 - 구현 및 통합

> 스냅샷: 2026-07 기준  
> 출처 기반: `docs/AIP-C01 시험범위.txt`  
> 비중: 26%

## 범위 요약

D2는 에이전틱 AI, 도구 통합, 모델 배포, 엔터프라이즈 통합, FM API 통합, 개발 도구를 다룬다. “기존 시스템과 어떻게 연결할 것인가”, “어떤 배포 방식이 요구 조건에 맞는가”, “어떻게 안정적으로 호출하고 스트리밍할 것인가”가 핵심이다.

## 작업 2.1: 에이전틱 AI 솔루션 및 도구 통합

- Strands Agents, AWS Agent Squad, MCP를 사용해 다중 에이전트, 메모리, 상태 관리, 에이전트-도구 상호 작용을 구현한다.
- Step Functions로 ReAct 패턴, 생각의 사슬, 구조화된 문제 해결 흐름을 오케스트레이션한다.
- Step Functions 중지 조건, Lambda 타임아웃, IAM 리소스 경계, 서킷 브레이커로 안전한 AI 워크플로를 만든다.
- 특수 FM, 모델 앙상블, 사용자 지정 집계 로직, 모델 선택 프레임워크로 복잡한 작업 성능을 최적화한다.
- Step Functions 승인 프로세스, API Gateway 피드백 수집, 인간 증강 패턴으로 human-in-the-loop를 구현한다.
- Strand API, 표준 함수 정의, Lambda 파라미터 검증과 오류 처리로 신뢰할 수 있는 도구 호출을 만든다.
- Lambda 기반 stateless MCP 서버, ECS 기반 복잡한 MCP 서버, MCP 클라이언트 라이브러리로 모델 확장 프레임워크를 만든다.

## 작업 2.2: 모델 배포 전략 구현

- Lambda 온디맨드 호출, Bedrock 프로비저닝 처리량, SageMaker AI 엔드포인트를 요구 사항에 맞게 선택한다.
- LLM의 메모리 요구 사항, GPU 사용률, 토큰 처리 용량에 맞춘 컨테이너 기반 배포 패턴을 구현한다.
- 적절한 모델 선택, 소규모 사전 학습 모델, API 기반 모델 캐스케이딩으로 비용과 성능을 균형 있게 맞춘다.

## 작업 2.3: 엔터프라이즈 통합 아키텍처

- 레거시 시스템 API 통합, 이벤트 기반 아키텍처, 데이터 동기화 패턴으로 기존 환경에 FM 기능을 통합한다.
- API Gateway, Lambda 웹후크 핸들러, EventBridge로 애플리케이션에 GenAI 기능을 추가한다.
- ID 페더레이션, 역할 기반 액세스 제어, 최소 권한 API 액세스로 보안 액세스 프레임워크를 만든다.
- Outposts, Wavelength, 클라우드-온프레미스 보안 라우팅으로 관할 구역과 하이브리드 요구를 처리한다.
- CodePipeline, CodeBuild, 보안 스캔, 롤백, 자동 테스트, 중앙 추상화 계층, 관찰성과 제어로 GenAI 게이트웨이와 CI/CD를 구현한다.

## 작업 2.4: FM API 통합

- Bedrock API로 동기 요청을 관리하고, AWS SDK와 SQS로 비동기 처리를 구현하며, API Gateway로 요청 검증을 제공한다.
- Bedrock 스트리밍 API, WebSockets, Server-Sent Events, 청크 전송 인코딩으로 실시간 응답을 제공한다.
- AWS SDK 지수 백오프, API Gateway 속도 제한, 폴백, X-Ray 추적으로 복원력과 관찰성을 확보한다.
- 애플리케이션 코드 정적 라우팅, Step Functions 콘텐츠 기반 라우팅, 지표 기반 라우팅, API Gateway 요청 변환으로 모델 선택을 최적화한다.

## 작업 2.5: 애플리케이션 통합 패턴 및 개발 도구

- API Gateway, 토큰 제한 관리, 모델 타임아웃 재시도 전략으로 FM API 인터페이스를 만든다.
- AWS Amplify, OpenAPI, Bedrock Prompt Flows로 접근 가능한 AI 인터페이스와 노코드 워크플로를 구성한다.
- Lambda, Step Functions, Bedrock Data Automation으로 CRM, 문서 처리, 자동 데이터 처리 워크플로를 개선한다.
- Amazon Q Developer로 코드 생성, 리팩터링, API 지원, AI 구성 요소 테스트, 성능 최적화를 지원한다.
- Strands Agents, AWS Agent Squad, Step Functions, Bedrock 프롬프트 체인으로 고급 GenAI 애플리케이션을 만든다.
- CloudWatch Logs Insights, X-Ray, Amazon Q Developer로 프롬프트/응답 분석, FM API 호출 추적, 오류 패턴 인식을 수행한다.

## 출제 포인트

- “최소 운영 오버헤드” 문항에서는 관리형 기능, SDK, 스타터 도구 키트, 기본 통합 기능이 정답 후보가 된다.
- 배포 방식은 실시간, 비동기, 배치, GPU, 입력 크기, 응답 시간 제한을 기준으로 구분한다.
- API 통합은 동기/비동기/스트리밍, 재시도/백오프, 속도 제한, 폴백, 추적을 함께 묻는다.
- 엔터프라이즈 통합은 API Gateway, Lambda, EventBridge, Step Functions, IAM, CI/CD를 함께 엮는 문제가 많다.
