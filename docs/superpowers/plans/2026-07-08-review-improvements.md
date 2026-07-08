# drillup 리뷰 개선사항 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-07-08 구현 리뷰에서 확정된 개선사항 6건을 반영한다 — 커밋 메시지 한국어 규칙 명문화, UI 이모지 복원, `.env.example` 정리, README·docker-compose 정합성 복구, import 시 explanation trim, 문제 관리 화면 로딩 로직 중복 제거.

**Architecture:** 기존 구조 변경 없음. 문서/설정 정리 3건, 소규모 코드 수정 3건이며 각 태스크는 독립적으로 커밋 가능하다.

**Tech Stack:** 기존과 동일 (Next.js 16, Prisma 7 + @prisma/adapter-mariadb, vitest)

## Global Constraints

- `docs/superpowers/plans/2026-07-07-drillup/00-overview.md`의 Global Constraints를 그대로 준수한다 (TypeScript strict, `any` 금지, UI 문구 한국어, 오류 응답 형식 등).
- **AGENTS.md의 리포 규칙 준수: `master`에서 직접 작업하고, feature 브랜치·worktree를 만들지 않는다.**
- **커밋 메시지는 conventional commits 형식(`feat:`/`fix:`/`test:`/`chore:`/`docs:`)을 유지하되 제목·본문을 한국어로 작성한다.** (Task 1에서 규칙을 명문화하며, 이 계획의 모든 커밋이 이 규칙을 따른다.)
- 태스크마다 커밋한다. 여러 태스크를 하나의 커밋으로 묶지 않는다.
- 각 태스크 완료 시 검증 명령(`npm test`, `npx tsc --noEmit`, `npm run lint` 중 해당 태스크에 명시된 것)을 실제로 실행하고 통과를 확인한 뒤 커밋한다.
- `.env`는 절대 커밋하지 않는다. 커밋 전 `git status`로 스테이징 목록을 확인한다.

---

### Task 1: AGENTS.md에 커밋 메시지·이모지 규칙 명문화

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: 없음
- Produces: 이후 모든 작업(이 계획의 Task 2~6 포함)이 따를 커밋 메시지 한국어 규칙

**배경:** 기존 커밋 이력에 영어 제목 커밋(`feat: add domain core modules` 등)이 섞여 있다. 사용자가 커밋 메시지를 한국어로 통일하기를 원하며, UI 피드백 문구의 이모지(✅/❌/🎉)도 유지하기를 원한다. 에이전트가 항상 읽는 `AGENTS.md`에 규칙으로 남긴다.

- [ ] **Step 1: AGENTS.md 수정**

`AGENTS.md`의 `# Repository Instructions` 섹션 마지막 줄(`- Keep .env and other secret-bearing files out of git.`) 아래에 다음 두 줄을 추가한다:

```markdown
- Write commit messages in Korean (keep the conventional-commit type prefix in English: `feat:`, `fix:`, `test:`, `chore:`, `docs:`). One commit per task.
- Keep light emoji in user-facing feedback copy (e.g. ✅/❌ on answer results, 🎉 on completion). Do not strip them when editing UI text.
```

수정 후 파일 전체는 다음과 같아야 한다:

```markdown
<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Repository Instructions

- Work directly on `master` for this personal project unless the user explicitly says otherwise.
- Do not create a feature branch or git worktree for normal implementation tasks.
- Follow `docs/superpowers/plans/2026-07-07-drillup/00-overview.md` and the numbered plan files in order.
- Keep `.env` and other secret-bearing files out of git.
- Write commit messages in Korean (keep the conventional-commit type prefix in English: `feat:`, `fix:`, `test:`, `chore:`, `docs:`). One commit per task.
- Keep light emoji in user-facing feedback copy (e.g. ✅/❌ on answer results, 🎉 on completion). Do not strip them when editing UI text.
```

- [ ] **Step 2: 커밋**

```bash
git add AGENTS.md
git commit -m "docs: 커밋 메시지 한국어·UI 이모지 유지 규칙 추가"
```

---

### Task 2: 학습 화면 이모지 복원 (✅ / ❌ / 🎉)

**Files:**
- Modify: `src/components/ResultPanel.tsx`
- Modify: `src/app/study/page.tsx`

**Interfaces:**
- Consumes: 없음 (문구만 변경)
- Produces: 없음 (컴포넌트 시그니처 불변)

**배경:** 원 계획(`04-study.md`)의 UI 문구에는 정답/오답 판정에 ✅/❌, SRS 큐 완료 메시지에 🎉가 포함되어 있었으나 구현 과정에서 누락됐다. 원 계획대로 복원한다.

- [ ] **Step 1: ResultPanel의 판정 문구에 이모지 추가**

`src/components/ResultPanel.tsx`의 `resultTitle` 함수를 다음과 같이 수정한다:

기존:

```ts
function resultTitle(isCorrect: boolean): string {
  if (isCorrect) return "정답입니다";
  return "오답입니다";
}
```

변경:

```ts
function resultTitle(isCorrect: boolean): string {
  if (isCorrect) return "정답입니다 ✅";
  return "오답입니다 ❌";
}
```

- [ ] **Step 2: 학습 화면 완료 메시지에 이모지 추가**

`src/app/study/page.tsx`의 `completionMessage` 함수를 다음과 같이 수정한다:

기존:

```ts
function completionMessage(mode: "srs" | "practice"): string {
  if (mode === "srs") return "오늘 복습할 문제를 모두 끝냈습니다";
  return "풀 문제가 없습니다.";
}
```

변경:

```ts
function completionMessage(mode: "srs" | "practice"): string {
  if (mode === "srs") return "오늘 복습할 문제를 모두 끝냈습니다 🎉";
  return "풀 문제가 없습니다.";
}
```

- [ ] **Step 3: 타입·린트 확인**

```bash
npx tsc --noEmit
npm run lint
```

Expected: 둘 다 오류 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/components/ResultPanel.tsx src/app/study/page.tsx
git commit -m "feat: 학습 결과·완료 메시지에 이모지 복원(✅/❌/🎉)"
```

---

### Task 3: import 시 explanation 공백 정리 (TDD)

**Files:**
- Modify: `src/server/import-service.ts`
- Test: `src/server/import-service.test.ts` (기존 파일에 테스트 추가)

**Interfaces:**
- Consumes: `importQuestions(topicId: number, questions: ImportQuestion[]): Promise<number>` (기존 시그니처 불변)
- Produces: 없음 (동작만 보정 — 공백뿐인 explanation은 `null`, 양끝 공백은 trim 후 저장)

**배경:** 원 계획(`03-content-management.md` Task 4)은 `explanation: q.explanation?.trim() ? q.explanation.trim() : null`로 정의했으나, 구현은 `question.explanation ?? null`이어서 공백뿐인 문자열이 그대로 저장된다. 공백뿐인 해설은 풀이 결과 패널에서 truthy로 판정돼 빈 해설 영역이 렌더링되므로 계획대로 보정한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/server/import-service.test.ts`의 `describe("importQuestions", ...)` 블록 안, 기존 테스트들 뒤에 다음 두 테스트를 추가한다 (파일 상단의 `prismaMock`, `validMcq`는 이미 존재하는 것을 그대로 사용):

```ts
  it("공백뿐인 explanation은 null로 저장한다", async () => {
    await importQuestions(1, [{ ...validMcq, explanation: "   " }]);

    expect(prismaMock.question.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ explanation: null }),
      }),
    );
  });

  it("explanation의 양끝 공백을 제거해 저장한다", async () => {
    await importQuestions(1, [{ ...validMcq, explanation: "  해설  " }]);

    expect(prismaMock.question.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ explanation: "해설" }),
      }),
    );
  });
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/server/import-service.test.ts
```

Expected: FAIL — 새 테스트 2개가 실패한다 (`explanation: "   "` / `"  해설  "`가 그대로 저장됨).

- [ ] **Step 3: 구현 수정**

`src/server/import-service.ts`의 `importQuestions` 안 `tx.question.create` 호출에서 explanation 부분을 수정한다:

기존:

```ts
          explanation: question.explanation ?? null,
```

변경:

```ts
          explanation: question.explanation?.trim()
            ? question.explanation.trim()
            : null,
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/server/import-service.test.ts
```

Expected: 기존 2개 + 신규 2개 = 4 passed. (기존 테스트의 `explanation: "기본 덧셈입니다."`는 trim해도 동일하므로 그대로 통과해야 한다.)

전체 회귀 확인:

```bash
npm test
```

Expected: 전부 passed.

- [ ] **Step 5: 커밋**

```bash
git add src/server/import-service.ts src/server/import-service.test.ts
git commit -m "fix: 가져오기 시 explanation 양끝 공백 제거, 공백뿐이면 null 저장"
```

---

### Task 4: .env.example의 죽은 DATABASE_URL 정리 + README 안내 보강

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `prisma.config.ts`와 `src/server/db.ts`의 접속 구성 로직 (변경하지 않음 — 이 두 파일은 `DATABASE_URL`에 `${`가 포함되면 무시하고 `DB_*` 5개 값으로 접속을 구성한다)
- Produces: 없음 (문서/예시 파일만 변경)

**배경:** Prisma 7 전환으로 `.env` 안의 `${VAR}` 참조 확장을 쓰지 않게 되어, `.env.example`의 `DATABASE_URL="mysql://${DB_USER}:..."` 줄은 어느 코드 경로에서도 사용되지 않는 죽은 설정이다. 사용자가 이 줄을 채워야 한다고 오해할 수 있으므로 정리하고, README에 `DB_*`만 채우면 된다는 안내를 추가한다.

**주의:** `.env.example`만 수정한다. 실제 `.env`는 절대 건드리지 않는다.

- [ ] **Step 1: .env.example 전체 교체**

`.env.example`을 다음 내용으로 교체한다:

```
# ── MariaDB 접속 정보: 아래 5개 값만 채우면 된다 ──────────────
# (Prisma 7 드라이버 어댑터가 이 값들로 접속 URL을 자동 구성한다)
DB_HOST=""
DB_PORT="3306"
DB_USER=""
DB_PASSWORD=""
DB_NAME="drillup"

# (선택) 완성된 접속 URL을 직접 쓰고 싶을 때만 주석을 풀고 채운다.
# 이 값이 있으면 DB_* 값보다 우선한다. 비밀번호의 특수문자는 URL 인코딩할 것.
# DATABASE_URL="mysql://user:password@host:3306/drillup"

APP_PASSWORD=""
SESSION_SECRET=""
```

- [ ] **Step 2: README 환경변수 안내 보강**

`README.md`의 환경변수 안내 블록을 수정한다.

기존:

```
    # 2. 환경변수 - .env.example을 복사한 뒤 자신의 MariaDB 접속 정보를 직접 입력
    #    DB_HOST(IP) / DB_PORT / DB_USER(ID) / DB_PASSWORD(PW) / DB_NAME
    #    + APP_PASSWORD / SESSION_SECRET
    copy .env.example .env
```

변경:

```
    # 2. 환경변수 - .env.example을 복사한 뒤 자신의 MariaDB 접속 정보를 직접 입력
    #    DB_HOST(IP) / DB_PORT / DB_USER(ID) / DB_PASSWORD(PW) / DB_NAME
    #    + APP_PASSWORD / SESSION_SECRET
    #    (DATABASE_URL은 채울 필요 없다 - DB_* 값으로 자동 구성된다)
    copy .env.example .env
```

- [ ] **Step 3: 동작 확인**

`.env.example`은 코드가 읽지 않으므로 빌드 영향이 없다. 접속 구성 로직이 여전히 유효한지 전체 테스트로 확인한다:

```bash
npm test
```

Expected: 전부 passed.

`git status`로 `.env`가 스테이징에 없는지 확인한다.

- [ ] **Step 4: 커밋**

```bash
git add .env.example README.md
git commit -m "chore: .env.example의 미사용 DATABASE_URL 정리 및 README 환경변수 안내 보강"
```

---

### Task 5: docker-compose.yml 추가 (README 정합성 복구)

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: 없음
- Produces: `docker compose up -d`로 기동 가능한 로컬 MariaDB (계정: `drillup`/`drillup`, DB: `drillup`, 포트 3306)

**배경:** README가 "(선택) 쓸 MariaDB가 없으면 로컬 도커 DB 기동"으로 `docker compose up -d`를 안내하지만 compose 파일이 리포에 없다. 원 계획(`01-foundation.md` Task 2 Step 3)에 정의된 내용 그대로 추가해 README와 리포를 일치시킨다. **접속 정보의 진실의 원천은 여전히 `.env`다** — compose는 어디까지나 선택 사항이다.

- [ ] **Step 1: docker-compose.yml 작성**

프로젝트 루트에 `docker-compose.yml` 생성:

```yaml
services:
  db:
    image: mariadb:11
    environment:
      MARIADB_ROOT_PASSWORD: root
      MARIADB_DATABASE: drillup
      MARIADB_USER: drillup
      MARIADB_PASSWORD: drillup
    ports:
      - "3306:3306"
    volumes:
      - drillup-db:/var/lib/mysql

volumes:
  drillup-db:
```

- [ ] **Step 2: 검증**

Docker Desktop이 실행 중이면 다음으로 구문 검증한다 (컨테이너를 실제로 띄울 필요는 없다):

```bash
docker compose config
```

Expected: 파싱된 구성이 출력되고 오류 없음. Docker가 없는 환경이면 이 스텝은 건너뛴다 (YAML 들여쓰기를 육안 확인).

- [ ] **Step 3: 커밋**

```bash
git add docker-compose.yml
git commit -m "chore: 로컬 개발용 MariaDB docker-compose.yml 추가(README 안내와 정합)"
```

---

### Task 6: 문제 관리 화면 로딩 로직 중복 제거

**Files:**
- Modify: `src/app/questions/page.tsx`

**Interfaces:**
- Consumes: `api.topics.list()`, `api.questions.list(topicId?)` (변경 없음)
- Produces: 없음 (화면 동작 동일 — 목록 로드/필터/삭제/이름변경 흐름 유지)

**배경:** 현재 `reload` 콜백과 `useEffect` 안의 `load()` 함수가 같은 로딩 로직을 두 벌 갖고 있고, effect는 `reload`를 쓰지 않으면서 deps에만 넣어 두었다. `reload` 하나로 통합하되, 기존 effect가 갖고 있던 "언마운트/재요청 시 낡은 응답 무시" 가드는 요청 ID 방식으로 유지한다.

- [ ] **Step 1: 로딩 로직 통합**

`src/app/questions/page.tsx`를 수정한다.

import 문 변경 — 기존:

```tsx
import { useCallback, useEffect, useState } from "react";
```

변경:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
```

컴포넌트 상단의 `reload` 정의와 `useEffect` 블록 전체(현재 `const reload = useCallback(...)` 부터 `}, [topicId, reload]);` 까지)를 다음으로 교체한다:

```tsx
  const requestIdRef = useRef(0);

  const reload = useCallback(async (selectedTopicId: number | "") => {
    const requestId = ++requestIdRef.current;
    try {
      const [topicList, questionList] = await Promise.all([
        api.topics.list(),
        api.questions.list(selectedTopicId === "" ? undefined : selectedTopicId),
      ]);
      if (requestId !== requestIdRef.current) return;
      setTopics(topicList);
      setQuestions(questionList);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setMessage(
        error instanceof Error ? error.message : "목록을 불러오지 못했습니다",
      );
    }
  }, []);

  useEffect(() => {
    reload(topicId);
  }, [topicId, reload]);
```

`removeQuestion` / `renameTopic` / `removeTopic`의 기존 `await reload(...)` 호출부는 수정하지 않는다 (통합된 `reload`는 내부에서 오류를 처리하므로 그대로 동작한다).

- [ ] **Step 2: 타입·린트 확인**

```bash
npx tsc --noEmit
npm run lint
```

Expected: 둘 다 오류 없음 (특히 `react-hooks/exhaustive-deps` 경고가 없어야 한다).

- [ ] **Step 3: 수동 검증**

`npm run dev` 상태에서 브라우저 `/questions`:

1. 목록이 표시된다
2. 주제 필터 셀렉트를 바꾸면 해당 주제의 문제만 표시된다 (빠르게 두 번 바꿔도 마지막 선택 기준으로 표시)
3. 문제 "삭제" → confirm 후 목록에서 사라진다
4. 주제 선택 후 "주제 이름 변경" → 반영된다

- [ ] **Step 4: 최종 전체 검증 및 커밋**

이 계획의 마지막 태스크이므로 전체 검증을 수행한다:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: 전부 통과.

```bash
git add src/app/questions/page.tsx
git commit -m "chore: 문제 관리 화면 목록 로딩 로직 중복 제거"
```
