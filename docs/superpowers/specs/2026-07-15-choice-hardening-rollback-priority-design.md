# 선지 난이도 강화 원격 롤백 우선 재구성 설계

## 목표

원격 `d2d8621`의 선지 난이도 강화 동작을 최종 기준으로 유지하면서, 로컬에서 개발한 비동기 실행 안정성만 다시 이식한다. 최종 `master` 이력은 원격 롤백 커밋 이후에 새 안정화 커밋이 이어지는 선형 구조로 만든다.

## 보존할 원격 동작

- 사용자는 생성 엔진 하나만 선택한다.
- 질문 본문과 정답 선지 및 정답 인덱스는 바꾸지 않는다.
- 오답 선지만 더 어려운 오답으로 교체한다.
- 별도의 의미 보존 검증 엔진, 의미 보존 변형 문구, 검증 결과 UI를 노출하지 않는다.
- 원격의 사실 확인 이의, 웹 검증 판정, 교정안 적용 흐름을 유지한다.

## 이식할 로컬 안정성

- Route Handler는 `after()`에 job runner를 등록해 응답을 차단하지 않는다.
- DB job 선점, attempt fencing, stale 복구로 중복 실행과 재시작을 견딘다.
- 결과 적용은 row lock과 fingerprint 재검사를 포함한 transaction으로 처리한다.
- 배포 drain은 choice-hardening RUNNING job을 포함하며 migration 전 테이블 부재도 처리한다.
- systemd는 `TimeoutStopSec=25min`으로 graceful shutdown 시간을 확보한다.
- UI는 5초 polling과 `visibilitychange`/`pageshow` 갱신을 유지하고 네트워크 오류를 비종결 경고로 처리한다.

## 데이터와 API

- 기존에 운영 DB에 적용된 `choice_hardening_job` 테이블을 재사용한다.
- `verify_engine` 컬럼은 호환성을 위해 유지하되 생성 엔진과 같은 값으로 저장하고 runner에서는 별도 검증 단계를 실행하지 않는다.
- POST 요청은 원격 계약대로 `engine`만 받는다. 완료·실패 결과를 강제로 새로 만들 때만 내부 요청에 `force=true`를 추가한다.
- preview는 원격의 단일 엔진 결과 형태를 사용하며 검증 엔진과 검증 의견을 노출하지 않는다.

## 이력 재구성

- 현재 배포된 HEAD는 복구 가능한 커밋 SHA로 기록한다.
- 로컬 `master`를 `d2d8621`로 되돌린 뒤 위 안정성을 새 커밋으로 구현한다.
- 검증 후 `git push --force-with-lease origin master`를 사용한다. 무조건 force는 사용하지 않는다.

## 검증

- 원격 롤백 UX와 오답-only parser/prompt 테스트
- Route 비차단 실행, runner 단일 선점과 fencing, stale 경계 테스트
- Apply transaction 원자성 테스트
- drain SQL과 migration 식별자 제한 테스트
- ResultPanel polling, 네트워크 복구, 사실 검증 교정안 적용 테스트
- `npm test`, Prisma validate, TypeScript, ESLint, production build
- force-with-lease push 후 GitHub Actions test와 실제 deploy 성공 확인
