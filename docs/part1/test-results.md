# 검증 결과 — 2026-11-09 (Asia/Seoul)

## 실행한 검증

| 항목 | 결과 |
| --- | --- |
| .NET 10 WPF Release 빌드 | 성공, 경고/오류 0 |
| win-x64 Self-contained Single-file publish | 성공, PCControlSetup.exe 생성 |
| .NET 테스트 | 9개 통과: 실제 loopback Kestrel HTTPS, 올바른/틀린 인증서 pin, 잘못된 토큰, 요청 재사용, 승인 전 무등록, 비밀값 없는 조회 차단, RSA 서명, 확정/취소 상태, 만료, PowerShell 임베디드 실행 경로 |
| PowerShell 격리 테스트 | 9개 검증 통과: 신규 파일, 기존 바이트 보존, 중복 키, 제한 키 우회 차단, 잘못된 인코딩, 원본/ACL 복구, 재복구, 외부 수정 충돌 |
| TypeScript 검사 | 모바일 및 의존 패키지 통과 |
| Vitest | 45개 통과 |
| 모바일 Vite production build | 성공 |
| Capacitor Android sync | 성공 |
| Android assembleDebug | 성공, Debug APK 생성 |
| Android JVM 단위 테스트 | 35개 통과: 기존 전원 orchestration 16, 상태 8, endpoint 3, identity 5, 새 TLS pin 3 |
| 새 SetupPairing.tsx ESLint | 통과 |
| 모바일 전체 ESLint | 실패: 기존 OnboardingScreen.tsx의 preview effect setState 오류 1개 및 기존 hook dependency 경고 2개. 원본 HEAD에도 같은 코드가 있음. 무관한 리팩터링은 하지 않음 |

테스트의 TLS 서버는 loopback 전용이며 등록/복구 콜백은 가짜 구현입니다. PowerShell 검증은 AST에서 함수만 로드하여 임시 디렉터리의 파일/ACL을 검사합니다. 실제 SSH 설치·서비스·방화벽 변경을 테스트하지 않았습니다. SDK의 첫 실행 설정 외에 개발 PC를 원격 제어용으로 구성하지 않았습니다.

## 발견하여 수정한 문제

- Windows Schannel에서 EphemeralKeySet 인증서를 사용하면 TLS handshake EOF로 실패: 일회성 named key container를 사용하고 Dispose 정리하도록 수정, 실제 HTTPS 회귀 테스트 통과.
- 긴 PowerShell 소스를 -EncodedCommand 인수로 전달하면 Windows 명령줄 한도를 초과: 짧은 loader + stdin 소스/JSON 전달로 수정하고 실제 프로세스 테스트 추가.
- 기존 제한 옵션 공개키가 같은 key blob으로 등록돼 있을 때 무제한 키를 추가할 위험: 중단하도록 수정.
- 늦게 도착한 이전 세션 종료 작업이 새 세션을 닫을 위험: 세션 인스턴스 확인 후 정리.

## 아직 실행하지 않은 실기기 검증

- 깨끗한 Windows 11에서 OpenSSH 기능 설치, 재부팅 필요, 서비스 실패 시 복구.
- 사용자 지정 단일 SSH 포트, 일반/관리자 계정, 실제 유효 AuthorizedKeysFile, 실제 ACL로 인증, 기존 설정 보존 및 반복 실행.
- WPF 화면/UAC 조작, 다중 NIC 선택, 실제 방화벽 열기·정리, 강제 종료 후 복구, 런타임 없는 PC의 EXE 실행.
- Android 카메라 QR, Android HTTPS SAN 검증, Windows PC 간 실제 SSH 인증/재연결 및 호스트 키 변경 차단.
- 저장된 작업을 보호한 상태에서 사용자 승인 후 종료·재부팅·재부팅 후 sshd 자동 시작.
- 기존 OpenVPN External API 권한, 프로필 연결, 실제 외부망 라우팅 및 SSH.
- 실제 기기 키/설정 저장 도중 앱 강제 종료, 페어링 확정 응답 손실, 다국어/접근성 UI.

위 검증 전에는 사용자 정의 Part 1 전체 완료 기준을 달성했다고 판단하지 않습니다. 자동 빌드·단위/격리 통합 테스트 성공과 운영 환경 검증 완료는 별개입니다.
