# Phase 2 — OpenVPN AIDL + Reachability + VPN Orchestration 구현 프롬프트

## 현재 상태

`pc-control` 프로젝트는 Phase 1까지 완료되었다.

현재 Galaxy S20 실기기에서 다음이 검증되었다.

```text
React UI
→ Capacitor
→ Kotlin Native Plugin
→ 앱 전용 SSH Identity
→ Host Key Pinning
→ Windows / ASUS SSH
→ harmless command 실행 성공
```

실기기:

```text
Samsung SM-G981N
Android 13 / API 33
```

Phase 1에서 완료된 핵심:

- Android Keystore 기반 앱 전용 RSA 3072 SSH identity
- public key 기반 SSH 인증
- strict host-key pinning
- fingerprint mismatch 차단
- Windows SSH 성공
- ASUS SSH 성공
- 구조화된 SSH 오류
- harmless command allowlist
- 기존 Native Bridge 유지

이번 Phase에서는 기존 SSH 구현을 재작성하지 않는다.

이번 목표는:

> 앱이 현재 집 LAN에 있는지 실제 reachability로 판단하고, LAN 접근이 불가능하면 `OpenVPN for Android`를 External AIDL API로 자동 연결한 뒤 SSH를 실행할 수 있는 orchestration 기반을 완성한다.

---

# 1. 완료 목표

## 집 LAN

```text
App
↓
192.168.60.1 reachability 성공
↓
VPN 연결하지 않음
↓
Windows / ASUS harmless SSH command 실행
```

## 외부 LTE / 5G

```text
App
↓
192.168.60.1 reachability 실패
↓
OpenVPN for Android 자동 연결
↓
CONNECTED 상태 확인
↓
192.168.60.1 reachability 재확인
↓
Windows / ASUS harmless SSH command 실행
```

이번 Phase에서는 실제 전원 제어는 하지 않는다.

---

# 2. 이번 Phase에서 구현할 것

반드시 구현:

```text
LAN reachability
OpenVPN for Android 설치 여부 확인
OpenVPN profile 조회
OpenVPN profile 선택/저장
OpenVPN connect
OpenVPN disconnect
OpenVPN status 조회
OpenVPN status callback
VPN 연결 완료 대기
VPN 연결 후 LAN reachability 재확인
LAN direct / VPN fallback orchestration
구조화된 network / VPN error
개발용 Phase 2 UI
Galaxy S20 실기기 검증
```

---

# 3. 이번 Phase에서 하지 말 것

```text
shutdown
reboot
ether-wake
PC Power On 버튼 최종 연결
PC Shutdown 버튼 최종 연결
PC Reboot 버튼 최종 연결
최종 PC online/offline 상태 모델
최종 UI 디자인
release signing
Play Store 배포
```

기능 범위를 VPN 연결과 네트워크 orchestration에 집중한다.

---

# 4. 실제 네트워크 환경

## LAN

```text
Subnet: 192.168.60.0/24
ASUS Router: 192.168.60.1
Windows PC: 192.168.60.177
```

## OpenVPN

```text
VPN Client Subnet: 10.8.0.0/24
```

Galaxy S20에서 수동 OpenVPN 연결 시 실제 VPN IP 예:

```text
10.8.0.6
```

Windows OpenSSH 방화벽은 이미 다음 두 대역을 허용한다.

```text
192.168.60.0/24
10.8.0.0/24
```

---

# 5. OpenVPN for Android

사용 앱:

```text
OpenVPN for Android
Package: de.blinkt.openvpn
```

VPN 엔진을 앱 내부에 구현하지 않는다.

`OpenVPN for Android`가 제공하는 **External AIDL API**를 이용한다.

공식 remote API / remoteExample 구조를 참고하되 필요한 범위만 최소한으로 구현한다.

---

# 6. OpenVPN 연동 기본 원칙

Kotlin native layer에서 OpenVPN AIDL을 담당한다.

React UI가 다음을 직접 알면 안 된다.

```text
ServiceConnection
IBinder
AIDL callback
OpenVPN internal service class
Android VPN permission internals
```

React는 Capacitor Plugin의 추상화된 API만 호출한다.

예:

```ts
isOpenVpnInstalled()
getOpenVpnProfiles()
getOpenVpnStatus()
connectOpenVpn()
disconnectOpenVpn()
```

더 나은 API 구조가 있다면 변경해도 된다.

---

# 7. OpenVPN 설치 여부 확인

`de.blinkt.openvpn`이 설치되어 있는지 native layer에서 확인한다.

설치되어 있지 않다면 구조화된 오류를 반환한다.

```text
OPENVPN_APP_NOT_INSTALLED
```

사용자가 수동으로 설치해야 하는 경우 UI에서도 명확히 표시한다.

---

# 8. OpenVPN Profile 조회

External AIDL API를 이용해 기존 프로필 목록을 조회한다.

반환 모델 예:

```ts
interface OpenVpnProfile {
  id: string;
  name: string;
}
```

Galaxy S20에 이미 import된 실제 OpenVPN profile을 조회할 수 있어야 한다.

사용자가 앱에서 profile을 선택할 수 있게 한다.

선택한 profile ID는 안전한 local configuration에 저장한다.

profile 자체의 credential이나 `.ovpn` 내용은 복사하거나 저장하지 않는다.

---

# 9. Credential 정책

다음은 앱 repository나 React source로 가져오지 않는다.

```text
client.ovpn
VPN username
VPN password
OpenVPN private key
OpenVPN certificate private material
```

OpenVPN 인증정보는 `OpenVPN for Android` 앱이 이미 보유한 profile configuration을 그대로 사용한다.

우리 앱은 profile ID만 기억한다.

---

# 10. OpenVPN Connection Lifecycle

다음 lifecycle을 명확히 구현한다.

```text
DISCONNECTED
CONNECTING
CONNECTED
DISCONNECTING
ERROR
```

Boolean 하나로 모든 VPN 상태를 표현하지 않는다.

가능하면 native AIDL callback 기반으로 상태를 추적한다. polling만으로 구현하지 않는다.

---

# 11. VPN 연결 완료 판정

`connectOpenVpn()` 호출 성공 자체를 VPN 연결 완료로 간주하지 않는다.

```text
connect request
↓
CONNECTING
↓
AIDL callback
↓
CONNECTED
↓
LAN target reachability 확인
↓
실제 사용 가능
```

`CONNECTED` callback 이후에도 반드시 내부 LAN target 접근 여부를 확인한다.

---

# 12. Reachability 구현

`checkHost()`를 실제 구현한다.

단순 Android network state나 Wi-Fi 연결 여부로 판단하지 않는다.

실제 TCP target 접근 가능 여부를 확인한다.

권장 target:

```text
ASUS: 192.168.60.1:22
Windows: 192.168.60.177:22
```

기본 Home Network 판별은 Router reachability를 우선 사용해도 된다.

예:

```ts
interface CheckHostOptions {
  host: string;
  port: number;
  timeoutMs?: number;
}

interface CheckHostResult {
  reachable: boolean;
  latencyMs?: number;
}
```

TCP socket connect 기반의 가벼운 reachability check를 권장한다. SSH handshake까지 수행할 필요는 없다.

---

# 13. Reachability Timeout

reachability는 빠르게 실패해야 한다.

권장 기본값:

```text
1.5 ~ 3 seconds
```

무한 대기를 허용하지 않는다.

---

# 14. Network State 모델

최소 다음처럼 표현한다.

```text
LOCAL
VPN
UNAVAILABLE
UNKNOWN
```

예:

```ts
type HomeNetworkState =
  | "local"
  | "vpn"
  | "unavailable"
  | "unknown";
```

판정 예:

```text
192.168.60.1 reachable + VPN disconnected → LOCAL
192.168.60.1 reachable + OpenVPN connected → VPN
192.168.60.1 unreachable → UNAVAILABLE
아직 검사 전 → UNKNOWN
```

Wi-Fi 여부 자체를 `LOCAL` 판정 근거로 사용하지 않는다.

---

# 15. 핵심 Orchestration

이번 Phase의 핵심 API를 하나 만든다.

예:

```ts
ensureHomeNetwork()
```

목표 동작:

```text
1. Router reachability 확인

2-A. reachable
    → 바로 success

2-B. unreachable
    → OpenVPN profile 선택 여부 확인
    → OpenVPN 연결 요청
    → CONNECTED callback 대기
    → Router reachability 재확인
    → 성공 시 success

3. 실패 시 구조화된 error 반환
```

결과 예:

```ts
interface EnsureHomeNetworkResult {
  path: "local" | "vpn";
  vpnWasStartedByApp: boolean;
}
```

---

# 16. VPN 자동 연결 정책

VPN은 필요할 때만 연결한다.

```text
Router reachable → VPN connect 금지
Router unreachable → VPN connect
```

이미 OpenVPN이 connected 상태라면 중복 connect하지 않는다.

CONNECTING 중이라면 기존 연결 완료를 기다린다.

동시에 여러 action이 들어올 때 VPN connect가 중복 실행되지 않도록 한다.

필요하면 mutex / single-flight / state guard를 사용한다.

---

# 17. VPN 자동 해제 기반

이번 Phase에서는 자동 해제 정책의 기반까지 만든다.

```text
앱이 VPN을 시작한 경우만 → 작업 후 자동 해제 가능
사용자가 이미 VPN을 켜둔 상태 → 앱이 임의로 끄지 않음
```

즉 `vpnWasStartedByApp` 상태를 추적할 수 있어야 한다.

개발 UI에 다음 옵션을 둘 수 있다.

```text
[ ] 작업 후 앱이 연결한 VPN 자동 해제
```

---

# 18. Android Service Binding

OpenVPN AIDL service binding lifecycle을 안전하게 처리한다.

```text
bind
service connected
register callback
service disconnect
unregister callback
unbind
app lifecycle
process recreation
```

ServiceConnection 누수 금지. callback 중복 등록 금지.

---

# 19. Android VPN / External Control Permission

OpenVPN for Android external control에서 사용자 승인이나 permission flow가 필요하면 공식 방식을 따른다.

자동 우회하지 않는다.

필요한 오류 예:

```text
OPENVPN_CONTROL_PERMISSION_REQUIRED
OPENVPN_CONTROL_PERMISSION_DENIED
```

---

# 20. Error Model

최소 다음 오류를 구분한다.

```text
OPENVPN_APP_NOT_INSTALLED
OPENVPN_SERVICE_BIND_FAILED
OPENVPN_CONTROL_PERMISSION_REQUIRED
OPENVPN_CONTROL_PERMISSION_DENIED
OPENVPN_PROFILE_NOT_SELECTED
OPENVPN_PROFILE_NOT_FOUND
OPENVPN_CONNECT_FAILED
OPENVPN_CONNECT_TIMEOUT
OPENVPN_DISCONNECT_FAILED
OPENVPN_STATUS_UNAVAILABLE
HOST_UNREACHABLE
REACHABILITY_TIMEOUT
HOME_NETWORK_UNAVAILABLE
UNKNOWN
```

기존 Phase 1 SSH error model과 충돌하지 않게 통합한다.

---

# 21. Timeout 정책

최소 다음 timeout을 둔다.

```text
reachability timeout
VPN connect timeout
VPN post-connect reachability timeout
```

권장 범위:

```text
reachability: 1.5 ~ 3 sec
VPN connection: 15 ~ 30 sec
post-connect reachability: 3 ~ 5 sec
```

---

# 22. Logging

개발 로그 허용:

```text
OpenVPN installed 여부
service bind state
profile id/name
VPN state transition
reachability target
reachability duration
network path
timeout
error code
```

로그 금지:

```text
VPN password
VPN username
client.ovpn content
private key
certificate private material
SSH private key
```

---

# 23. Phase 2 개발 UI

최종 UI는 만들지 않는다.

기능 테스트용 최소 UI만 추가한다.

```text
Phase 2 Network Test

Router
192.168.60.1:22
[ Check ]

OpenVPN
Installed: yes
Profile: HOME
State: disconnected

[ Refresh Profiles ]
[ Connect ]
[ Disconnect ]

Home Network
[ Ensure Home Network ]

Result:
local / vpn / unavailable

Windows
[ Run hostname via ensured network ]

ASUS
[ Run uname -n via ensured network ]
```

기존 Phase 1 SSH UI는 필요한 범위에서 유지한다.

---

# 24. Harmless SSH Integration Test

이번 Phase의 최종 orchestration 테스트는 전원 명령 대신 harmless command를 사용한다.

Windows:

```cmd
hostname
```

ASUS:

```sh
uname -n
```

외부 LTE에서 최종적으로 다음을 검증한다.

```text
VPN OFF
↓
Ensure Home Network
↓
OpenVPN 자동 연결
↓
Router reachable
↓
Windows hostname 또는 ASUS uname -n
↓
성공
```

---

# 25. 외부 LTE 실기기 테스트

Galaxy S20에서 Wi-Fi를 끈다.

초기 조건:

```text
LTE / 5G ON
OpenVPN OFF
```

검증:

```text
1. Router check → unreachable
2. OpenVPN profile 조회 성공
3. 선택 profile connect
4. VPN CONNECTED
5. Router check → reachable
6. Windows harmless SSH 성공
7. ASUS harmless SSH 성공
```

---

# 26. 집 LAN 회귀 테스트

가능한 경우 집 LAN에서도 검증한다.

```text
Wi-Fi ON
OpenVPN OFF
```

검증:

```text
1. Router reachability 성공
2. OpenVPN connect 호출되지 않음
3. Windows harmless SSH 성공
4. ASUS harmless SSH 성공
```

집 LAN 실기기 테스트를 당장 할 수 없다면 최종 보고에 미검증 항목으로 남긴다.

---

# 27. 기존 SSH 구현 보호

Phase 1에서 검증 완료된 다음을 깨뜨리지 않는다.

```text
앱 전용 SSH identity
RSA 3072
Android Keystore
Host key pinning
HOST_KEY_MISMATCH 차단
Windows SSH
ASUS SSH
harmless command allowlist
```

OpenVPN 기능을 추가하면서 SSH security를 완화하지 않는다.

---

# 28. Thread / Coroutine 정책

네트워크, binder, SSH 관련 blocking 작업은 main thread에서 실행하지 않는다.

Kotlin coroutine 사용 시:

- scope ownership 명확히
- cancellation 처리
- timeout 처리
- lifecycle 누수 방지
- Capacitor callback 중복 resolve/reject 금지

---

# 29. 테스트

가능하면 다음을 추가한다.

```text
reachability result mapping
VPN state mapping
error mapping
ensureHomeNetwork local path
ensureHomeNetwork VPN fallback path
already-connected VPN path
connect timeout path
post-connect unreachable path
vpnWasStartedByApp behavior
```

AIDL 의존 부분은 적절한 interface abstraction으로 테스트 가능하게 분리한다.

과도한 mock architecture는 만들지 않는다.

---

# 30. README 업데이트

Phase 2 완료 후 README에 추가:

```text
OpenVPN for Android dependency
External AIDL architecture
profile selection
reachability strategy
local vs VPN network path
VPN lifecycle
external control permission
Phase 2 test procedure
```

---

# 31. Git / Secret 정책

작업 전 `git status`를 확인한다.

다음을 저장소에 넣지 않는다.

```text
client.ovpn
VPN password
VPN username
SSH private key
certificate private key
```

사용자 요청 없이 commit / push하지 않는다.

---

# 32. 빌드 검증

최소 실행:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter mobile exec cap sync android
pnpm android:build
```

기존 Phase 문서 포맷 문제로 전체 `format:check`가 실패한다면 이번 변경 문제인지 기존 문서 문제인지 구분해 보고한다.

가능하면 간단히 정리해 전체 check를 green으로 만든다.

---

# 33. Galaxy S20 검증

최신 APK를 Samsung SM-G981N에 설치한다.

최소 확인:

```text
cold launch 성공
fatal exception 0
OpenVPN app detection 성공
profile 조회 성공
manual connect 성공
manual disconnect 성공
external LTE 자동 connect 성공
post-connect reachability 성공
Windows harmless SSH 성공
ASUS harmless SSH 성공
```

---

# 34. 완료 기준

Phase 2는 아래가 실제로 동작할 때 완료다.

```text
Galaxy S20
LTE / 5G
OpenVPN OFF
↓
PC Control 앱에서 하나의 테스트 action 실행
↓
Router LAN 접근 실패 감지
↓
OpenVPN for Android 자동 연결
↓
CONNECTED 확인
↓
192.168.60.1 접근 가능 확인
↓
Windows 또는 ASUS harmless SSH command 실행 성공
```

그리고 집 LAN에서는:

```text
Router reachable
↓
OpenVPN 생략
↓
SSH 바로 실행
```

---

# 35. 최종 보고 형식

## 1. 구현 내용

```text
OpenVPN AIDL:
Reachability:
Network state:
VPN lifecycle:
Orchestration:
```

## 2. 변경 파일

생성 / 수정 파일과 역할.

## 3. Galaxy S20 실기기 결과

```text
Device:
Android:

OpenVPN installed:
Profile discovery:
Connect:
Disconnect:

LTE pre-VPN reachability:
LTE post-VPN reachability:

Windows harmless SSH:
ASUS harmless SSH:
```

## 4. LAN 회귀 테스트

```text
Router direct reachability:
VPN bypass:
Windows SSH:
ASUS SSH:
```

실행하지 못했다면 미검증으로 표시한다.

## 5. Error 검증

최소 다음 중 가능한 항목을 검증한다.

```text
OpenVPN 미설치
profile 미선택
connect timeout
post-connect reachability 실패
```

## 6. 빌드 / 테스트

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

## 7. 보안 확인

```text
VPN credential repository 노출 없음
client.ovpn repository 노출 없음
SSH private key 노출 없음
host-key pinning 유지
```

## 8. 사용자 수동 작업

정말 필요한 항목만 작성한다.

## 9. 다음 단계

Phase 2가 완료되면 Phase 3:

```text
Power On
→ ASUS SSH
→ ether-wake

Shutdown
→ Windows SSH
→ shutdown /s /t 0

Reboot
→ Windows SSH
→ shutdown /r /t 0

+ PC state detection
```

---

# 핵심 원칙

> 앱은 사용자가 현재 집 Wi-Fi인지 외부 LTE인지 신경 쓰지 않아도 되도록 만들어야 한다.

> LAN 접근이 가능하면 VPN을 생략하고, 불가능하면 OpenVPN for Android를 자동 연결한 뒤 실제 LAN reachability를 확인하고 SSH를 실행한다.

> 이번 Phase에서는 전원 명령을 붙이지 않고 이 네트워크 orchestration을 harmless command로 먼저 완전히 검증한다.
