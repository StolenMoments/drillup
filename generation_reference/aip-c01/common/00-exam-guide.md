# AIP-C01 공식 시험 가이드 요약

> 스냅샷: 2026-07 기준  
> 출처 기반: `docs/AIP-C01 시험범위.txt`  
> 용도: 문제 생성 시 공식 출제 범위, 도메인 비중, task statement, 범위 내 AWS 서비스를 제한하는 공통 참고 자료

## 시험 개요

AWS Certified Generative AI Developer - Professional(AIP-C01)은 생성형 AI 애플리케이션을 AWS에서 설계, 구현, 운영, 보안, 검증하는 능력을 평가한다.

| 도메인 | 비중 |
|---|---:|
| D1. Foundation Model Integration, Data Management, and Compliance | 31% |
| D2. Implementation and Integration | 26% |
| D3. AI Safety, Security, and Governance | 20% |
| D4. Operational Efficiency and Optimization for GenAI Applications | 12% |
| D5. Testing, Validation, and Troubleshooting | 11% |

## 전체 출제 개념

- 검색 증강 생성(RAG)
- 벡터 데이터베이스 및 임베딩
- 프롬프트 엔지니어링 및 관리
- 파운데이션 모델(FM) 통합
- 에이전틱 AI 시스템
- 책임 있는 AI 사례
- 콘텐츠 안전 및 조정
- 모델 평가 및 검증
- AI 워크로드 비용 최적화
- AI 애플리케이션 성능 튜닝
- AI 시스템 모니터링 및 관찰성
- AI 애플리케이션 보안 및 거버넌스
- API 설계 및 통합 패턴
- 이벤트 기반 아키텍처
- 서버리스 컴퓨팅
- 컨테이너 오케스트레이션
- 코드형 인프라(IaC)
- AI 애플리케이션 CI/CD
- 하이브리드 클라우드 아키텍처
- 엔터프라이즈 시스템 통합

## 도메인별 task statement

### D1. Foundation Model Integration, Data Management, and Compliance

- 요구 사항을 분석하고 GenAI 솔루션을 설계한다.
- FM을 선택하고 구성한다.
- FM 사용을 위한 데이터 검증 및 처리 파이프라인을 구현한다.
- 벡터 저장소 솔루션을 설계하고 구현한다.
- FM 증강을 위한 검색 메커니즘을 설계한다.
- FM 상호 작용을 위한 프롬프트 엔지니어링 전략 및 거버넌스를 구현한다.

### D2. Implementation and Integration

- 에이전틱 AI 솔루션 및 도구 통합을 구현한다.
- 모델 배포 전략을 구현한다.
- 엔터프라이즈 통합 아키텍처를 설계하고 구현한다.
- FM API 통합을 구현한다.
- 애플리케이션 통합 패턴 및 개발 도구를 구현한다.

### D3. AI Safety, Security, and Governance

- 입력 및 출력 안전 제어를 구현한다.
- 데이터 보안 및 개인 정보 보호 제어를 구현한다.
- AI 거버넌스 및 규정 준수 메커니즘을 구현한다.
- 책임 있는 AI 원칙을 구현한다.

### D4. Operational Efficiency and Optimization for GenAI Applications

- 비용 최적화 및 리소스 효율성 전략을 구현한다.
- 애플리케이션 성능을 최적화한다.
- GenAI 애플리케이션을 위한 모니터링 시스템을 구현한다.

### D5. Testing, Validation, and Troubleshooting

- GenAI용 평가 시스템을 구현한다.
- GenAI 애플리케이션 문제를 해결한다.

## 범위 내 AWS 서비스

### 분석

- Amazon Athena
- Amazon EMR
- AWS Glue
- Amazon Kinesis
- Amazon OpenSearch Service
- Amazon QuickSight
- Amazon Managed Streaming for Apache Kafka(Amazon MSK)

### 애플리케이션 통합

- Amazon AppFlow
- AWS AppConfig
- Amazon EventBridge
- Amazon SNS
- Amazon SQS
- AWS Step Functions

### 컴퓨팅

- AWS App Runner
- Amazon EC2
- AWS Lambda
- AWS Lambda@Edge
- AWS Outposts
- AWS Wavelength

### 컨테이너

- Amazon ECR
- Amazon ECS
- Amazon EKS
- AWS Fargate

### 고객 지원

- Amazon Connect

### 데이터베이스

- Amazon Aurora
- Amazon DocumentDB
- Amazon DynamoDB
- Amazon DynamoDB Streams
- Amazon ElastiCache
- Amazon Neptune
- Amazon RDS

### 개발자 도구

- AWS Amplify
- AWS CDK
- AWS CLI
- AWS CloudFormation
- AWS CodeArtifact
- AWS CodeBuild
- AWS CodeDeploy
- AWS CodePipeline
- Kiro
- AWS 도구 및 SDK
- AWS X-Ray

### 기계 학습

- Amazon Augmented AI
- Amazon Bedrock
- Amazon Bedrock AgentCore
- Amazon Bedrock Knowledge Bases
- Amazon Bedrock Prompt Management
- Amazon Bedrock Prompt Flows
- Amazon Comprehend
- Amazon Kendra
- Amazon Lex
- Amazon Q Business
- Amazon Q Business Apps
- Amazon Q Developer
- Amazon Quick
- Amazon Rekognition
- Amazon SageMaker AI
- Amazon SageMaker Clarify
- Amazon SageMaker Data Wrangler
- Amazon SageMaker Ground Truth
- Amazon SageMaker JumpStart
- Amazon SageMaker Model Monitor
- Amazon SageMaker Model Registry
- Amazon SageMaker Neo
- Amazon SageMaker Processing
- Amazon SageMaker Unified Studio
- Amazon Textract
- Amazon Titan
- Amazon Transcribe

### 관리 및 거버넌스

- AWS Auto Scaling
- AWS Chatbot
- AWS CloudTrail
- Amazon CloudWatch
- Amazon CloudWatch Logs
- Amazon CloudWatch Synthetics
- AWS Cost Anomaly Detection
- AWS Cost Explorer
- Amazon Managed Grafana
- AWS Service Catalog
- AWS Systems Manager
- AWS Well-Architected Tool

### 마이그레이션 및 전송

- AWS DataSync
- AWS Transfer Family

### 네트워킹 및 콘텐츠 전송

- Amazon API Gateway
- AWS AppSync
- Amazon CloudFront
- Elastic Load Balancing(ELB)
- AWS Global Accelerator
- AWS PrivateLink
- Amazon Route 53
- Amazon VPC

### 보안, ID 및 규정 준수

- Amazon Cognito
- AWS Encryption SDK
- IAM
- IAM Access Analyzer
- IAM Identity Center
- AWS KMS
- Amazon Macie
- AWS Secrets Manager
- AWS WAF

### 스토리지

- Amazon EBS
- Amazon EFS
- Amazon S3
- Amazon S3 Intelligent-Tiering
- Amazon S3 수명 주기 정책
- Amazon S3 크로스 리전 복제

## 문제 생성 제약

- 정답 근거는 위 도메인, task statement, 범위 내 서비스에서 벗어나지 않는다.
- 서비스 이름은 AWS 공식 서비스명 또는 시험에서 쓰는 약칭을 사용한다.
- 최신 GenAI 기능은 모델 기억에 의존하지 말고 제공된 reference 파일에 있는 내용만 근거로 한다.
- 도메인 비중을 반영한다. D1과 D2의 출제량을 가장 크게 두고, D5는 적지만 평가/문제 해결 포인트를 명확히 낸다.
