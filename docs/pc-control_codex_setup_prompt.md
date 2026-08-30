# PC Control 개발환경 및 모노레포 구축 프롬프트

## 작업 목표

macOS 개발 머신에서 새로운 **Android 전용 PC 원격 전원 제어 앱**의 개발 환경을 구성하고, 유지보수 가능한 **모노레포 구조**까지 생성한다.

이번 작업의 핵심은 다음과 같다.

- 개발환경 구축
- 프로젝트 초기화
- Android 빌드 가능한 모노레포 기반 완성
- 이후 SSH / WOL / OpenVPN 기능 구현을 위한 네이티브 브리지 구조 준비

이번 단계에서는 실제 SSH / WOL / OpenVPN 기능을 본격적으로 구현하지 않는다.

다만 다음 단계에서 기능을 쉽게 추가할 수 있도록 **Capacitor Native Plugin의 기본 구조와 인터페이스 뼈대**까지 준비한다.

질문이 꼭 필요한 상황이 아니라면 합리적인 기본값을 선택해서 진행한다.

---

## 프로젝트 배경

최종 앱은 Android 전용 개인용 PC 전원 제어 앱이다.

사용자는 앱에서 최종적으로 다음 기능을 사용할 예정이다.

- PC 상태 확인
- PC 켜기
- PC 종료
- PC 재부팅
- 집 LAN에서는 바로 동작
- 외부 LTE / 5G에서는 `OpenVPN for Android`를 자동 연결한 뒤 동작
- 작업 후 필요하면 VPN 자동 해제

네트워크와 Windows 환경은 이미 실제 테스트를 완료했다.

---

## 현재 검증된 환경

### Windows PC

```text
IP
192.168.60.177

MAC
2C:F0:5D:83:5B:07

SSH
Windows OpenSSH Server
TCP 22

SSH 사용자
admin

SSH 인증
ed25519 public key 인증 정상 동작
비밀번호 없이 Termux → Windows SSH 접속 성공
```

Windows 종료 명령:

```cmd
shutdown /s /t 0
```

Windows 재부팅 명령:

```cmd
shutdown /r /t 0
```

### ASUS 공유기

```text
Router IP
192.168.60.1

LAN bridge
br0
```

ASUS에는 SSH 접속이 가능하며, SSH는 **LAN only** 상태를 유지한다.

WOL 명령:

```sh
/usr/sbin/ether-wake -i br0 2C:F0:5D:83:5B:07
```

실제로 아래 경로까지 검증 완료했다.

```text
LTE / 5G
→ OpenVPN
→ ASUS SSH
→ ether-wake
→ Windows PC 부팅
```

### LAN / VPN 대역

```text
LAN
192.168.60.0/24

OpenVPN
10.8.0.0/24
```

Windows SSH 방화벽은 위 두 대역에서만 접근 가능하도록 설정되어 있다.

### Android

현재 Termux는 테스트 용도로만 사용했다.

최종 앱은 **Termux에 의존하면 안 된다.**

Android에서는 다음 앱을 사용할 예정이다.

```text
OpenVPN for Android
Package: de.blinkt.openvpn
```

VPN 엔진을 앱 내부에 직접 구현하지 않는다.

`OpenVPN for Android`가 제공하는 **External AIDL API**를 이용해 향후 앱에서 기존 VPN 프로필의 연결 / 해제를 제어한다.

---

# 최종 기술 방향

다음 기술 스택을 사용한다.

```text
Monorepo
- pnpm workspace
- Turborepo

Frontend
- Vite
- React
- TypeScript

Styling
- Tailwind CSS

Android
- Capacitor
- Android Studio
- Kotlin

Native integration
- Custom Capacitor Plugin
```

이 프로젝트의 목적은 웹 브라우저용 웹앱 제작이 아니다.

React는 **UI 레이어**로 사용하고, 실제 Android 네이티브 기능은 **Capacitor Native Plugin**을 통해 처리한다.

---

# 1. macOS 개발환경 점검

작업 시작 전에 현재 Mac 개발환경을 검사한다.

최소한 다음을 확인한다.

```text
macOS version
CPU architecture
- Apple Silicon
- Intel

Homebrew
Node.js
Corepack
pnpm
Git
Java / JDK
Android Studio
Android SDK
adb
Gradle 관련 환경
```

이미 설치된 프로그램이 있다면 불필요하게 재설치하지 않는다.

필요한 환경이 없다면 현재 최신 Capacitor / Android Gradle Plugin과 호환되는 **안정적인 버전**을 선택해 설치한다.

임의로 오래된 버전을 선택하지 않는다.

Java 역시 현재 Android / Capacitor 환경과 호환되는 버전을 사용한다.

설치하거나 확인한 주요 버전은 최종 보고서에 기록한다.

---

# 2. macOS 환경 설정 원칙

기본 shell이 `zsh`인지 확인한다.

Android SDK 환경변수가 필요한 경우 다음을 올바르게 설정한다.

```text
ANDROID_HOME
PATH
```

`.zshrc` 등 기존 사용자 설정 파일을 수정해야 하는 경우 다음 원칙을 지킨다.

- 기존 내용을 파괴하지 않는다.
- 중복 설정을 넣지 않는다.
- 가능한 한 idempotent하게 처리한다.
- 필요하다면 수정 전에 백업한다.

Android Studio에서 사용자가 직접 해야만 하는 SDK 설치, 라이선스 동의 등이 있다면 자동화 가능한 부분까지 먼저 처리하고, 마지막에 수동 단계만 정확하게 안내한다.

---

# 3. 모노레포 생성

프로젝트 가칭:

```text
pc-control
```

아래와 비슷한 구조로 구성한다.

```text
pc-control/
├── apps/
│   └── mobile/
│       ├── src/
│       ├── public/
│       ├── android/
│       ├── capacitor.config.ts
│       ├── vite.config.ts
│       └── package.json
│
├── packages/
│   ├── core/
│   │   └── src/
│   │
│   ├── capacitor-pc-control/
│   │   ├── src/
│   │   ├── android/
│   │   └── package.json
│   │
│   ├── eslint-config/
│   │
│   └── tsconfig/
│
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── .gitignore
├── .editorconfig
├── README.md
└── ...
```

세부 구조는 더 좋은 이유가 있다면 조정할 수 있다.

단, 불필요하게 거대한 엔터프라이즈 구조로 만들지 않는다.

이 프로젝트는 작은 개인용 Android 앱이다.

---

# 4. 각 패키지 역할

## `apps/mobile`

실제 Android 앱.

사용 기술:

```text
Vite
React
TypeScript
Tailwind CSS
Capacitor
```

Capacitor Android platform까지 추가한다.

최소한 다음 명령들이 정상 동작해야 한다.

```bash
pnpm dev
pnpm build
npx cap sync android
```

Android Studio에서 프로젝트를 정상적으로 열 수 있어야 한다.

---

## `packages/core`

Android / React와 독립적인 **순수 TypeScript 영역**이다.

향후 다음과 같은 로직을 둘 예정이다.

```text
PC 상태 모델
네트워크 상태 모델
명령 타입
VPN 상태
PC configuration
```

이번 단계에서는 최소한의 타입과 구조만 만든다.

---

## `packages/capacitor-pc-control`

우리 앱 전용 **Local Capacitor Plugin**이다.

향후 다음 네이티브 기능을 담당한다.

```text
SSH 실행
OpenVPN for Android AIDL 제어
LAN / VPN 상태 확인
네트워크 reachability 확인
```

WOL은 Android에서 직접 UDP broadcast를 보내는 것보다, 현재 검증된 구조인 **ASUS SSH → ether-wake** 방식으로 구현할 예정이다.

이번 단계에서는 실제 SSH / OpenVPN 구현까지 완성하지 않아도 된다.

대신 TypeScript와 Kotlin 양쪽에서 **컴파일 가능한 plugin skeleton**을 만든다.

향후 API는 대략 다음 역할을 가질 수 있다.

```ts
getNetworkState()

checkHost()

executeSshCommand()

getOpenVpnProfiles()

connectOpenVpn()

disconnectOpenVpn()

getOpenVpnStatus()
```

이 이름을 반드시 그대로 사용할 필요는 없다.

더 나은 API 설계가 있다면 이유를 설명하고 개선해도 된다.

단, React UI 코드가 Android 네이티브 세부 구현을 직접 알아야 하는 구조는 피한다.

---

# 5. React 초기 UI

이번 단계에서는 UI 디자인을 본격적으로 하지 않는다.

앱이 정상적으로 실행되는 것을 확인할 수 있는 정도의 아주 간단한 화면만 만든다.

예:

```text
PC Control

Environment ready

[ Native bridge test ]
```

AI 특유의 과도한 카드형 UI나 장식은 만들지 않는다.

Tailwind CSS가 정상 적용되는지만 확인할 수 있으면 충분하다.

---

# 6. Android 앱 설정

적절한 package id를 사용한다.

예:

```text
com.pccontrol.app
```

Android 앱 이름은 우선 다음으로 한다.

```text
PC Control
```

나중에 쉽게 변경할 수 있어야 한다.

---

# 7. 보안 관련 필수 규칙

절대로 실제 credential을 저장소에 넣지 않는다.

특히 다음 항목을 commit하지 않는다.

```text
SSH private key
OpenVPN private key
client.ovpn
VPN username
VPN password
ASUS password
Windows password
실제 인증서 secret
```

`.gitignore`에도 관련 패턴을 추가한다.

예:

```gitignore
*.ovpn
*.pem
*.key
id_rsa
id_ed25519
.env
.env.*
```

단, `.env.example`은 허용한다.

---

## 실제 IP / MAC 관리

현재 개발 대상 값은 다음과 같다.

```text
PC IP
192.168.60.177

Router IP
192.168.60.1

PC MAC
2C:F0:5D:83:5B:07
```

이 값들을 애플리케이션 여러 곳에 하드코딩하지 않는다.

향후 설정 화면이나 configuration layer에서 교체 가능하도록 설계한다.

초기 개발용 기본값이 필요하다면 한 곳의 명확한 development config에서만 관리한다.

---

# 8. SSH 인증 방향

현재 Termux에서 만든 SSH key를 앱에 복사해서 사용하는 방식은 사용하지 않는다.

최종적으로 Android 앱 자체에서 사용할 **앱 전용 SSH key**를 별도로 생성하고, Android Keystore 등을 이용해 안전하게 다룰 예정이다.

이번 개발환경 구축 단계에서는 실제 key provisioning을 구현하지 않아도 된다.

단, private key를 다음 위치에 저장하는 구조는 만들지 않는다.

```text
React source
localStorage
일반 SharedPreferences
repository
```

---

# 9. OpenVPN 구현 방향

VPN 엔진을 직접 구현하지 않는다.

사용 대상:

```text
OpenVPN for Android
Package: de.blinkt.openvpn
```

향후 Android native layer에서 **External AIDL API**로 제어한다.

목표 흐름은 다음과 같다.

## LAN 접근이 가능한 경우

```text
LAN 접근 가능
→ VPN 사용하지 않음
→ SSH 실행
```

## 외부 네트워크인 경우

```text
LAN 접근 불가
→ OpenVPN for Android profile 연결
→ VPN connected 상태 확인
→ 192.168.60.1 또는 192.168.60.177 reachability 확인
→ SSH 실행
```

이 로직을 이번 단계에서 완전히 구현할 필요는 없다.

다만 향후 이 흐름을 구현하는 데 방해가 되는 구조를 만들지 않는다.

---

# 10. 최종 전원 제어 흐름

최종적으로 세 개의 주요 action이 존재한다.

## Power On

```text
필요하면 OpenVPN 연결
↓
SSH → ASUS 192.168.60.1
↓
/usr/sbin/ether-wake -i br0 2C:F0:5D:83:5B:07
↓
Windows PC 부팅
```

## Shutdown

```text
필요하면 OpenVPN 연결
↓
SSH → Windows 192.168.60.177
↓
shutdown /s /t 0
```

## Reboot

```text
필요하면 OpenVPN 연결
↓
SSH → Windows 192.168.60.177
↓
shutdown /r /t 0
```

---

# 11. 코드 품질

다음 설정은 반드시 구성한다.

```text
ESLint
Prettier
TypeScript strict mode
workspace 공통 tsconfig
workspace 공통 eslint 설정
```

가능하면 package별 설정 중복을 줄인다.

루트에서 다음 명령을 제공한다.

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm format
pnpm clean
```

Turborepo task 역시 정리한다.

---

# 12. README 작성

README에는 최소한 다음 내용을 기록한다.

1. 프로젝트 목적
2. 전체 architecture
3. monorepo 구조
4. 필요한 개발환경
5. 설치 방법
6. 웹 개발 서버 실행 방법
7. Capacitor sync 방법
8. Android Studio에서 실행하는 방법
9. debug APK build 방법
10. 각 package 역할
11. 절대로 repository에 넣으면 안 되는 secret 목록

---

# 13. 검증

작업 완료 전에 직접 가능한 범위에서 모두 실행한다.

최소한 다음을 검증한다.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm build
```

Capacitor:

```bash
pnpm --filter mobile exec cap sync android
```

또는 프로젝트 구조에 맞는 equivalent command를 사용한다.

Android SDK가 정상 준비되어 있다면 다음까지 실행한다.

```bash
./gradlew assembleDebug
```

실제 APK compilation까지 확인한다.

빌드 오류가 발생하면 방치하지 말고 원인을 수정한다.

---

# 14. Git 원칙

새 git repository가 아니라면 기존 상태를 먼저 확인한다.

새 프로젝트라면 `git init`까지 진행해도 된다.

단:

- 임의로 원격 저장소를 만들지 않는다.
- 임의로 push하지 않는다.
- 사용자가 요청하지 않았다면 초기 commit도 만들지 않는다.
- secret이 staging될 가능성이 없는지 반드시 확인한다.

---

# 15. 하지 말 것

다음은 하지 않는다.

- Duorem 코드를 가져오지 않는다.
- 오래된 Android 프로젝트를 베이스로 하지 않는다.
- JSch 구버전을 무작정 추가하지 않는다.
- OpenVPN 구현체를 직접 작성하지 않는다.
- `client.ovpn`을 repository에 넣지 않는다.
- SSH private key를 repository에 넣지 않는다.
- 기능이 구현되지 않았는데 성공하는 것처럼 mock 처리하지 않는다.
- 불필요한 backend server를 만들지 않는다.
- Docker를 필요 없이 도입하지 않는다.
- Electron을 도입하지 않는다.
- Next.js를 사용하지 않는다.
- Expo / React Native로 변경하지 않는다.
- 과도한 architecture abstraction을 만들지 않는다.

---

# 완료 기준

이번 작업의 완료 기준은 **예쁜 앱을 만드는 것**이 아니다.

완료 기준은 다음이다.

> 다음 단계에서 SSH / OpenVPN AIDL / PC 제어 기능을 안전하게 구현할 수 있는, 깨끗하고 실제 Android 빌드 가능한 개발 기반을 완성한다.

---

# 최종 보고 형식

작업이 끝나면 아래 형식으로 보고한다.

## 1. 개발환경

설치 또는 확인한 버전:

```text
macOS:
Node:
pnpm:
Java:
Android Studio:
Android SDK:
Gradle:
Capacitor:
```

## 2. 생성한 구조

전체 주요 directory tree를 보여준다.

## 3. 주요 파일

생성하거나 수정한 핵심 파일과 역할을 설명한다.

## 4. 검증 결과

각 항목별 성공 / 실패를 표시한다.

```text
pnpm install
pnpm lint
pnpm typecheck
pnpm build
cap sync android
assembleDebug
```

## 5. 수동으로 남은 작업

사용자가 직접 해야 하는 작업이 있을 경우에만 작성한다.

## 6. 다음 개발 단계

다음 작업으로 권장하는 순서를 최대 5단계로 정리한다.

예:

```text
1. Android SSH plugin 구현
2. 앱 전용 SSH key provisioning
3. OpenVPN for Android AIDL 연결
4. network detection / VPN orchestration
5. 실제 Power On / Shutdown / Reboot UI 연결
```

---

# 추가 원칙

작업 중 기존 macOS 시스템 설정을 불필요하게 변경하지 않는다.

현재 환경을 최대한 재사용하면서 진행한다.
