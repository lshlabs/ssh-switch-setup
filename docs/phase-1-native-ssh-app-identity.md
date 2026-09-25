# Phase 1 — Native SSH + App SSH Identity

## 목표

현재 `pc-control`의 모노레포/Capacitor/Android 기반은 이미 완료되었고, Galaxy S20 실기기에서 `PcControl.getBridgeStatus` 네이티브 브리지 호출까지 성공했다.

이번 Phase에서는 **앱 자체 SSH identity + 실제 Native SSH 실행**까지만 구현한다.

완료 목표:

```text
Galaxy S20
→ Capacitor
→ Kotlin Native SSH
→ SSH key 인증
→ Windows / ASUS
→ hostname / whoami 성공
```

이번 Phase에서는 `OpenVPN AIDL`, `WOL`, `shutdown`, `reboot`, 최종 UI는 구현하지 않는다.

---

## 현재 검증된 대상

### Windows

```text
Host: 192.168.60.177
Port: 22
User: admin
SSH Server: Windows OpenSSH Server
```

테스트 명령:

```cmd
hostname
whoami
```

예상 결과:

```text
DESKTOP-1DC5A6U
desktop-1dc5a6u\admin
```

### ASUS Router

```text
Host: 192.168.60.1
Port: 22
SSH: LAN only
```

테스트 명령:

```sh
hostname
whoami
uname -a
```

이번 Phase에서는 `ether-wake`를 실행하지 않는다.

---

# 1. 앱 전용 SSH Identity

Termux에서 사용하던 private key를 복사하거나 재사용하지 않는다.

앱 전용 SSH key pair를 새로 생성한다.

요구사항:

```text
App SSH Identity
├─ Private key
│  └─ JS에 노출 금지
└─ Public key
   ├─ 앱에서 조회 가능
   └─ 클립보드 복사 가능
```

identity가 없을 때만 생성하고, 이미 존재하면 재사용한다.

가능하면 `ed25519`를 우선한다.

단, Android Keystore / 선택한 SSH library / ASUS 호환성 때문에 불가능하다면 RSA 3072 또는 RSA 4096을 fallback으로 사용할 수 있다.

선택한 알고리즘과 이유를 최종 보고에 남긴다.

---

# 2. Private Key 보관

private key를 다음 위치에 평문으로 저장하지 않는다.

```text
React source
localStorage
plain SharedPreferences
.env
repository
assets
public/
```

Android Keystore를 활용한다.

Android Keystore가 SSH library에서 직접 사용할 수 있는 private key 형태를 제공하지 못한다면:

1. SSH private key material은 앱 내부 저장소에 둔다.
2. 해당 key material을 Android Keystore 기반 encryption key로 암호화한다.
3. 복호화는 native layer 내부에서만 한다.
4. JS layer로 private key를 반환하지 않는다.

---

# 3. SSH Library 선택

오래된 JSch 버전을 무작정 추가하지 않는다.

다음을 확인하고 현재 유지보수되는 Android-compatible SSH library를 선택한다.

- Android 호환성
- 현재 유지보수 여부
- public-key auth
- ed25519 지원
- host key verification
- timeout
- remote command execution
- 라이선스

dependency 추가 이유를 최종 보고에 기록한다.

---

# 4. Host Key 검증

다음을 최종 구현으로 남기지 않는다.

```text
StrictHostKeyChecking=no
unknown host 자동 승인
모든 fingerprint 무시
```

Windows와 ASUS 각각의 SSH host key를 검증한다.

권장 흐름:

```text
최초 fingerprint 확인
→ 승인/등록
→ host별 저장
→ 이후 연결마다 비교
→ mismatch면 연결 차단
```

fingerprint mismatch를 무시하지 않는다.

개발 중 임시 우회가 필요하다면 명확한 개발 전용 TODO를 남기고 Phase 완료 전에 제거한다.

---

# 5. Capacitor Plugin API

`packages/capacitor-pc-control`의 공개 API를 실제 SSH 기능으로 확장한다.

권장 예:

```ts
interface EnsureSshIdentityResult {
  publicKey: string;
}

interface ExecuteSshCommandOptions {
  host: string;
  port?: number;
  username: string;
  command: string;
  hostFingerprint?: string;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
}

interface ExecuteSshCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

ensureSshIdentity();
getSshPublicKey();
executeSshCommand(options);
```

이름은 더 나은 설계가 있으면 변경 가능하다.

React UI가 SSH library, socket, Android Keystore 등의 세부 구현을 직접 알지 않도록 한다.

---

# 6. Error Model

단순 `Error` 하나로 뭉개지 않는다.

최소한 아래 오류를 구분할 수 있게 한다.

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

JS layer에는 구조화된 오류를 전달한다.

예:

```ts
interface PcControlError {
  code: string;
  message: string;
  details?: unknown;
}
```

secret/private key 내용을 error나 log에 포함하지 않는다.

---

# 7. Timeout

무한 대기를 허용하지 않는다.

최소:

```text
connect timeout
command timeout
```

을 분리해서 둔다.

합리적인 기본값은 5~10초 범위에서 선택한다.

---

# 8. 개발용 React UI

최종 디자인은 하지 않는다.

이번 Phase에서 필요한 최소 UI만 만든다.

예:

```text
SSH Identity

Public Key
[ ssh-ed25519 AAAA.... ]

[ Copy Public Key ]

Windows
[ hostname ]
[ whoami ]

ASUS
[ hostname ]
[ whoami ]

Result
stdout
stderr
exitCode
```

과도한 카드, gradient, glassmorphism, animation은 넣지 않는다.

---

# 9. Public Key 등록

앱에서 생성한 public key를 복사할 수 있어야 한다.

### Windows

현재 관리자 계정 `admin`은 아래 파일을 사용한다.

```text
C:\ProgramData\ssh\administrators_authorized_keys
```

기존 Termux public key를 삭제하지 않는다.

앱 public key를 **새 줄에 추가**한다.

### ASUS

기존 SSH 접근을 깨뜨리지 않는 방식으로 앱 public key를 추가한다.

ASUS firmware에서 사용하는 authorized_keys 경로와 영속성 방식을 먼저 확인한다.

기존 key를 덮어쓰지 않는다.

---

# 10. Configuration

실제 host 정보는 여러 파일에 반복 하드코딩하지 않는다.

현재 값:

```text
Windows
Host: 192.168.60.177
Port: 22
Username: admin

ASUS
Host: 192.168.60.1
Port: 22
```

기존 `packages/core`의 configuration layer를 사용하거나 개선한다.

ASUS username 같은 사용자별 값은 적절한 configuration으로 분리한다.

password 기반 SSH는 사용하지 않는다.

---

# 11. 구현 순서

다음 순서로 진행한다.

1. SSH library 조사 및 선택
2. 앱 전용 SSH identity 생성/보관
3. public key 표시/복사
4. Windows/ASUS public key 등록 준비
5. host fingerprint 검증
6. `executeSshCommand()` 구현
7. Windows `hostname`
8. Windows `whoami`
9. ASUS `hostname`
10. ASUS `whoami`

각 단계가 실제로 성공한 뒤 다음 단계로 넘어간다.

---

# 12. 이번 Phase에서 허용되는 Remote Command

Windows:

```cmd
hostname
whoami
```

ASUS:

```sh
hostname
whoami
uname -a
```

실행 금지:

```text
shutdown
reboot
ether-wake
rm
del
registry modification
firewall modification
service modification
```

---

# 13. 기존 프로젝트 존중

현재 프로젝트는 이미 다음을 통과했다.

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
cap sync android
pnpm android:build
testDebugUnitTest
connectedDebugAndroidTest
Galaxy S20 native bridge smoke test
```

기존 구조를 불필요하게 재작성하지 않는다.

이번 기능에 필요한 최소 범위만 수정한다.

---

# 14. 검증

작업 완료 후 최소 다음을 실행한다.

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter mobile exec cap sync android
pnpm android:build
```

가능하면 관련 unit test도 추가한다.

최신 debug APK를 Galaxy S20에 설치하고 cold launch한다.

---

# 15. 실기기 완료 기준

Samsung SM-G981N / Android 13에서 다음을 실제 확인한다.

```text
1. 앱 전용 SSH public key 생성
2. public key 복사 가능
3. Windows에 app public key 등록
4. ASUS에 app public key 등록
5. Windows hostname 성공
6. Windows whoami 성공
7. ASUS hostname 성공
8. ASUS whoami 성공
9. host key 검증 정상
10. 잘못된 fingerprint에서 연결 차단
11. Fatal exception 0
```

private key나 secret은 최종 보고에 포함하지 않는다.

---

# 16. 보안 검사

완료 전에 저장소 전체에서 최소 다음을 검색한다.

```text
BEGIN OPENSSH PRIVATE KEY
BEGIN PRIVATE KEY
client.ovpn
password=
secret=
```

실제 credential이 source/git에 없는지 확인한다.

`git status`, `git diff`를 검토한다.

커밋이나 push는 하지 않는다.

---

# 17. README 업데이트

이번 Phase 완료 후 README에 다음을 추가한다.

- SSH architecture
- 앱 전용 SSH identity
- public key 등록 방법
- host fingerprint 확인/등록 방법
- Windows harmless SSH test
- ASUS harmless SSH test
- secret 관리 원칙

---

# 18. 최종 보고 형식

## 구현

```text
SSH library:
Key algorithm:
Private key storage:
Host key verification:
```

선택 이유를 간단히 설명한다.

## 변경 파일

생성/수정 파일과 역할.

## 실기기 검증

```text
Device:
Android:

Windows hostname:
Windows whoami:

ASUS hostname:
ASUS whoami:

Host key validation:
Fingerprint mismatch rejection:
```

## 빌드/테스트

```text
format:check
lint
typecheck
build
cap sync
android build
unit tests
device install
cold launch
```

성공/실패를 명시한다.

## 보안

```text
private key repository 노출 없음
secret staging 없음
host key 검증 활성
SSH password 사용 없음
```

## 사용자 수동 작업

public key 등록 등 정말 필요한 작업만 적는다.

## 다음 단계

이번 Phase가 완료되면 다음은:

```text
OpenVPN for Android External AIDL
+
LAN/VPN reachability
+
VPN orchestration
```

---

# 핵심 원칙

> 이번 Phase의 목적은 전원 제어가 아니다. Galaxy S20 앱이 자체적으로 안전한 SSH identity를 보유하고, Windows와 ASUS에 host key 검증을 거쳐 SSH key 인증으로 접속하여 harmless command를 안정적으로 실행할 수 있는 기반을 완성한다.
