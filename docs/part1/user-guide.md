# PC Control Setup Part 1 사용 및 빌드

이 버전은 새 .NET 10/WPF Windows 도구입니다. 기존 Tauri 도구 및 기존 Windows 설정 스크립트를 사용하거나 호출하지 않습니다. 로컬 구현·빌드 산출물이며 아직 GitHub 릴리스로 게시하지 않았습니다.

## 사용

1. Windows 11 x64, 동일한 신뢰할 수 있는 Private LAN, Windows에 한 번 로그인한 로컬 계정을 준비합니다. 가능하면 일반 계정을 사용하세요. 관리자 공유 키 파일은 다른 관리자 계정에도 접근을 허용할 수 있습니다.
2. `output/windows/PCControlSetup.exe` 실행 → UAC 승인 → **환경 진단**. 사용할 SSH 계정과 휴대폰이 접근할 네트워크를 명시적으로 선택합니다. UAC에서 입력한 관리자 계정이 목표 SSH 계정이라고 가정하지 않습니다.
3. **OpenSSH 설치·서비스·LAN 방화벽 구성**을 누릅니다. Windows 기능 설치는 시간이 걸릴 수 있습니다. 진행 중에는 창 닫기를 막아 DISM 작업을 중간에 죽이지 않습니다. 재부팅 필요 메시지가 나오면 작업을 저장하고 직접 재부팅한 뒤 다시 실행합니다.
4. **새 HTTPS 페어링 QR**을 누릅니다. Android 앱의 초기 설정 → 준비 화면에서 **Windows QR 스캔** 또는 **JSON으로 페어링**을 선택합니다. Android APK는 `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`입니다. Debug 앱 이름은 **PC Control Setup**, 패키지는 `com.pccontrol.app.setup`으로 설정되어 기존 `com.pccontrol.app` 앱과 나란히 설치할 수 있습니다. Debug 앱은 기존 앱 데이터와 Android Keystore 키를 공유하지 않으므로 새 휴대폰으로 PC와 다시 페어링해야 합니다. 기존 앱은 삭제하지 않아도 됩니다. Release 패키지 ID와 앱 이름은 유지됩니다.
5. 두 화면의 6자리 코드, 계정, 기기명, 공개키 지문을 비교한 뒤 PC에서 등록을 승인합니다. Android는 SSH 호스트 키를 검증하고 `hostname`만 실행합니다. 완료 메시지 후 앱에서 **계속**을 눌러 기존 설정 흐름을 마칩니다.
6. 기존 WOL 설정은 필요에 따라 기존 UI에서 유지합니다. 이번 개발은 WOL/BIOS/공유기 기능을 추가하지 않습니다. 외부 접속은 기존 OpenVPN 프로필 및 기존 권한 승인 흐름을 사용합니다.
7. PC 창을 닫습니다. 자체 상주 서비스는 남지 않으며 OpenSSH와 승인된 키만 유지됩니다. 종료·재부팅 테스트는 작업을 저장한 뒤 사용자가 직접 실행해야 합니다.

## QR 및 통신 실패

- 카메라를 쓸 수 없으면 PC JSON **전체**를 붙여 넣습니다. 이것도 HTTPS 통신이 필요합니다.
- AP 격리 등으로 페어링 서버에 접근할 수 없으면 기존 Android 수동 설정에서 공개키를 복사하고 새 Windows 도구의 **수동 등록**에 붙여 넣습니다. PC가 표시하는 IP/계정/포트/SSH 지문을 앱에서 확인합니다. 수동 등록만으로 실제 SSH 인증 성공을 표시하지 않습니다.
- 네트워크를 자동으로 Private으로 바꾸거나 인터넷 포트 포워딩을 하지 않습니다. VPN 대역이 LocalSubnet에 포함되지 않으면 기존 관리자가 필요한 VPN 대역만 별도로 허용해야 합니다. 전체 인터넷 허용은 기본 동작이 아닙니다.
- SSH 지문 불일치는 자동으로 우회하지 않습니다. PC의 실제 키 변경 사유를 확인한 뒤 새 QR로 재페어링합니다.
- 도메인/Entra 계정, 주소 의존 Match, Include, 사용자 지정 서비스 명령, 복수 authorized_keys 경로, 비표준 키 경로는 안전하게 중단하고 수동 검토를 요구합니다.

## 복구

- 승인 전에는 공개키 파일을 변경하지 않습니다. 승인 이후 취소/만료/정상 종료하면 미확정 등록을 복구합니다. 기존 공개키의 바이트와 ACL을 보관하고 이번 작업만 되돌립니다. 이미 있던 같은 키는 삭제하지 않습니다. 제한 옵션이 붙은 동일 키를 무제한 키로 추가하지 않습니다.
- 백업과 변경 기록은 관리자/SYSTEM 접근으로 제한한 `%ProgramData%\PCControlSetup`에 저장합니다. `pending.json`은 미완료 키 등록, `committed-*.json`은 확정된 등록의 이전 상태, `backup-*`는 기존 sshd_config와 서비스 상태입니다. 토큰·개인키·VPN 비밀번호는 저장하지 않습니다.
- 강제 종료/전원 단절 후에는 **미완료 공개키 등록 복구 + 이전 임시 방화벽 정리**를 먼저 실행하세요. 다음 페어링 시작도 오래된 임시 방화벽 규칙을 정리합니다. 강제 종료 시 즉각적인 정리를 보장하지 않습니다.
- 다른 프로그램이 키 파일을 수정했다면 자동 복구가 해당 내용을 덮어쓰지 않고 중단합니다. 백업을 이용해 관리자가 병합해야 합니다.
- OpenSSH 준비 단계 실패 시 기존 서비스 시작 상태를 복원합니다. 새로 설치한 Windows 기능은 자동 제거하지 않습니다. 성공한 SSH 환경 전체를 삭제하는 버튼은 제공하지 않습니다. 공개키 철회와 SSH 전체 제거는 다른 작업입니다.

## 재현 가능한 빌드

Windows에서 .NET 10 SDK, Node 24, pnpm 10.12.1, JDK 21, Android SDK 36 및 build-tools를 준비합니다. `JAVA_HOME`, `ANDROID_HOME`을 해당 개발 도구 경로로 지정하세요.

```powershell
pnpm install --frozen-lockfile
dotnet test windows-setup/PCControlSetup.Tests -c Release
powershell -NoProfile -File windows-setup/Test-SystemLogic.ps1
dotnet publish windows-setup/PCControlSetup -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o output/windows
pnpm --filter mobile... typecheck
pnpm test
pnpm --filter mobile... build
pnpm --filter mobile cap:sync
.\apps\mobile\android\gradlew.bat -p apps/mobile/android assembleDebug :pc-control-capacitor-pc-control:testDebugUnitTest
```

단일 EXE에는 .NET 및 ASP.NET Core/WPF 런타임이 포함됩니다. 네이티브 라이브러리는 실행 시 추출됩니다. 별도 .NET 미설치 PC에서의 실행과 UAC 화면은 실기기 검증 항목입니다. EXE는 코드 서명되지 않았으며 공개 배포 전에 서명·해시 게시가 필요합니다. [Microsoft 단일 파일 배포 문서](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview).

CI 정의: `.github/workflows/part1.yml`. Windows 테스트/EXE와 Android 테스트/APK를 생성합니다. 이 작업에서 원격 CI 실행이나 PR 게시를 수행하지 않았습니다.
