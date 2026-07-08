# 주제별 참고 자료 기반 문제 생성 설계

날짜: 2026-07-09
상태: 승인됨
선행 문서: `2026-07-08-ai-generation-design.md`, `2026-07-08-generation-verify-dedup-design.md`
관련 문서: `docs/aip-c01-reference-data.md` (AIP-C01 참고 데이터 가이드)

## 1. 목표

주제(topic)에 참고 자료 폴더를 연결하고, AI 문제 생성(`/generate`) 시 CLI 에이전트가
그 폴더의 파일을 직접 읽어 **자료에 근거해서만** 문제를 출제·검증하게 한다.

동기: AWS AIP-C01처럼 최신이라 모델 학습 데이터가 부족한 시험은 모델 기억만으로는
정확한 문제를 만들 수 없다. 근거 자료를 주입해 생성 정확도와 교차 검증 정확도를
함께 끌어올린다.

핵심 결정 사항:

- **범용 기능**: AIP-C01 전용 하드코딩이 아니라 "주제에 참고 자료를 붙이는" 범용
  기능. AIP-C01은 첫 사용 사례 (자료 구성은 `docs/aip-c01-reference-data.md` 참조)
- **문제 유형은 기존 유지**: MCQ(4지선다)·CLOZE 그대로. 시나리오는 질문 텍스트에
  담고, choose-TWO류는 단일 정답으로 변형 출제
- **자료 제공 방식**: 폴더 규약 + 에이전트가 파일을 직접 읽기. 업로드 UI 없음,
  프롬프트에는 파일 경로만 들어가므로 자료가 커져도 토큰 폭발 없음
- **주제-폴더 연결**: `Topic.referenceDir` 필드 (참고 자료 루트 기준 상대 폴더)
- **파일 선택**: `/generate`에서 파일 체크박스 (기본 전체 체크) — 도메인·범위 집중
  출제 가능
- **검증도 근거 기반**: 검증 프롬프트에도 같은 파일 목록을 주입

## 2. 데이터 모델 (Prisma)

기존 모델에 컬럼 2개 추가, 새 모델 없음:

```prisma
model Topic {
  // ...기존 필드...
  referenceDir String? @map("reference_dir") // 예: "aip-c01" — 참고 자료 루트 기준 상대 폴더
}

model GenerationJob {
  // ...기존 필드...
  referenceFiles Json? @map("reference_files") // 이 잡에 사용한 파일 상대 경로 배열 (기록·검증 재사용)
}
```

- 참고 자료 루트: 프로젝트 루트의 `generation_reference/` 고정, 환경변수
  `GENERATION_REFERENCE_DIR`로 재정의 가능
- `generation_reference/`는 `.gitignore`에 등록 — 저작권 자료가 들어가므로 커밋 금지
- `referenceDir`가 null인 주제는 기존과 완전히 동일하게 동작

## 3. 참고 자료 서비스 + API

`src/server/generation/reference.ts`:

- `listReferenceFiles(referenceDir)` — 루트 아래 해당 폴더를 **재귀** 스캔,
  `.md`/`.txt`만 상대 경로+크기로 반환. 경로 탈출(`..`, 절대 경로) 거부
- `resolveReferenceFiles(referenceDir, selected[])` — 생성 시점에 선택 파일들의
  존재를 검증하고 **절대 경로**로 변환. 없는 파일이 있으면 오류

경로 안전성 판정은 순수 함수(`isSafeReferencePath` 등)로 `src/core/`에 두어 단위
테스트한다.

API:

- **추가** `GET /api/topics/[id]/reference-files` →
  `{ files: [{ path, size }], dirExists: boolean }`. 폴더 미존재는 오류가 아니라
  `dirExists: false` (화면에서 안내만)
- **확장** `PATCH /api/topics/[id]` — `referenceDir` 수정 허용, topics DTO에 노출
- **확장** `POST /api/generate` — `referenceFiles: string[]` 추가 (빈 배열 허용 =
  자료 없이 생성). zod로 상대 경로 형식 검증

Route Handler는 얇게(zod 파싱 → 서비스 호출), 화면은 `api-client` 경유 — 기존
Global Constraints 유지.

## 4. 프롬프트 확장 (`src/core/prompt-template.ts`)

**생성 프롬프트** — `buildCliGenerationPrompt`에 참고 자료 섹션 추가 (선택 파일이
있을 때만, 절대 경로 나열):

```
## 참고 자료 (반드시 먼저 읽을 것)

문제를 만들기 전에 아래 파일들을 모두 읽으세요:
- C:\work\drillup\generation_reference\aip-c01\common\00-exam-guide.md
- ...

- 문제와 정답의 사실 관계는 반드시 위 자료 내용에 근거해야 합니다.
- 자료에 없는 내용을 기억이나 추측으로 출제하지 마세요.
- 자료와 당신의 기억이 다르면 자료를 우선하세요.
- 읽을 수 없는 파일이 있으면 그 파일은 무시하고 진행하세요.
```

**검증 프롬프트** — `buildCliVerifyPrompt`에도 같은 파일 목록 주입: "정답 정확성
판정 전에 아래 참고 자료를 먼저 읽고 근거로 삼을 것." 잡에 저장된
`referenceFiles`를 절대 경로로 변환해 재사용한다. 신규 시험에서는 검증 엔진도
기억이 없으므로 이것이 교차 검증 정확도를 좌우한다.

## 5. 화면

- **주제 관리**: 주제 수정 폼에 "참고 자료 폴더" 텍스트 입력 1개 추가 (빈 값 허용)
- **`/generate`**: 주제 선택 시 `referenceDir`가 있으면 파일 목록을 불러와 체크박스
  목록 표시 (기본 전체 체크). 폴더가 없거나 비었으면 "참고 자료 없음 —
  generation_reference/<폴더>/에 md 파일을 넣으세요" 안내. 선택 파일 경로가 잡 생성
  요청에 포함됨
- 미리보기·저장·검증 배지 등 나머지 흐름은 변경 없음

## 6. 오류 처리

| 상황 | 처리 |
|---|---|
| `referenceDir` 경로 탈출 시도 (`..`, 절대 경로) | 400 VALIDATION |
| 폴더 미존재 / 빈 폴더 | 화면 안내만, 자료 없이 생성 가능 |
| 선택 파일이 잡 생성 시점에 없음 | 400 REFERENCE_FILE_NOT_FOUND (목록 새로고침 유도) |
| 잡 실행 중 파일 삭제 | 프롬프트의 "읽을 수 없는 파일은 무시" 지시로 진행 |

## 7. 테스트

vitest, core 단위 테스트만 자동화 (프로젝트 규약: 서비스 계층은 수동 검증).

- `prompt-template.test.ts` 확장 — 생성/검증 프롬프트: 파일 목록 포함, 빈 목록이면
  섹션 생략, 근거 우선·파일 무시 지시 포함 여부
- 경로 안전성 순수 함수 테스트 — `..`·절대 경로·정상 상대 경로 케이스
- 수동 검증: AIP-C01 자료 몇 개를 `generation_reference/aip-c01/`에 넣고 실제
  생성 → 검증 → 미리보기 → 저장 1회 (브라우저)
