# PC Control

개인용 Windows PC의 상태와 전원을 Android에서 제어하기 위한 Capacitor 앱이다. React는 화면과 사용자 피드백만 담당하고, SSH·네트워크 판별·OpenVPN for Android 연동은 Kotlin 기반 Capacitor 플러그인에서 구현한다.

현재 Phase 1은 Android Keystore 기반 앱 전용 SSH identity, 호스트 키 고정, 그리고 무해한 SSH 진단 명령까지만 구현한다. 실제 전원 명령과 VPN은 아직 실행하지 않으며, 미구현 메서드는 성공을 흉내 내지 않고 명시적으로 `unimplemented` 오류를 반환한다.

## Architecture

```text
apps/mobile (React + Vite + Tailwind)
        │
        ├── packages/core (순수 TypeScript 모델과 비밀이 아닌 설정)
        │
        └── packages/capacitor-pc-control (공개 Plugin API)
                      │
                      └── Android / Kotlin
                          ├── SSH harmless commands [Phase 1]
                          ├── Android Keystore       [Phase 1]
                          ├── Network reachability   [다음 단계]
                          └── OpenVPN External AIDL  [다음 단계]
```

React 코드에서는 AIDL, `ServiceConnection`, Android socket, Keystore 또는 SSH 라이브러리 클래스를 직접 다루지 않는다.

## Monorepo

```text
pc-control/
├── apps/
│   └── mobile/                    # React UI + Capacitor Android 앱
├── packages/
│   ├── core/                      # 플랫폼 독립 TypeScript 모델과 configuration
│   ├── capacitor-pc-control/      # 앱 전용 Capacitor Android 플러그인
│   ├── eslint-config/             # 공통 ESLint flat config
│   └── tsconfig/                  # 공통 strict TypeScript config
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

현재 검증 대상의 IP, MAC, 포트와 네트워크 대역은 [packages/core/src/config.ts](packages/core/src/config.ts) 한 곳에서만 관리한다. 이 파일에는 credential을 추가하지 않는다.

## 확인된 개발환경

```text
macOS:          26.5.2 (Apple Silicon arm64)
Node.js:        22.22.2
Corepack:       0.34.6
pnpm:           10.12.1
Git:            2.39.2
Java / JDK:     21.0.10
Android Studio: 2026.1 계열 (JBR 21.0.10)
Android SDK:    API 36
Build Tools:    35.0.0
Platform Tools: 37.0.0
Capacitor:      8.5.0
Gradle wrapper: 8.14.3
AGP:            8.13.0
Kotlin:         2.2.20
```

Capacitor 8 기준으로 Node 22 이상, Android Studio 2025.2.1 이상, Android SDK API 24 이상이 필요하다. 이 프로젝트는 `minSdk 24`, `compileSdk 36`, `targetSdk 36`, Java 21을 사용한다.

## 최초 설정

```bash
pnpm install
source ~/.zshrc
```

`~/.zshrc`에는 다음 Android SDK 위치와 실행 경로가 idempotent한 블록으로 설정되어 있다.

```text
ANDROID_HOME=$HOME/Library/Android/sdk
PATH: platform-tools, emulator, cmdline-tools/latest/bin(설치된 경우)
```

기존 zsh 설정의 작업 전 백업은 `~/.zshrc.pc-control-backup-20260828`에 있다.

현재 SDK의 오래된 `tools/bin/sdkmanager`는 사용하지 않는다. Android Studio의 **Settings → Languages & Frameworks → Android SDK → SDK Tools**에서 **Android SDK Command-line Tools (latest)**를 설치한다. APK 빌드에는 이미 필요한 SDK가 준비되어 있어 이 항목 없이도 빌드할 수 있다.

## 개발 명령

웹 개발 서버:

```bash
pnpm dev
```

코드 품질과 프로덕션 웹 빌드:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm format
```

`pnpm format`은 파일을 수정한다. 변경 없이 검사하려면 `pnpm format:check`를 사용한다.

## Capacitor와 Android

웹 빌드 후 Android assets와 플러그인을 동기화한다.

```bash
pnpm android:sync
```

Android Studio에서 연다.

```bash
pnpm android:open
```

또는 Android Studio에서 `apps/mobile/android` 디렉터리를 직접 연다. 연결된 실제 기기나 API 24 이상의 emulator를 선택하고 Run을 실행한다.

CLI에서 debug APK를 빌드한다.

```bash
pnpm android:build
```

생성 위치:

```text
apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

`Native bridge test` 버튼은 기존과 동일하게 다음을 구분한다.

- Android: Kotlin 플러그인이 직접 응답하면 연결 성공을 표시한다.
- 웹 개발 서버: 웹 미리보기임을 표시하며 네이티브 연결 성공으로 취급하지 않는다.

`cap sync android` 출력에는 아래 로컬 플러그인이 한 개 감지되어야 한다.

```text
@pc-control/capacitor-pc-control
```

플러그인은 Capacitor가 자동 등록하므로 `MainActivity`에 수동 등록 코드를 추가하지 않는다.

## Package 역할

### `apps/mobile`

React 화면 상태, 사용자 입력, 플러그인 호출과 사용자 피드백을 담당한다. Android 네이티브 구현 세부사항은 포함하지 않는다.

### `packages/core`

PC/VPN/network 상태 타입, power action 타입과 비밀이 아닌 기본 configuration을 제공한다. Android, Capacitor, React, DOM API에 의존하지 않는다.

### `packages/capacitor-pc-control`

TypeScript 공개 API와 Kotlin 구현을 연결한다. Phase 1에서는 identity 생성·공개키 복사·호스트 키 스캔/고정·SSH 명령 실행을 Kotlin이 담당한다. reachability와 OpenVPN API는 다음 단계의 명시적 placeholder다.

### `packages/eslint-config`, `packages/tsconfig`

workspace 전체의 ESLint 및 TypeScript strict 설정을 공유한다.

## Secret 관리

다음 파일이나 값을 저장소에 넣지 않는다.

- SSH private key와 비밀번호
- OpenVPN private key, profile (`*.ovpn`), 인증서와 credential
- ASUS 또는 Windows 비밀번호
- Android keystore (`*.jks`, `*.keystore`)
- 실제 secret이 들어 있는 `.env` 파일

앱 전용 SSH key는 Android Keystore에서 RSA 3072비트로 생성한다. 개인키는 non-exportable Keystore key로 직접 서명에 사용되며 React, 파일, assets, `localStorage`, 평문 `SharedPreferences`에 저장되지 않는다. Termux private key도 복사하거나 재사용하지 않는다.

SSH 구현은 유지보수 중인 `com.github.mwiede:jsch:2.28.6`을 사용한다. 앱 key 인증은 SHA-2 RSA 서명만 허용한다. Android 호환성을 위해 서버 호스트 키는 ECDSA P-256 또는 RSA SHA-2, 키 교환은 ECDH P-256 또는 DH group14 SHA-256으로 제한한다.

## Phase 1 SSH 검증 절차

앱의 순서는 다음과 같다.

1. **앱 전용 SSH identity 생성**을 누른다.
2. 공개키와 `SHA256:` fingerprint가 표시되는지 확인한다.
3. **공개키 복사**로 공개키 한 줄만 복사한다.
4. 공개키를 각 서버의 기존 `authorized_keys`에 덮어쓰지 말고 한 줄로 추가한다.
5. 서버의 실제 host key fingerprint를 별도 신뢰 경로에서 확인한다.
6. 앱에서 **호스트 키 스캔** 후 두 fingerprint를 비교한다.
7. 일치할 때만 **확인한 지문 신뢰**를 누른다.
8. Windows에서는 `hostname`, `whoami`, ASUS에서는 `uname -n`, `printf "%s\n" "$USER"`, `uname -a`만 실행한다.

첫 연결도 호스트 키를 자동 승인하지 않는다. 저장된 알고리즘 또는 fingerprint가 달라지면 `HOST_KEY_MISMATCH`로 연결을 차단한다. 호스트별 고정 값은 앱 내부 `SharedPreferences`에 저장하지만, 이는 공개 정보인 fingerprint만 포함한다.

### Windows 공개키 등록

대상 계정은 `admin`이며 관리자 권한 계정이므로 공개키 한 줄을 다음 파일에 **추가**한다.

```text
C:\ProgramData\ssh\administrators_authorized_keys
```

파일을 새로 만들거나 수정한 경우 OpenSSH가 요구하는 대로 `SYSTEM`과 로컬 Administrators 그룹만 수정할 수 있는 ACL인지 확인한다. 기존 줄을 삭제하거나 파일 전체를 앱 공개키로 교체하지 않는다. Windows에서 host key fingerprint를 확인할 때는 관리자 PowerShell에서 다음처럼 실제 공개 host key들을 조회한다.

```powershell
Get-ChildItem C:\ProgramData\ssh\ssh_host_*_key.pub |
  ForEach-Object { ssh-keygen -lf $_.FullName -E sha256 }
```

앱 스캔 화면에 표시된 알고리즘과 같은 항목의 `SHA256:` 값을 비교한다.

### ASUS 공개키 등록

ASUS의 SSH 사용자 이름과 `authorized_keys`의 영구 저장 위치는 펌웨어 설정에 따라 달라질 수 있으므로 코드에서 추측하지 않는다. 기존 SSH 접속으로 사용자 이름, 실제 읽히는 `authorized_keys` 경로, 재부팅 후 지속 여부를 먼저 확인한 다음 공개키 한 줄을 보존 추가한다. 이 값들이 확인되기 전에는 앱의 ASUS 사용자 입력을 비워 둔다.

신뢰 가능한 LAN 컴퓨터에서 ASUS fingerprint를 교차 확인할 수 있다면 다음 결과를 앱 표시와 비교한다.

```bash
ssh-keyscan -T 5 -t ecdsa,rsa 192.168.60.1 2>/dev/null |
  ssh-keygen -lf - -E sha256
```

### 오류 코드

SSH 오류는 사용자 메시지와 별도로 다음 코드로 구분한다.

```text
IDENTITY_NOT_AVAILABLE
HOST_UNREACHABLE
CONNECTION_TIMEOUT
HOST_KEY_UNKNOWN
HOST_KEY_MISMATCH
AUTH_FAILED
COMMAND_TIMEOUT
COMMAND_FAILED
IO_ERROR
UNKNOWN
```

## 다음 구현 순서

1. Galaxy S20에서 Windows/ASUS harmless SSH 명령과 host-key mismatch 차단을 완료 검증
2. OpenVPN for Android External AIDL 연결 및 lifecycle 처리
3. 실제 target reachability 기반 network/VPN orchestration
4. Power On, Shutdown, Reboot와 PC 상태 확인 연결
