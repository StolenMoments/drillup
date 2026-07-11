# drillup Android WebView 래퍼 실행 계획

> 승인된 설계: `docs/superpowers/specs/2026-07-11-android-webview-wrapper-design.md`

## Task 1. Android 프로젝트 기반

- [ ] AGP 9.2.1, Gradle 9.4.1, 내장 Kotlin, JVM 17 구성
- [ ] application ID/SDK/버전과 최소 의존성 설정
- [ ] INTERNET 단일 권한 및 안전한 application 기본값 선언
- [ ] 기존 512px PWA 아이콘으로 launcher/adaptive/splash 리소스 생성
- [ ] Android 산출물·로컬 SDK·서명 비밀 gitignore 처리
- [ ] 프로젝트 구성 검증 및 커밋

## Task 2. URL 이동 정책 (TDD)

- [ ] 허용·외부·차단 경계 조건 테스트를 먼저 작성
- [ ] 테스트가 구현 부재로 실패하는지 확인
- [ ] `NavigationDestination`과 순수 `NavigationPolicy.classify(Uri)` 최소 구현
- [ ] 단위 테스트 통과 확인 및 커밋

## Task 3. WebView 셸과 네이티브 UX

- [ ] 스플래시, progress, WebView, 오류·재시도 overlay 구현
- [ ] WebView 보안 설정과 쿠키 정책 적용
- [ ] 기본 링크와 새 창에 단일 URL 정책 적용
- [ ] 최상위 오류, SSL 오류, 렌더러 종료 처리
- [ ] 뒤로가기, 상태 저장/복원, edge-to-edge/inset 구현
- [ ] 외부 앱 부재·차단 URL 안내 구현
- [ ] test/lint/debug build 검증 및 커밋

## Task 4. 서명 Release와 운영 문서

- [ ] 덮어쓰기 방지 로컬 keystore 생성 PowerShell 스크립트 작성
- [ ] keystore properties 기반 release signing 구성
- [ ] 빌드·설치·업데이트·키 백업 README 작성
- [ ] 로컬 서명키 생성 후 release APK 빌드
- [ ] 전체 test/lint/debug/release 및 apksigner 검증
- [ ] 비밀·산출물이 추적되지 않는지 확인하고 커밋

## 수동 인수 테스트

- [ ] Pixel 9 Pro XL에서 `/login`, 로그인, 대시보드, 학습, 통계, 로그아웃 확인
- [ ] 내부 탐색과 WebView 우선 뒤로가기 확인
- [ ] 외부 HTTPS 근거 링크가 기본 브라우저로 열리는지 확인
- [ ] 네트워크 차단 시 오류 화면, 복구 후 재시도 확인
- [ ] `adb install -r`로 동일 서명 업데이트 확인

## 자체 검토

- 각 구현 단계는 입력, 결과물, 검증 명령과 커밋 경계가 명시되어 있다.
- 비밀 생성은 로컬 전용이고 덮어쓰기·콘솔 노출을 방지한다.
- 웹앱 변경, 공개 API 변경 또는 첫 버전 제외 기능을 요구하는 placeholder는 없다.
- 에뮬레이터 상호작용이 필요한 항목은 자동 검증과 분리된 수동 인수 테스트로 남긴다.
