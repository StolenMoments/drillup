# drillup — 개인용 문제은행 PWA 설계서

작성일: 2026-07-07

## 1. 개요

혼자 쓰는 문제은행 웹/모바일 앱. 주제별 문제를 LLM(외부 채팅, 예: ChatGPT/Claude)으로 생성해
JSON으로 가져와 DB에 저장하고, SRS(간격 반복) 기반으로 반복 학습하여 암기한다.

### 목표

- 주제(topic)를 자유롭게 추가하고, 주제별로 문제를 축적한다.
- 문제 유형 2가지 지원: **객관식 4지선다(MCQ)**, **설명문 빈칸 채우기(CLOZE)**.
- LLM이 생성한 JSON을 붙여넣기로 가져와 검증 후 저장한다.
- SM-2 단순화 버전의 SRS로 "오늘의 복습" 큐를 제공하고, 스케줄과 무관한 자유 연습 모드를 제공한다.
- 반응형 웹 + PWA(홈 화면 설치)로 데스크톱/모바일 모두 지원한다.

### 비목표 (v1 범위 외)

- 멀티유저 / 회원가입
- 앱 내 LLM API 호출(문제 생성은 외부 채팅에서 수행)
- 오프라인 학습(PWA는 설치 편의 목적, 온라인 전용)
- MCQ/CLOZE 외 문제 유형
- 상세 통계(일별 그래프, streak 등)
- 인프라 자동화(배포 스크립트, CI/CD) — 별도 단계에서 진행

## 2. 기술 스택

| 구성 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | Next.js (App Router, TypeScript) | 프론트 + API 단일 코드베이스, Node 프로세스 1개 |
| DB | MariaDB | 오라클 클라우드 무료 인스턴스에서 구동 |
| ORM | Prisma | 스키마 관리 + 마이그레이션 |
| 검증 | zod | import JSON 및 API 입력 검증 |
| PWA | manifest + 서비스 워커 | 설치 가능, 오프라인 캐시는 정적 자원만 |
| 테스트 | vitest | core 모듈 단위 테스트 |

## 3. 아키텍처

### 3.1 계층 구조 — 백엔드 분리 대비

추후 별도 REST API 백엔드 인스턴스로 분리할 가능성이 있으므로, 처음부터 계층을 나눈다.

```
src/
  core/              # 순수 도메인 로직 — 프레임워크·DB 무관 (SRS 엔진, 채점, import 스키마)
  server/            # 서비스 계층 — Prisma 데이터 접근, core 조합 (Next.js 무관)
  app/               # Next.js 화면(React) + app/api/*/route.ts (얇은 HTTP 어댑터)
  lib/api-client.ts  # 프론트 전용 typed API 클라이언트 (모든 fetch의 단일 통로)
```

전환 유연성 원칙:

1. **Route Handler는 얇게**: 요청 파싱 → `server/` 서비스 호출 → JSON 응답만 담당.
   비즈니스 로직을 라우트에 두지 않는다. 백엔드 분리 시 `core/` + `server/`를 그대로 옮기고
   어댑터만 새로 작성한다.
2. **REST 리소스 규약 준수**: API 표면을 리소스 중심(`/api/topics`, `/api/questions`, …)으로
   설계하여 분리된 백엔드가 동일한 API를 1:1로 이어받을 수 있게 한다.
3. **프론트는 API 클라이언트 단일 경유**: 화면 코드는 `lib/api-client.ts`만 사용하고 fetch를
   직접 호출하지 않는다. base URL은 환경변수(`NEXT_PUBLIC_API_BASE_URL`, 기본값 same-origin)로
   설정한다. 서버 컴포넌트에서 `server/` 서비스를 직접 호출하는 지름길은 금지한다
   (데이터 경로가 둘로 갈라지면 전환이 어려워짐).
4. **채점은 서버에서**: 답안을 API로 보내면 서버가 채점하고 SRS 상태를 갱신한 뒤
   정답·해설을 응답한다. 채점/스케줄 로직이 한 곳에 모인다.

### 3.2 데이터 흐름

```
[LLM 채팅에서 JSON 생성] → 가져오기 화면에 붙여넣기 → zod 검증 → 미리보기 → POST /api/import
[학습] GET /api/study/queue → 문제 표시 → POST /api/reviews (답안) → 채점 + SRS 갱신 → 정답/해설 표시
```

## 4. 데이터 모델 (MariaDB)

### 4.1 테이블

**topic** — 주제

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | BIGINT AUTO_INCREMENT PK | |
| name | VARCHAR(100) UNIQUE | |
| description | TEXT NULL | |
| created_at | DATETIME | |

**question** — 문제. 공통 속성은 컬럼, 유형별 상세는 JSON

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | BIGINT AUTO_INCREMENT PK | |
| topic_id | BIGINT FK → topic | |
| type | ENUM('MCQ','CLOZE') | |
| payload | JSON | 유형별 상세(4.2 참조) |
| explanation | TEXT NULL | 해설 |
| created_at / updated_at | DATETIME | |

유형별 상세를 JSON 컬럼에 두는 이유: LLM 출력 JSON을 거의 그대로 저장할 수 있고,
새 문제 유형 추가 시 스키마 변경이 최소화된다. 무결성은 저장 전 zod 검증으로 보장한다.

**srs_state** — 문제별 SRS 상태 (question과 1:1)

| 컬럼 | 타입 | 기본값 |
|---|---|---|
| question_id | BIGINT PK, FK → question | |
| ease_factor | DECIMAL(3,2) | 2.50 |
| interval_days | INT | 0 |
| repetitions | INT | 0 |
| lapses | INT | 0 |
| due_at | DATETIME | 생성 즉시(신규 문제는 바로 출제 대상) |
| last_reviewed_at | DATETIME NULL | |

**review_log** — 풀이 이력 (통계·디버깅용, SRS 계산에는 미사용)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | BIGINT AUTO_INCREMENT PK | |
| question_id | BIGINT FK → question | |
| mode | ENUM('SRS','PRACTICE') | |
| is_correct | BOOLEAN | |
| answer | JSON NULL | 제출한 답 원본 |
| created_at | DATETIME | |

### 4.2 문제 payload 구조

**MCQ**

```json
{
  "question": "OSI 7계층에서 라우팅을 담당하는 계층은?",
  "choices": ["물리 계층", "데이터링크 계층", "네트워크 계층", "전송 계층"],
  "answer_index": 2
}
```

**CLOZE** — 설명문에 `{{n}}` 자리표시자, 공용 단어은행에서 골라 배치

```json
{
  "text": "TCP는 {{1}} 지향 프로토콜로, {{2}} 핸드셰이크로 연결을 수립한다.",
  "blanks": [
    { "id": 1, "answer": "연결" },
    { "id": 2, "answer": "3-way" }
  ],
  "distractors": ["비연결", "4-way", "세그먼트"]
}
```

- 렌더링 시 단어은행 = `blanks[].answer` + `distractors`를 합쳐 셔플.
- 한 설명문에 빈칸 1~N개. 모든 빈칸을 맞혀야 정답 처리.

## 5. LLM 문제 생성(가져오기) 흐름

1. 가져오기 화면에서 주제를 선택(또는 새로 생성)한다.
2. **프롬프트 템플릿 복사** 버튼: 선택한 주제명과 아래 import JSON 스키마 설명이 포함된
   프롬프트가 클립보드에 복사된다. 사용자는 여기에 내용 지시(범위, 난이도, 개수 등)를
   덧붙여 LLM 채팅에 사용한다.
3. LLM이 출력한 JSON을 텍스트 영역에 붙여넣는다.
4. zod로 검증한다. 오류는 **문제 단위**로 표시한다(몇 번째 문제의 어떤 필드가 왜 잘못됐는지).
   유효한 문제만 선택하여 저장할 수 있다(전체 거부 아님).
5. 미리보기(실제 풀이 화면과 같은 렌더링)로 확인 후 저장한다.

### import JSON 스키마

주제는 화면에서 선택하므로 JSON에는 문제 배열만 담는다.

```json
{
  "questions": [
    {
      "type": "mcq",
      "question": "질문 텍스트",
      "choices": ["보기1", "보기2", "보기3", "보기4"],
      "answer_index": 0,
      "explanation": "해설 (선택)"
    },
    {
      "type": "cloze",
      "text": "빈칸 {{1}}이 포함된 설명문 {{2}}",
      "blanks": [{ "id": 1, "answer": "정답1" }, { "id": 2, "answer": "정답2" }],
      "distractors": ["오답1", "오답2"],
      "explanation": "해설 (선택)"
    }
  ]
}
```

검증 규칙:

- `mcq`: `choices`는 정확히 4개, `answer_index`는 0~3, 보기 중복 금지
- `cloze`: `text`의 `{{n}}` 집합과 `blanks[].id` 집합이 정확히 일치, `distractors` 1개 이상,
  단어은행(정답+오답) 내 중복 단어 금지
- 공통: 텍스트 필드 공백만 있는 값 금지

## 6. 학습 방식 (SRS)

### 6.1 SM-2 단순화 규칙

자동 채점(정답/오답)이므로 SM-2의 자기 평가 단계를 다음과 같이 매핑한다.

- **정답 시**: `repetitions += 1`, interval은 1회차 1일 → 2회차 3일 → 이후 `round(interval × ease_factor)`.
  `ease_factor` 유지. `due_at = 오늘 + interval`.
- **오답 시**: `repetitions = 0`, `interval = 0`, `ease_factor = max(1.3, ease_factor − 0.2)`,
  `lapses += 1`, `due_at`은 당일 유지 → 같은 세션에서 큐 뒤로 보내 재출제.
- 신규 문제는 `due_at = 생성 시각`으로 바로 출제 대상이 된다.

### 6.2 학습 모드

- **오늘의 복습(SRS)**: `due_at <= now`인 문제를 due 오래된 순으로 출제. 밀린 복습은 그냥
  큐에 쌓인다(하루 상한 등 복잡한 규칙 없음). 주제 필터 가능.
- **자유 연습(PRACTICE)**: 주제를 선택해 랜덤 출제. SRS 상태를 변경하지 않고
  `review_log`에만 기록한다. 오늘치를 다 풀었거나 특정 주제를 집중 연습할 때 사용.

### 6.3 진척도 분류 (통계용)

- **미학습**: `repetitions = 0`이고 풀이 이력 없음
- **학습 중**: `interval_days < 21`
- **암기 완료**: `interval_days >= 21`

## 7. 화면 구성

| # | 화면 | 내용 |
|---|---|---|
| 1 | 로그인 | 비밀번호 입력 → 장기 세션 쿠키 발급 |
| 2 | 대시보드 | 오늘 복습할 문제 수(주제별), 주제 목록 + 진척도 요약, 학습 시작 버튼 |
| 3 | 학습 | 문제 표시 → 답 선택/배치 → 제출 → 즉시 채점 + 해설 → 다음 문제. SRS/연습 모드 공용 UI |
| 4 | 가져오기 | 주제 선택·생성, 프롬프트 템플릿 복사, JSON 붙여넣기, 검증 결과, 미리보기, 저장 |
| 5 | 문제 관리 | 주제별 문제 목록, 개별 수정(payload 편집)·삭제 |
| 6 | 통계 | 주제별 진척도(미학습/학습 중/암기 완료 비율), 문제별 정답률 목록 |

모바일 우선 반응형. 학습 화면은 한 손 조작을 고려해 답안 버튼을 하단에 배치한다.

## 8. API 설계 (REST)

| 메서드·경로 | 역할 |
|---|---|
| POST `/api/auth/login` | 비밀번호 확인 → 세션 쿠키 발급 |
| POST `/api/auth/logout` | 세션 종료 |
| GET / POST `/api/topics` | 주제 목록 / 생성 |
| PATCH / DELETE `/api/topics/:id` | 주제 수정 / 삭제(소속 문제 함께 삭제) |
| GET `/api/questions?topicId=&page=` | 문제 목록(관리용) |
| GET / PATCH / DELETE `/api/questions/:id` | 문제 조회 / 수정 / 삭제 |
| POST `/api/import` | `{ topicId, questions[] }` 검증 후 일괄 저장 |
| GET `/api/study/queue?mode=srs\|practice&topicId=` | 출제할 문제 목록(정답 미포함) |
| POST `/api/reviews` | `{ questionId, mode, answer }` → 채점, SRS 갱신, 정답·해설 응답 |
| GET `/api/stats/overview` | 대시보드·통계 데이터 |

- 출제 응답에는 정답을 포함하지 않는다(채점은 서버에서).
- CLOZE 출제 시 단어은행은 서버에서 셔플하여 내려준다.

## 9. 인증

- 환경변수 `APP_PASSWORD`에 설정한 비밀번호 하나로 로그인.
- 로그인 성공 시 서명된(HMAC) 세션 쿠키를 90일 만료로 발급.
- Next.js middleware가 로그인 화면과 로그인 API를 제외한 모든 경로(화면 + API)를 보호.

## 10. 에러 처리

- import 검증 실패: 문제 단위로 오류 위치·사유 표시, 유효한 문제만 선택 저장 가능.
- API 오류 응답은 `{ error: { code, message } }` 형식으로 통일.
- DB 연결 실패 등 서버 오류는 화면에 재시도 안내 표시.

## 11. 테스트

- `core/` 모듈 단위 테스트(vitest): SRS 상태 전이(정답/오답/경계값), MCQ·CLOZE 채점,
  import zod 스키마(정상/오류 케이스).
- `server/` 서비스는 핵심 흐름(큐 조회, 리뷰 제출) 위주로 테스트.
- UI는 v1에서 수동 확인(혼자 사용).

## 12. 확정된 주요 결정 사항

| 결정 | 선택 | 이유 |
|---|---|---|
| 앱 형태 | 반응형 웹 + PWA | 코드베이스 하나로 웹/모바일 커버 |
| 문제 생성 | 외부 LLM 채팅 + JSON 붙여넣기 | API 비용 없음, v1 단순화 |
| 출제 방식 | SRS(SM-2 단순화) + 자유 연습 | 암기 효율 최우선 |
| CLOZE 형식 | 여러 빈칸 + 공용 단어은행 | 문맥 암기에 효과적 |
| 스택 | Next.js 풀스택 + MariaDB + Prisma | 프로세스 1개, 무료 인스턴스 적합 |
| 백엔드 분리 대비 | core/server 계층 분리 + REST 규약 + API 클라이언트 단일 경유 | 추후 별도 REST 백엔드 전환 유연성 |
| 인증 | 단일 비밀번호 + 서명 쿠키 | 유저 테이블 없이 충분한 보호 |
| 통계 | 기본 수준(진척도, 정답률) | 동기부여에 충분, 구현 부담 적음 |
