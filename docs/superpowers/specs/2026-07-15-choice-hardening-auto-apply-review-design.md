# 선지 강화 자동 반영 + 선지 검토 메뉴 설계

날짜: 2026-07-15

## 배경과 목적

선지 난이도 올리기(선지 강화)는 비동기 job으로 동작하지만, 사용자가 학습 화면
(ResultPanel)에 머물며 폴링 결과를 기다렸다가 직접 "적용하기"를 눌러야 반영된다.
이를 다음과 같이 바꾼다.

- 생성 결과에 검증 의견(`factualConcern`)이 없으면 서버가 **자동 반영**한다.
  사용자는 버튼만 누르고 페이지를 떠나면 된다.
- 검증 의견이 붙어 사용자 확인이 필요한 결과는 **새 메뉴(선지 검토)**에 모아서
  하나씩 승인/거절/사실 확인 처리한다.

## 확정된 요구사항

- 자동 반영 기준: job 성공(SUCCEEDED) + `factualConcern`이 null.
- 학습 화면은 가벼운 상태 표시만 유지한다. 미리보기/적용하기 UI는 제거한다.
- 새 메뉴에는 승인 대기 항목 외에 진행 중 작업, 실패한 작업, 자동/수동 반영
  이력도 함께 보여준다.
- 검토 화면에서 사용자가 직접 검토한 뒤 필요한 엔진 호출(사실 확인, 재생성)을
  트리거할 수 있어야 한다.

## 선택한 접근 (A안)

기존 `ChoiceHardeningJob` 테이블을 확장한다. runner가 성공 직후 조건을 만족하면
기존 `applyChoiceHardeningJob`(row lock + 원본 해시 재검사)을 호출해 자동 반영하고,
승인 대기 상태는 별도 테이블 없이 job 컬럼 조합으로 파생한다. 검증된 동시성 처리
(fencing, `FOR UPDATE`, 해시 검사)를 전부 재사용한다.

기각한 대안: 별도 ReviewQueue 테이블(현재 출처가 선지 강화뿐이라 YAGNI),
클라이언트 주도 자동 반영(페이지를 떠나면 동작하지 않아 요구사항 미충족).

## 데이터 모델

`ChoiceHardeningJob`에 컬럼 2개를 추가한다.

- `autoApplied Boolean @default(false)` — 반영 이력에서 자동/수동 구분용.
- `dismissedAt DateTime?` — 거절(폐기) 처리 시각.

상태는 파생 규칙으로 정의한다. JSON 컬럼(`preview`)은 쿼리 조건에 쓰지 않는다.

| 구분 | 조건 |
|---|---|
| 진행 중 | `status = RUNNING` |
| 승인 대기 | `status = SUCCEEDED` 이고 `appliedAt`, `dismissedAt` 모두 null |
| 실패 | `status = FAILED` 이고 `dismissedAt` null |
| 반영 이력 | `appliedAt != null` (`autoApplied`로 자동/수동 배지) |

승인 대기를 "검증 의견이 있는 것"이 아니라 "성공했는데 아직 미반영"으로 정의한다.
자동 반영이 일시적 오류로 실패한 concern 없는 job도 조용히 사라지지 않고
대기함에 노출되어 수동 승인할 수 있다.

## 자동 반영 (runner)

`runChoiceHardeningJob`이 SUCCEEDED 저장 직후 `factualConcern`이 null이면
`applyChoiceHardeningJob`을 호출해 자동 반영하고 `autoApplied = true`를 기록한다.

- `CHOICE_HARDENING_SOURCE_CHANGED`(원본이 그새 변경됨): 영원히 적용 불가이므로
  job을 FAILED + "원본 문제가 변경되어 자동 반영할 수 없습니다"로 마감한다.
- 그 외 일시적 오류: SUCCEEDED를 유지한다. 승인 대기함에 노출되어 수동 승인
  가능하다.
- `factualConcern`이 있으면 아무것도 하지 않는다. 승인 대기함에 남는다.

자동 반영도 수동 apply와 동일하게 payload 교체 + `explanation` null +
`answerExplanation` 캐시 삭제를 수행한다 (기존 함수 재사용이므로 자동 보장).

## API

신규 엔드포인트는 2개다.

- `GET /api/harden-jobs` — `{ pending, running, failed, recentApplied }`를 한 번에
  반환한다. 각 항목에 job DTO 외에 문제 텍스트와 토픽명을 포함한다. 반영 이력은
  최근 20건으로 제한한다.
- `POST /api/questions/[id]/harden-choices/[jobId]/dismiss` — `dismissedAt`을
  기록한다. 이미 적용된 job이면 409. 실패 job 거절(목록 제거)에도 사용한다.

재사용하는 기존 엔드포인트:

- 승인(적용): `POST /api/questions/[id]/harden-choices/[jobId]/apply`
- 재시도/재생성: `POST /api/questions/[id]/harden-choices` (`force: true`)
- 사실 확인: `POST /api/questions/[id]/review-fact` + 교정 적용은
  `PATCH /api/questions/[id]`

## 새 메뉴 · 페이지 `/hardening` (라벨: "선지 검토")

`AppNav`에 항목을 추가하고 승인 대기 건수 배지를 표시한다(마운트/탭 복귀 시 갱신).
페이지는 화면이 보이는 동안 5초 폴링한다(ResultPanel의 visibility/pageshow 패턴
재사용). 4개 섹션으로 구성한다.

1. **⏳ 승인 대기** — 카드마다 문제 텍스트, 엔진 칩, comment, ⚠️ 검증 의견 배너
   (있을 때만), 선지 diff(정답 유지 ✅ / 기존 텍스트 취소선 → 새 텍스트,
   ResultPanel 미리보기와 동일 형식). 버튼: ✅ 승인(적용) / 🗑 거절 /
   🔍 사실 확인(엔진 선택 → verdict·교정본 diff → 교정 적용) / 🔁 재생성.
2. **🔄 진행 중** — 문제, 엔진, 시작 시각.
3. **❌ 실패** — 오류 메시지 + 재시도 / 거절(목록 제거).
4. **📜 최근 반영 이력** — 자동/수동 배지, 반영 시각.

사실 확인에서 교정본을 적용하면 원본 payload가 바뀌어 해당 강화 결과는 적용
불가가 된다. 교정 적용 시 그 job을 자동으로 거절 처리하고 안내한다.

## 학습 화면(ResultPanel) 변경

미리보기/적용하기 UI를 제거하고 가벼운 상태 표시만 남긴다.

- 엔진 버튼 클릭 → "생성 중 — 완료되면 자동 반영됩니다. 페이지를 떠나도 계속
  진행돼요".
- 머무는 동안 폴링이 종결 상태를 감지하면:
  - 자동 반영됨 → "✅ 자동 반영됨 — 다음 학습부터 새 선지가 나옵니다 🎉"
  - 검증 의견 있음 → "⚠️ 검증 의견이 있어요 — [선지 검토]에서 승인해 주세요"
    (페이지 링크)
  - 실패 → 기존 에러 표시 + 새로 생성 버튼.
  - SUCCEEDED이지만 concern 없이 아직 미반영(자동 반영 직전의 순간, 또는 일시
    오류로 미반영 지속) → "생성 중" 표시를 유지하며 폴링을 계속하고, 이후에도
    `appliedAt`이 생기지 않으면 다음 폴링 결과에 따라 자동 반영/검토 안내로
    수렴한다. 폴링 3회(15초) 이후에도 미반영이면 "[선지 검토]에서 수동으로
    승인할 수 있어요" 안내로 전환한다.
- 기존 `FactualConcernBanner`와 사실 교정 흐름은 검토 페이지로 이동한다.
  ResultPanel의 선지 강화 섹션에서는 배너를 렌더하지 않는다 (해설 섹션의 배너는
  그대로 유지).

## 동시성 · 에러 처리

- 같은 문제의 job 두 개를 연달아 승인하면 두 번째는 기존 해시 재검사로 409
  (`CHOICE_HARDENING_SOURCE_CHANGED`) → 카드에 "원본이 변경되어 적용할 수
  없습니다"를 표시하고 거절을 유도한다.
- dismiss는 `updateMany` + 상태 가드(`appliedAt: null`)로 중복 클릭/경합을 막는다.
- 자동 반영은 기존 트랜잭션(`FOR UPDATE`) 경로를 그대로 타므로 수동 apply와
  경합해도 안전하다. `appliedAt`이 이미 있으면 no-op.
- stale job 복구(`recoverStaleChoiceHardeningJobs`)는 목록 API에서도 호출해
  중단된 job이 진행 중 섹션에 영구히 남지 않게 한다.

## 테스트 (vitest)

- runner: concern 없음 → 자동 apply 호출 + `autoApplied` 기록 / concern 있음 →
  apply 미호출 / SOURCE_CHANGED → FAILED 전환 / 일시 오류 → SUCCEEDED 유지.
- service: dismiss 상태 가드(이미 적용된 job 409, 중복 dismiss no-op), 목록 API의
  4분류 쿼리와 이력 20건 제한.
- 검토 페이지: 섹션 렌더, 승인·거절·재시도·사실 확인 흐름, 409 시 안내 표시.
- ResultPanel: 자동 반영 문구, 검토 링크, 실패 회귀, 미리보기 UI 제거 확인.

## 범위 밖

- AI 해설(`explanation`)의 factualConcern을 검토 큐에 포함하는 일반화.
- 반영 이력에서 되돌리기(undo).
- 승인 대기 항목 일괄 승인.
- CLOZE 선지 강화.
