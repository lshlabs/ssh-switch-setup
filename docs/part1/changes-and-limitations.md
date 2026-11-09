# 변경 범위와 남은 작업

작업 브랜치: `feature/part1-setup-wizard`. 기존 Windows 구현은 분석 초기에 존재만 확인했으며 사용자 정정 이후 코드/스크립트를 재사용하지 않고 별도 구현했습니다.

| 파일/영역 | 변경 및 영향 |
| --- | --- |
| windows-setup/PCControlSetup | 신규 WPF UI, UAC 매니페스트, PowerShell bridge/진단/설정/키 복구, QR/Kestrel 서버, RSA 검증 |
| windows-setup/PCControlSetup.Tests, Test-SystemLogic.ps1 | 실제 loopback HTTPS + 임시 파일 검증 |
| components/SetupPairing.tsx, components/OnboardingScreen.tsx | 현재 사용 중인 초기 설정에 QR/JSON 진입점 및 SSH 검증·저장 연결 |
| SetupPairingClient.kt, PairingCertificateTrust.kt, PcControlPlugin.kt | QR 인증서 pin 전달, HTTPS만 허용, redirect 차단, 크기 제한 |
| pairing-protocol, definitions.ts | TLS pin 필드, 사설 HTTPS bootstrap 검증 및 테스트 |
| screens/OnboardingScreen.tsx | 미사용 화면도 새 bridge 타입 계약에 맞춰 pin 인수 전달, 화면 자체를 활성화하지 않음 |
| Android capacitor.settings.gradle | cap sync가 현 pnpm 설치의 의존 패키지 경로를 재생성 |
| .github/workflows/part1.yml | Windows/Android 빌드 및 테스트, 산출물 업로드 정의 |
| .gitignore, docs/part1, README | 개발 SDK/빌드 출력 제외, 가이드·프로토콜·검증 결과 |

NativeSshClient, SshIdentityManager의 Keystore alias, PowerOrchestrator, OpenVpnExternalApiClient, WOL 코드는 변경하지 않았습니다. 기존 Tauri 소스와 Windows 스크립트도 변경하지 않았습니다. 기존 HTTP 페어링 서버는 새 Android HTTPS 경로와 호환되지 않으며 의도적으로 신뢰하지 않습니다.

## 제약/후속 작업

- 실기기 검증 전 배포 승인 상태가 아닙니다. 테스트 매트릭스는 test-results.md를 따릅니다.
- 1개 PC 프로필이라는 기존 앱 구조를 유지합니다. 다중 PC 목록을 새로 구현하지 않았습니다.
- 로컬 계정 이름은 영문/숫자/점/밑줄/하이픈을 우선 지원합니다. 도메인/Entra 및 고급 sshd 정책은 자동 수정하지 않고 중단합니다. 계정 최소 권한은 Windows 권한에 의존하며 새 제한 셸이나 강제 명령을 설치하지 않습니다.
- 개인키 소유 서명은 SSH 접속 자체를 독립 증명하지 않습니다. 정상 Android 구현이 hostname 인증을 통과한 뒤 서명하도록 연결했습니다.
- 공개키 추가와 ACL 변경은 복구 저널을 먼저 기록하지만 전원 단절 중 파일 쓰기는 완전한 파일시스템 트랜잭션이 아닙니다. 예상 바이트와 다른 파일은 덮어쓰지 않고 수동 병합을 요구합니다.
- 갑작스러운 종료 후 방화벽 규칙은 다음 실행에서 복구해야 합니다. 인증서는 정상 종료 시 임시 키 컨테이너를 정리하며 강제 종료 잔여물은 추가 실기기 검증이 필요합니다.
- 페어링 확정 응답이 유실되면 PC에서는 확정됐지만 Android는 오류를 표시할 수 있습니다. 이미 저장된 SSH 정보로 수동 연결 테스트하거나 재페어링합니다. 분산 저장/확정의 전원 단절 복구를 향후 강화할 수 있습니다.
- 기존 Native 설정/호스트 신뢰 저장소는 SharedPreferences apply를 사용합니다. 앱 강제 종료 시 저장 타이밍은 실기기 검증 대상입니다.
- 기존 광범위 SSH 방화벽 규칙은 사용자 동의 없이 축소하지 않습니다. 새 규칙은 LAN에 제한하며 설치로 새로 생긴 기본 규칙만 비활성화합니다. 기존 규칙 감사와 VPN 서브넷 추가는 관리자 검토가 필요합니다.
- 기존 모바일 lint 실패는 별도 정비 항목입니다. 신규 UI는 한국어 중심이며 완전한 영어 번역 및 디자인 검토가 남아 있습니다.
- 코드 서명, Android release 서명, 실기기 검증, GitHub PR/릴리스 게시를 아직 수행하지 않았습니다. 개발용 EXE/APK는 저장소에 커밋하지 않습니다.
