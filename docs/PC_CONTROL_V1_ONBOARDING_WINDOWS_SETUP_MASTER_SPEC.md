# PC Control V1 온보딩 · Windows 자동설정 아키텍처 마스터 명세서

**문서 상태:** V1 구현 기준본  
**범위:** Android PC Control 앱 + Windows 초기설정 프로그램  
**목적:** V1에서 필요한 제품 구조, 온보딩 분기, 페어링, Windows 자동설정, 수동설정, OpenVPN, WOL, DHCP 주소 변경 대응을 하나의 기준으로 고정한다.

---

# 1. V1의 핵심 원칙

V1은 기존의 **SSH + OpenVPN + 공유기 SSH/WOL** 실행 구조를 유지한다.

Windows 프로그램은 Sunshine처럼 상시 통신을 담당하는 Host가 아니다.

> **PC Control for Windows V1 = 최초 설정과 페어링을 간단하게 만들어주는 Setup Utility**

설정이 완료된 뒤 Windows 프로그램은 종료하거나 삭제해도 PC Control의 기본 기능이 계속 동작해야 한다.

V1에서 하지 않는 것:

- PC Control 전용 인터넷 통신 프로토콜
- SSH 대체
- OpenVPN 대체
- Relay 서버
- NAT traversal
- UPnP 기반 외부 접속
- 상주 Windows Service
- 상시 실행 Tray Host
- 자체 원격 제어 서버

실제 사용 경로는 계속 다음과 같다.

```text
같은 네트워크
Phone
  ↓ SSH
PC

외부 네트워크
Phone
  ↓ OpenVPN
Home LAN
  ↓ SSH
PC

PC Wake
Phone
  ↓ 필요 시 OpenVPN
공유기 SSH
  ↓ ether-wake
PC
```

---

# 2. V1 기술 스택 최종 결정

## 2.1 Windows Setup

| 영역 | 기술 |
|---|---|
| Desktop Shell | **Tauri 2** |
| UI | **React + TypeScript** |
| Build | **Vite** |
| Styling | **Tailwind CSS** |
| System backend | **Rust** |
| Windows/OpenSSH 설정 | 기존 **PowerShell 로직 재사용** |
| LAN discovery | **mDNS / DNS-SD** |
| Android discovery | **NsdManager** |
| QR | 일반 QR library |
| Pairing transport | 임시 LAN Pairing API |
| 실제 PC 제어 | 기존 **SSH** |
| 외부 접속 | 기존 **OpenVPN** |
| Background service | 없음 |
| 상시 Host | 없음 |

## 2.2 대안 검토 결론

### Electron
Web frontend 재사용은 쉽지만 Setup Utility 용도에 비해 runtime과 배포 크기가 크다. **채택하지 않는다.**

### .NET / WinUI 3
Windows API 접근성은 좋지만 현재 React/Vite/Tailwind UI 자산 재사용성이 크게 떨어진다. **현재 프로젝트에서는 Tauri보다 이점이 작다.**

### Wails / Go
기술적으로 가능하지만 현재 프로젝트 기준 결정적인 이점이 없다. **채택하지 않는다.**

## 2.3 중요한 구조 결정

Windows Setup GUI를 별도의 `localhost` 브라우저 페이지로 만들지 않는다.

V1에서는:

```text
Tauri Window
└ React + Vite + Tailwind UI
```

를 사용한다.

Rust backend가 시스템 작업과 임시 LAN Pairing API를 담당한다.

GUI를 위해 별도의 localhost web server를 만들지 않으므로 구조가 단순하고 공격면도 줄어든다.

---

# 3. Windows Setup 권한 모델

프로그램 전체를 항상 관리자 권한으로 실행하지 않는다.

```text
일반 권한으로 실행
↓
PC 정보 확인
↓
관리자 권한이 필요한 작업 발생
↓
Windows UAC
↓
정해진 privileged operation 수행
↓
일반 UI로 복귀
```

관리자 권한이 필요할 수 있는 작업:

- OpenSSH Server 설치
- sshd 설정
- sshd 서비스 시작/자동 시작
- Windows Firewall 설정
- 관리자 계정용 authorized_keys 수정
- 기타 시스템 설정 변경

Frontend가 임의 PowerShell 명령을 실행할 수 있게 만들지 않는다.

권장:

```text
invoke("prepare_openssh")
invoke("register_phone_key")
invoke("get_pc_connection_info")
invoke("start_pairing")
```

금지:

```text
invoke("run_shell", arbitraryUserString)
```

Rust backend가 좁은 command만 노출하고 필요한 경우 내부에서 고정된 PowerShell script를 실행한다.

---

# 4. Windows Setup 삭제 정책

설정 완료 후 `PC Control for Windows`는 삭제 가능해야 한다.

삭제해도 유지:

- Windows OpenSSH Server
- sshd 서비스 설정
- sshd 자동 시작
- PC Control 연결에 필요한 Windows Firewall 설정
- 등록된 Phone SSH public key
- SSH host key
- 기타 실제 PC Control 동작에 필요한 설정

즉:

```text
PC Control for Windows 삭제
≠
PC Control 연결 설정 삭제
```

`PC Control 연결 설정 제거`는 프로그램 삭제와 별개의 명시적 작업으로 취급한다.

---

# 5. 모바일 온보딩 첫 분기

## 제목

**PC를 어떻게 설정할까요?**

## 설명

**환경에 맞는 설정 방법을 선택해주세요.**

## 선택 A

Badge:

**추천**

Title:

**PC Control for Windows로 자동 설정**

Summary:

**PC에 프로그램을 설치하면 연결에 필요한 설정을 자동으로 준비해요.**

대상:

- 가정용 PC
- 개인 PC
- 프로그램 설치가 가능한 일반 Windows 환경
- SSH 설정을 직접 다루고 싶지 않은 사용자

## 선택 B

Title:

**설치 없이 수동 설정**

Summary:

**프로그램을 설치할 수 없거나 연결 정보를 직접 설정하려는 경우 사용해요.**

대상:

- 회사 서버
- 설치 권한이 없는 PC
- 이미 SSH 환경이 준비된 서버
- 직접 네트워크 정보를 관리하려는 사용자

UI에서는 `일반 사용자`, `전문가용` 같은 평가성 라벨을 직접 표시하지 않는다.

---

# 6. 전체 온보딩 구조

```text
시작
↓
설정 방식 선택
├─ 자동 설정
│    ↓
│  PC Control for Windows 준비
│    ↓
│  PC 자동 검색 + QR 스캔
│    ↓
│  기기 승인
│    ↓
│  PC 기본 연결 자동 설정
│    ↓
│  실제 SSH 검증
│
└─ 수동 설정
     ↓
   1. PC 기본 연결
     ↓
   2. PC 켜기
     ↓
   3. 다른 네트워크 연결
     ↓
   실제 SSH 검증

자동/수동 공통
↓
PC 연결 완료
↓
필요한 설정 검증
↓
최종 요약
↓
저장
↓
완료
```

---

# 7. 자동 설정 경로

## 7.1 Windows 프로그램 준비

모바일 Title:

**PC Control for Windows를 실행해주세요**

Description:

**PC에서 설정 프로그램을 실행하면 이 휴대폰과 자동으로 연결할 수 있어요.**

Windows Setup 실행 후:

```text
OpenSSH 상태 확인
Windows 계정 확인
SSH 포트 확인
SSH Host Key 확인
네트워크 정보 수집
유선 NIC / MAC 후보 확인
Pairing mode 시작
```

## 7.2 PC 찾기

모바일은 화면 진입과 동시에 mDNS/DNS-SD 검색을 시작한다.

QR은 검색 실패 후 나타나는 fallback이 아니라 **처음부터 동시에 제공**한다.

```text
PC를 찾고 있어요

발견된 PC
┌────────────────────┐
│ DESKTOP-ABC        │
│ Windows PC         │
│            [연결]  │
└────────────────────┘

──────── 또는 ────────

[PC 화면의 QR 코드 스캔]
```

원칙:

- 자동 검색을 기다릴 필요가 없다.
- PC가 바로 발견되면 목록에서 선택한다.
- mDNS가 막혀 있거나 여러 네트워크가 섞인 경우 QR을 바로 사용할 수 있다.
- 두 경로는 같은 Pairing Protocol에 합류한다.

---

# 8. Discovery 기술

Windows Setup:

```text
mDNS / DNS-SD advertisement
```

Android:

```text
NsdManager
```

예시 service type:

```text
_pc-control._tcp.local
```

Discovery는 Pairing endpoint를 찾는 기능일 뿐 신뢰 수단이 아니다.

```text
발견됨
≠
신뢰됨
```

---

# 9. QR의 역할

QR은 PC 설정값 전체를 넣는 설정 파일이 아니라 **Secure Pairing Bootstrap** 용도다.

권장 정보:

```text
protocolVersion
hostId
pairingEndpoint
oneTimeToken
pairingIdentityFingerprint
expiresAt
```

QR에 넣지 않는 것:

- SSH private key
- Windows password
- OpenVPN credential
- 장기 인증 secret
- 불필요한 PC 설정 snapshot

실제 PC 정보는 Pairing Channel을 통해 전달한다.

---

# 10. 최초 기기 승인 방식

자동 검색과 QR 모두 같은 승인 흐름을 사용한다.

> **양쪽에 같은 확인 코드를 표시하고, PC에서 최종 연결 허용**

Phone:

```text
PC에서 연결을 확인해주세요

확인 코드
381 742
```

PC:

```text
새 휴대폰이 연결을 요청했어요

기기
Galaxy ...

확인 코드
381 742

휴대폰에 같은 코드가 표시되어 있는지 확인해주세요.

[거절] [연결]
```

QR을 사용했더라도 PC의 명시적 승인을 생략하지 않는다.

---

# 11. Pairing Protocol

```text
Discovery 또는 QR
↓
Pairing Endpoint 확보
↓
Phone → Pairing Request
↓
양쪽 동일 확인 코드
↓
PC 사용자 승인
↓
Phone SSH public key 전달
↓
Windows Setup이 public key 등록
↓
PC 설정 정보 Phone으로 전달
↓
Phone이 실제 SSH 접속
↓
SSH Host Key 비교
↓
무해한 command로 인증 검증
↓
Pairing 완료
```

Pairing API는 setup 중에만 열려 있는 임시 서비스다.

---

# 12. PC → Phone 전달 정보

```text
hostId
displayName
hostname
currentLanIp
lanSubnet / prefix
sshPort
sshUsername
sshHostKeyFingerprint
macAddressCandidate
networkAdapterInfo
```

필요 시:

```text
defaultGatewayCandidate
```

도 전달할 수 있다.

단:

> 기본 게이트웨이 = WOL용 SSH 공유기

라고 자동 확정하지 않는다.

---

# 13. Phone → PC 전달 정보

핵심:

```text
Phone의 SSH public key
```

절대 전달하지 않음:

```text
SSH private key
```

Phone private key는 Android 기기를 떠나지 않는다.

---

# 14. Windows 계정 처리

자동 설정에서는 모바일에서 Windows username을 직접 입력하지 않는다.

Windows Setup이 실제 사용 가능한 계정을 확인하고 PC 화면에서 선택 또는 확인한다.

```text
PC Control에서 사용할 Windows 계정

● user
○ administrator

[계속]
```

계정에 따라 올바른 authorized_keys 위치와 권한을 설정한다.

---

# 15. 자동 설정 이후 WOL

Windows Setup이 자동 수집 가능한 값:

- 유선 NIC
- NIC 이름
- MAC 주소 후보
- 현재 연결 상태
- 기본 gateway 후보

자동 확정 불가:

- WOL에 사용할 공유기 SSH 계정
- 공유기 SSH port
- 공유기 LAN interface
- 해당 gateway가 실제 WOL 명령 실행 대상인지 여부

V1에서는 WOL 자체를 완전 자동화하지 않는다.

다만 자동 경로에서는 가능하면 PC MAC 주소 직접 입력을 없애고 Windows Setup이 전달한 MAC 후보를 확인/선택하게 한다.

---

# 16. 자동 설정 이후 OpenVPN

V1에서는 OpenVPN을 유지한다.

Windows Setup이 OpenVPN을 대체하지 않는다.

외부 접속을 원하면:

```text
OpenVPN 상태 확인
↓
프로필 선택
↓
기존 OpenVPN 기반 외부 접속
```

Windows Setup은 OpenVPN profile을 생성하거나 VPN server가 되지 않는다.

---

# 17. 수동 설정 경로

수동 설정은 기존처럼 한 질문마다 한 화면으로 길게 진행하지 않는다.

다만 모든 항목을 한 페이지에 몰아넣지도 않는다.

최종 구조:

```text
1. PC 기본 연결
2. PC 켜기
3. 다른 네트워크 연결
```

각 단계는 technical form 형태다.

---

# 18. 수동 설정 1 — PC 기본 연결

Title:

**PC 연결 정보를 입력해주세요**

Description:

**SSH로 PC에 연결할 때 사용할 정보를 입력해주세요.**

Fields:

### PC 주소

허용 예:

```text
192.168.0.10
DESKTOP-ABC.local
기타 연결 가능한 hostname
```

라벨은 `PC IP 주소`가 아니라 **PC 주소**로 한다.

### Windows 사용자 이름

### PC SSH 포트

기본값:

```text
22
```

### 연결 키

```text
[연결 키 복사]
```

설명:

**PC의 authorized_keys에 이 연결 키를 등록해주세요.**

SSH Host Key는 실제 연결 시 확인한다.

CTA:

**연결 확인**

성공 후 다음 수동 단계로 이동한다.

---

# 19. 수동 설정 2 — PC 켜기

Title:

**PC 켜기 설정**

Description:

**앱에서 PC를 켜려면 아래 정보를 입력해주세요. 사용하지 않으려면 건너뛸 수 있어요.**

Toggle:

**PC 켜기 사용**

OFF:

- 관련 field 숨김
- 다음 단계 이동 가능

ON fields:

- PC MAC 주소
- 네트워크 장비(공유기) 주소
- 네트워크 장비 SSH 사용자 이름
- 네트워크 장비 SSH 포트
- LAN 인터페이스 이름

공유기 SSH 포트 기본값:

```text
22
```

CTA:

**계속**

수동 경로에서는 장문의 초보자용 가이드를 기본 노출하지 않는다.

---

# 20. 수동 설정 3 — 다른 네트워크 연결

Title:

**다른 네트워크 연결**

Description:

**외부에서도 PC에 연결하려면 OpenVPN 프로필을 선택해주세요.**

Toggle:

**다른 네트워크에서 연결**

OFF:

→ 건너뜀

ON:

```text
OpenVPN 설치 상태 확인
OpenVPN profile 목록
```

Profile UI:

기존 Settings Preference Radio primitive 사용.

CTA:

**설정 확인**

---

# 21. 자동/수동 공통 검증

두 경로는 공통 SSH 검증으로 합류한다.

```text
PC endpoint 접근
↓
SSH Host Key 확인
↓
등록 fingerprint와 일치 여부
↓
public-key authentication
↓
무해한 command 실행
↓
성공
```

예시 command:

```text
hostname
```

Pairing API 성공만으로 PC 연결 성공 처리하지 않는다.

---

# 22. Host Identity와 Endpoint 분리

## Stable Identity

```text
hostId
SSH Host Key fingerprint
```

보조:

```text
hostname
MAC address
```

## Mutable Endpoint

```text
lastKnownIp
SSH port
```

핵심:

> **IP 주소는 PC의 신원이 아니라 현재 접속 위치다.**

---

# 23. DHCP 정책

사용자에게 DHCP를 끄라고 요구하지 않는다.

다음도 필수 조건으로 만들지 않는다.

```text
DHCP 예약
Static IP
```

일반 DHCP 환경 그대로 사용할 수 있어야 한다.

DHCP lease 만료가 곧 IP 변경을 의미하지는 않지만, 변경되는 경우는 자동 복구한다.

---

# 24. PC Profile 저장값

권장 모델:

```text
PCProfile {
  hostId
  displayName
  hostname
  lastKnownIp
  lanSubnet
  sshPort
  sshUsername
  sshHostKeyFingerprint
  macAddress

  wakeEnabled
  routerHost
  routerSshUsername
  routerSshPort
  lanInterface

  remoteEnabled
  openVpnProfileId
}
```

실제 이름은 기존 Core model과 맞춰 조정한다.

---

# 25. IP 주소 재탐색 전략

앱 실행 때마다 네트워크 전체를 스캔하지 않는다.

> **주소 관련 SSH 연결 실패가 발생했을 때만 자동 복구한다.**

```text
connectToPC()
│
├─ 1. lastKnownIp 시도
│      └ 성공 → 연결 반환
│
├─ 2. hostname resolve 시도
│      └ SSH 연결
│      └ Host Key 일치
│      └ 새 IP 저장
│
├─ 3. 현재 LAN / OpenVPN으로 접근 가능한 subnet에서 후보 탐색
│      └ SSH endpoint 발견
│      └ Host Key 비교
│      └ 동일 PC 발견
│      └ lastKnownIp 갱신
│
└─ 4. 실패
       └ 사용자에게 복구 안내
```

재탐색 대상 오류 예:

```text
connection timeout
host unreachable
no route
connection refused
```

재탐색 대상이 아닌 오류:

```text
authentication failed
permission denied
SSH Host Key mismatch
```

---

# 26. 외부 네트워크에서 IP 재탐색

OpenVPN이 연결되어 있다면 Phone은 Home LAN에 접근 가능하다.

따라서:

```text
OpenVPN 연결
↓
lastKnownIp SSH 실패
↓
hostname / LAN 후보 재탐색
↓
SSH Host Key 비교
↓
등록 PC 발견
↓
lastKnownIp 갱신
```

이 가능하다.

Windows Setup을 다시 실행할 필요는 없다.

---

# 27. MAC 주소 역할

MAC 주소는 다음에 사용한다.

- WOL target
- NIC 식별
- 보조 PC 정보

외부/VPN에서 범용적인:

```text
MAC → IP
```

resolver로 사용하지 않는다.

같은 PC인지 최종 확인하는 핵심 anchor는 **SSH Host Key fingerprint**다.

---

# 28. PC 켜기 흐름

PC가 꺼져 있을 때 현재 PC IP는 필요하지 않다.

```text
사용자가 PC 켜기
↓
필요하면 OpenVPN 연결
↓
공유기 SSH 연결
↓
저장된 PC MAC + LAN interface
↓
ether-wake
↓
Magic Packet
↓
PC 부팅
↓
SSH 온라인 확인
```

온라인 확인:

```text
lastKnownIp
↓
성공 → 온라인

실패
↓
connectToPC() endpoint recovery
↓
새 IP 발견
↓
SSH Host Key 일치
↓
lastKnownIp 갱신
↓
온라인
```

즉:

```text
Wake 자체 → IP 불필요
Wake 이후 상태 확인 → IP 필요, 변경됐으면 재탐색
```

---

# 29. PC 재부팅 흐름

```text
사용자가 재부팅
↓
필요하면 OpenVPN 연결
↓
connectToPC()
├ lastKnownIp 성공
└ 실패 시 endpoint recovery
↓
SSH 연결
↓
reboot command
↓
SSH disconnect
↓
PC 재부팅
↓
필요하면 다시 온라인 상태 확인
```

DHCP 대응은 reboot 기능에 별도로 구현하지 않는다.

---

# 30. PC 끄기 흐름

```text
사용자가 PC 끄기
↓
필요하면 OpenVPN 연결
↓
connectToPC()
├ lastKnownIp 성공
└ 실패 시 endpoint recovery
↓
SSH 연결
↓
shutdown command
↓
PC 종료
```

정상 shutdown 이후 SSH 연결이 끊기는 것을 오류로 취급하지 않는다.

---

# 31. 공통 SSH 연결 계층

다음 기능은 개별 DHCP 대응 코드를 가지지 않는다.

```text
PC 상태 확인
PC 끄기
PC 재부팅
기타 SSH 명령
WOL 후 온라인 확인
```

모두:

```text
connectToPC()
```

를 사용한다.

---

# 32. Setup Discovery 수명

Windows Setup이 열려 있고 Pairing Mode일 때만 mDNS discovery를 제공한다.

설정 완료 후 프로그램이 종료/삭제되면 Setup discovery는 더 이상 존재하지 않는다.

일상 동작은:

```text
SSH + saved profile + endpoint recovery
```

를 사용한다.

---

# 33. Pairing API 수명

```text
Windows Setup 실행
↓
Pairing 화면 진입
↓
Pairing API 활성화
↓
mDNS advertisement
↓
Pairing 완료 또는 취소
↓
Pairing API 종료
↓
mDNS advertisement 종료
```

가능하면 Private network profile과 local subnet에만 접근 범위를 제한한다.

---

# 34. Pairing 보안 원칙

- mDNS discovery 결과를 신뢰하지 않는다.
- QR token은 짧은 유효기간을 가진다.
- QR token은 한 번만 사용할 수 있다.
- Pairing request는 PC 화면에서 명시적 승인을 받는다.
- 양쪽 확인 코드를 pairing session과 묶는다.
- Phone private key는 Phone을 떠나지 않는다.
- PC에는 Phone public key만 등록한다.
- Pairing에서 받은 SSH Host Key fingerprint와 실제 SSH 연결 fingerprint를 비교한다.
- 불일치하면 자동 신뢰하지 않는다.
- Pairing attempt 횟수 제한을 둔다.
- Setup frontend에서 arbitrary shell execution을 허용하지 않는다.

---

# 35. 온보딩 상태 저장 정책

설정 마법사는 항상 처음부터 시작한다.

- Resume 없음
- Draft 영구 저장 없음
- 기존 실제 설정값 자동 주입 없음
- 현재 session 값은 memory에서만 유지

상단 `나중에`:

```text
진행 상황이 저장되지 않아요

지금 나가면 입력한 내용이 사라져요.
설정 마법사를 다시 시작하면 처음부터 진행해야 해요.
```

실제 설정 commit은 최종 완료 시점에만 한다.

---

# 36. 자동 설정 경로의 저장 시점

Pairing 중 SSH key를 PC에 등록하는 것은 실제 PC side configuration이다.

사용자가 Pairing 도중 중단할 경우 Windows Setup에서:

```text
이 휴대폰의 등록을 취소
```

할 수 있어야 한다.

모바일 PC profile은 실제 SSH 검증 성공 후 저장한다.

---

# 37. 실패 복구

## PC 자동 검색 실패
QR이 같은 화면에 있으므로 별도 실패 화면을 만들지 않는다.

## QR 성공 + PC 접근 실패

```text
휴대폰과 PC가 같은 네트워크에 연결되어 있는지 확인해주세요.
게스트 Wi-Fi에서는 기기 간 연결이 제한될 수 있어요.
```

## 승인 만료

```text
연결 요청이 만료됐어요.
PC 화면에서 다시 연결을 시작해주세요.
```

## SSH Host Key mismatch

```text
PC의 보안 정보가 달라요.
연결하려는 PC가 맞는지 다시 확인해주세요.
```

## SSH 인증 실패

```text
연결 키를 등록하지 못했어요.
PC Control for Windows에서 다시 시도해주세요.
```

---

# 38. Windows Setup UI 범위

모바일과 공유:

- color tokens
- typography philosophy
- Button primitive
- Status row
- Choice/Radio primitive
- Form field
- icon language

Windows에 맞게 변경:

- wider content area
- mouse/keyboard interaction
- PC 상태 정보 표시
- multi-column 가능
- QR code와 device approval panel

---

# 39. 권장 repository 구조

```text
apps/
├ mobile/
│  └ current Capacitor app
│
└ windows-setup/
   ├ src/
   │  ├ React
   │  ├ TypeScript
   │  └ Tailwind
   │
   └ src-tauri/
      └ Rust

packages/
├ ui/
│  └ shareable UI primitives
├ design-tokens/
│  └ colors / typography / spacing
├ pairing-protocol/
│  └ request / response schemas
└ core/
   └ shared validation / types
```

Capacitor-specific API는 Windows Setup과 공유하지 않는다.

---

# 40. V1 구현 순서

미래 버전 로드맵은 정의하지 않는다.

## Phase 1 — Windows Setup Core

- Tauri project
- React/Vite/Tailwind
- Windows 정보 수집
- 기존 PowerShell OpenSSH setup 통합
- SSH port/account/host key/MAC 수집
- 관리자 권한 처리

## Phase 2 — QR Pairing

- Pairing session
- QR bootstrap
- Phone public key 전달
- PC 승인
- public key 등록
- SSH Host Key 전달
- 실제 SSH 연결 검증

## Phase 3 — mDNS Discovery

- Windows DNS-SD advertisement
- Android NsdManager
- 발견 PC 목록
- 자동 발견과 QR이 같은 Pairing Protocol로 합류

## Phase 4 — 수동 설정 재구성

- PC 기본 연결 form
- WOL form
- OpenVPN form
- 공통 SSH 검증

## Phase 5 — Endpoint Recovery

- `connectToPC()`
- hostname resolution
- bounded LAN/VPN endpoint rediscovery
- Host Key matching
- `lastKnownIp` 갱신

## Phase 6 — Power Flow Integration

- Wake
- Reboot
- Shutdown
- Status check

모든 SSH 작업을 공통 connection resolver에 연결한다.

---

# 41. V1 완료 기준

## 자동 설정

새 Windows PC에서:

1. PC Control for Windows 설치/실행
2. Phone에서 자동 발견 또는 QR
3. 양쪽 동일 코드 확인
4. PC에서 연결 승인
5. Phone public key 자동 등록
6. IP / username / SSH port 직접 입력 없음
7. 실제 SSH authentication 성공
8. Host Key mismatch는 거부

## 수동 설정

PC Control for Windows 설치 없이:

1. PC 기본 연결
2. WOL 정보
3. OpenVPN 정보

3개의 technical form 단계로 설정 가능.

## 삭제

Windows Setup을 삭제한 뒤에도:

- SSH 상태 확인
- PC 끄기
- PC 재부팅
- WOL
- OpenVPN 외부 연결

이 계속 동작한다.

## DHCP

PC LAN IP가 바뀌면:

```text
기존 IP 실패
→ endpoint rediscovery
→ SSH Host Key 일치
→ 새 IP 저장
→ 원래 작업 재시도
```

가 가능하다.

사용자는 DHCP를 끄거나 Static IP를 반드시 설정할 필요가 없다.

---

# 42. 최종 사용자 경험

## 일반 사용자

```text
PC를 어떻게 설정할까요?

[추천]
PC Control for Windows로 자동 설정
↓
PC에서 프로그램 실행
↓
Phone에 PC 자동 표시
또는 QR 스캔
↓
양쪽 코드 확인
↓
PC에서 연결 허용
↓
자동 설정
↓
연결 완료
```

기본 PC 연결 과정에서 사용자가 직접 다루지 않는 항목:

- PC IP
- Windows username
- SSH port
- public key 등록
- Host Key 직접 비교

## 수동 사용자

```text
설치 없이 수동 설정
↓
PC 기본 연결
↓
PC 켜기
↓
다른 네트워크 연결
↓
검증
↓
완료
```

설명은 최소화하고 필요한 기술 정보 입력에 집중한다.

---

# 43. V1 한 문장 정의

> **PC Control V1은 기존 SSH + OpenVPN + 공유기 WOL 실행 구조를 유지하면서, PC Control for Windows라는 삭제 가능한 Setup Utility를 통해 일반 사용자의 최초 PC 연결을 자동화하고, 설치가 어려운 환경에는 3단계 수동 설정 경로를 동시에 제공한다.**
