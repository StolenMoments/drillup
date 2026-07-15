# 선지 검토 상태별 페이지네이션 Implementation Plan

**Goal:** `/hardening`은 상태별 최신 5건만 보여주고, 각 상태의 전체 작업은 서버
페이지네이션 상세 화면에서 10건씩 조회한다.

**Architecture:** DTO와 API 클라이언트에 요약/상세 계약을 분리한다. 서비스는 상태별
Prisma 조건과 정렬을 공통 정의하고 요약은 `take: 5`, 상세는 `count` 후 보정한
`skip/take`를 사용한다. UI는 공유 상태 목록 렌더러와 요청 순번 가드가 있는 가시성
폴링 훅을 요약/상세에서 재사용한다.

**Spec:** `docs/superpowers/specs/2026-07-15-choice-hardening-status-pagination-design.md`

## Task 1: 서비스와 API 계약

- [x] 상태/요약 그룹/요약/페이지 DTO를 추가한다.
- [x] 상태별 조건·정렬을 공통화하고 요약 5건과 전체 건수를 조회한다.
- [x] 상세 10건, 페이지 정규화와 초과 페이지 보정을 구현한다.
- [x] Route Handler에서 요약/상세 요청을 분기하고 잘못된 상태를 400 처리한다.
- [x] `api.hardenJobs.list()`를 `summary()`와 `page()`로 교체한다.

## Task 2: 요약과 상세 화면

- [x] 기존 네 상태 렌더링을 공유 컴포넌트로 분리한다.
- [x] 요약에 전체 건수와 조건부 `전체 N건 보기` 링크를 추가한다.
- [x] `/hardening/[status]?page=N`과 페이지네이션 컨트롤을 추가한다.
- [x] 허용되지 않은 상태 경로를 404 처리한다.
- [x] 액션 후 재조회하고 서버 보정 페이지로 URL을 교정한다.

## Task 3: 폴링과 조회 최적화

- [x] 보이는 탭에서만 5초 폴링하고 복귀 시 즉시 갱신한다.
- [x] 요청 순번 가드로 오래된 응답을 무시한다.
- [x] 상태별 목록 인덱스와 Prisma 마이그레이션을 추가한다.

## Task 4: 검증과 커밋

- [x] `npx prisma validate`, 관련/전체 Vitest, lint, build를 실행한다.
- [x] 변경 전체를 `feat: 선지 검토 목록에 상태별 페이지네이션 추가`로 커밋한다.
