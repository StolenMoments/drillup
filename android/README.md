# drillup Android 앱

`https://drillup.mygreed.shop/`을 표시하는 개인 설치용 Android WebView 앱이다.

## 요구 도구

- JDK 17 이상(현재 빌드는 JDK 21 사용)
- Android SDK Platform 36 및 Build Tools 36.0.0
- 선택: Android Studio, Android Emulator, `adb`

`local.properties`가 없으면 `ANDROID_HOME` 또는 `ANDROID_SDK_ROOT` 환경 변수가 Android SDK를 가리켜야 한다.

## Debug 빌드와 설치

PowerShell에서 다음을 실행한다.

```powershell
cd android
.\gradlew.bat test lint assembleDebug
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r .\app\build\outputs\apk\debug\app-debug.apk
```

Android Studio의 Device Manager에서 Pixel 9 Pro XL/API 36 가상 기기를 만든 뒤 실행하거나, USB 디버깅을 허용한 Android 10 이상 실제 기기를 연결한다. `adb devices`에 대상이 표시되어야 한다.

## Release 서명과 빌드

최초 한 번만 다음 스크립트를 실행한다. 기존 키나 설정이 있으면 스크립트는 덮어쓰지 않고 실패하며 비밀번호를 콘솔에 출력하지 않는다.

```powershell
cd android
.\scripts\New-ReleaseKeystore.ps1
.\gradlew.bat test lint assembleDebug assembleRelease
```

서명 APK는 `app/build/outputs/apk/release/app-release.apk`에 생성된다. 설치 또는 같은 서명의 기존 앱 업데이트는 다음과 같다.

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r .\app\build\outputs\apk\release\app-release.apk
```

서명 확인:

```powershell
& "$env:ANDROID_HOME\build-tools\36.0.0\apksigner.bat" verify --verbose --print-certs .\app\build\outputs\apk\release\app-release.apk
```

## 서명키 백업

`keystore/drillup-release.jks`와 `keystore.properties`는 git에서 제외된다. 두 파일을 암호화된 별도 저장소에 함께 백업해야 한다. 하나라도 잃으면 기존에 설치한 앱을 같은 application ID로 업데이트할 수 없으며, 새 키로 서명한 APK는 기존 앱 제거 후에만 설치할 수 있다.

## 수동 확인

- 최초 실행에서 `/login`이 표시되는지 확인한다.
- 로그인 후 대시보드, 학습, 통계, 로그아웃을 확인한다.
- 내부 링크와 뒤로가기 기록, 외부 HTTPS 링크의 기본 브라우저 전환을 확인한다.
- 네트워크를 끊었을 때 오류/재시도 화면이 표시되고, 복구 후 다시 로드되는지 확인한다.
