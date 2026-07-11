# drillup Android WebView 래퍼 설계

## 목표

`https://drillup.mygreed.shop/`을 개인 Android 기기에서 네이티브 앱처럼 사용할 수 있는 최소 권한 WebView 셸을 제공한다. 기존 Next.js 웹앱과 서버 API는 변경하지 않는다.

## 제품 범위

- 앱 이름: `drillup`
- application ID: `shop.mygreed.drillup`
- 버전: `1.0.0` (`versionCode 1`)
- Android 10(API 29) 이상, compile/target SDK 36
- 단일 Activity, Kotlin, 세로·가로 방향 모두 지원
- 개인 서명 APK 배포만 지원한다. Play Store, AAB, 딥 링크, 알림, 생체 인증, 파일 업로드·다운로드, 오프라인 캐시는 제외한다.

## 구조

독립 Gradle 프로젝트를 `android/`에 둔다. `MainActivity`가 스플래시, 로딩 진행률, WebView와 오류/재시도 화면을 소유한다. 시작 URL은 단일 상수로 관리한다.

URL 허용 여부는 UI와 분리된 `NavigationPolicy`가 `INTERNAL`, `EXTERNAL`, `BLOCKED`로 분류한다. 기본 링크와 새 창 요청은 같은 분류기를 사용한다.

## 이동 및 보안 정책

- 내부: user-info와 명시적 비표준 포트가 없는 정확한 `https://drillup.mygreed.shop` URL
- 외부 앱: 다른 HTTPS 호스트, `mailto:`, `tel:`
- 차단: HTTP, user-info, 서브도메인·유사 도메인, 비표준 포트, `file:`, `content:`, `javascript:`, `intent:` 및 나머지 스킴

WebView는 JavaScript, DOM storage와 1차 쿠키만 사용한다. 서드파티 쿠키, 파일/콘텐츠 접근, 혼합 콘텐츠와 JavaScript bridge는 사용하지 않는다. Safe Browsing은 유지하며 SSL 오류는 항상 취소한다. 디버깅은 debug 빌드에서만 허용한다.

## 네이티브 UX

- 앱 시작 시 PWA 아이콘과 `#eff4f9` 배경의 스플래시 표시
- 탐색 중 상단 진행 표시
- 최상위 문서의 네트워크·HTTP·SSL 실패에만 한국어 오류 및 재시도 UI 표시
- 렌더러 종료 시 WebView를 폐기하고 재생성 가능한 오류 상태 표시
- WebView 방문 기록을 우선하는 뒤로가기
- Activity 재생성 시 페이지와 기록 복원
- edge-to-edge 및 system bar inset 적용
- 차단 URL 또는 외부 처리 앱 부재 시 크래시 없는 한국어 안내

## 서명과 비밀 관리

PowerShell 스크립트가 강한 임의 비밀번호, `android/keystore/drillup-release.jks`, `android/keystore.properties`를 한 번만 생성한다. 기존 파일이 있으면 덮어쓰지 않고 실패한다. 키와 비밀번호는 git에서 제외하며 콘솔에 출력하지 않는다. 동일 앱 업데이트를 위해 keystore의 별도 백업이 필수다.

## 완료 기준

- URL 분류 경계 조건 단위 테스트 통과
- `gradlew.bat test lint assembleDebug assembleRelease` 통과
- release APK 서명 검증 통과
- Pixel 9 Pro XL 에뮬레이터에서 로그인, 주요 화면, 로그아웃, 뒤로가기, 외부 브라우저 이동, 오프라인 오류와 재시도 확인

