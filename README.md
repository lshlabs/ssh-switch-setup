# PC Control

PC Control은 Android 휴대폰에서 개인 Windows PC를 안전하게 켜고, 종료하고, 재부팅하는 앱입니다. 집 안에서는 LAN을 사용하고, 집 밖에서는 [OpenVPN for Android](https://play.google.com/store/apps/details?id=de.blinkt.openvpn)의 기존 프로필을 사용합니다.

## 빠른 시작

1. Android 앱을 설치하고 온보딩을 시작합니다.
2. Windows PC에서 관리자 PowerShell로 [`scripts/setup-windows-ssh.ps1`](scripts/setup-windows-ssh.ps1)를 실행합니다.
3. 앱에서 만든 공개키를 스크립트에 붙여 넣어 Windows SSH 인증을 준비합니다.
4. 앱에서 PC 주소, Windows 사용자 이름, MAC 주소를 입력합니다.
5. PC를 켤 때 사용할 MAC 주소와 공유기 SSH/WOL 정보를 선택적으로 입력합니다.
6. 집 밖에서도 사용할 경우 OpenVPN 프로필을 선택합니다.
7. 온보딩의 연결 테스트를 통과하면 전원 버튼을 사용할 수 있습니다.

전원 명령은 연결 테스트에서 실행하지 않습니다. 테스트는 주소 확인과 `hostname` 같은 harmless SSH 명령만 사용합니다.

## 준비물

- Windows 10/11 PC와 OpenSSH Server
- Android 휴대폰
- PC의 LAN 주소 또는 hostname, Windows 사용자 이름, MAC 주소
- 외부 접속이 필요하면 OpenVPN for Android와 집으로 연결되는 VPN 프로필
- 원격 Power On이 필요하면 SSH와 LAN-side WOL 도구를 제공하는 공유기 또는 게이트웨이

## Windows 설정

1. 앱 온보딩 또는 진단 화면에서 앱 공개키를 복사합니다.
2. Windows PC에서 **관리자 권한 PowerShell**을 엽니다.
3. 저장소의 스크립트를 내려받아 다음처럼 실행합니다.

```powershell
.\scripts\setup-windows-ssh.ps1 -PublicKey "ssh-rsa AAAA..."
```

키를 명령줄에 남기고 싶지 않다면 인자를 생략하면 스크립트가 붙여 넣기를 요청합니다.

```powershell
.\scripts\setup-windows-ssh.ps1
```

스크립트는 OpenSSH Server 설치 여부를 확인하고, `sshd`를 자동 시작 서비스로 설정하며, `administrators_authorized_keys`에 키를 중복 없이 추가하고, TCP 22 방화벽 규칙을 Private profile의 `LocalSubnet`으로 제한합니다. 기존 키를 지우고 교체하는 동작은 명시적으로 `-ReplaceKey`를 사용할 때만 수행합니다.

## 공개키와 서버 확인

PC Control은 비밀번호 대신 Android 기기에서 만든 SSH 키를 사용합니다. 개인키는 Android Keystore에 남고 기기 밖으로 내보내지지 않습니다. 공개키를 Windows와 공유기에 각각 한 줄씩 추가하세요.

첫 연결 전에는 앱의 호스트 키 스캔 결과를 별도의 신뢰 경로에서 확인한 뒤 신뢰해야 합니다. 서버를 재설치하거나 키가 바뀌면 앱은 연결을 차단할 수 있습니다.

앱을 삭제하거나 앱 데이터를 초기화하면 SSH identity가 새로 만들어질 수 있습니다. 그 경우 PC와 공유기에 새 공개키를 다시 등록하세요.

## Wake-on-LAN과 공유기 호환성

Power On은 유효한 MAC 주소와 공유기 SSH/WOL 설정이 있을 때 자동으로 사용할 수 있습니다. 설정이 없으면 Power On만 비활성화되고 Shutdown과 Reboot는 계속 사용할 수 있습니다.

공유기 SSH를 통해 LAN 안으로 WOL 패킷을 보냅니다. ASUS Router + `ether-wake`는 현재 검증된 preset입니다.

ASUS가 아닌 공유기도 SSH와 LAN-side WOL 유틸리티를 제공하면 호환될 수 있지만 보장하지 않습니다. OpenWrt/Linux 기반 공유기는 모델별 설정을 확인해야 합니다. ISP 제공 공유기처럼 SSH 또는 LAN WOL을 제공하지 않는 장치에서는 원격 Power On을 사용할 수 없을 수 있습니다. 공유기를 WAN에 노출하거나 SSH 방화벽을 전체 인터넷으로 열지 마세요.

## 집 밖에서 사용하기

휴대폰이 집 네트워크에 안전하게 들어와야 PC의 사설 주소에 접근할 수 있습니다. PC Control은 VPN 엔진이나 인증서를 직접 관리하지 않고 OpenVPN for Android의 External API와 사용자가 선택한 프로필만 사용합니다. 프로필 이름만 앱에 저장하며 VPN 자격 증명과 프로필 내용은 저장하지 않습니다.

## 문제 해결

- **PC에 연결할 수 없음**: PC 주소, TCP 22, Windows 방화벽의 LocalSubnet 범위, VPN 연결을 확인합니다.
- **SSH 공개키 인증 실패**: 현재 앱 공개키가 `C:\ProgramData\ssh\administrators_authorized_keys`에 있는지 확인합니다.
- **서버 확인 실패**: 서버 지문이 바뀐 이유를 먼저 확인한 뒤 앱에서 새 지문을 신뢰합니다.
- **공유기 연결 실패**: 공유기 SSH가 LAN only인지, 앱 공개키와 사용자가 맞는지, WOL 도구와 인터페이스 이름이 맞는지 확인합니다.
- **OpenVPN 프로필이 없음**: OpenVPN for Android에서 프로필을 가져온 뒤 앱의 설정에서 목록을 새로고침합니다.
- **Power On만 사용할 수 없음**: 필요한 MAC 주소·공유기 주소·사용자·인터페이스가 입력되었는지 확인합니다.

## 개발자 문서

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm android:test
pnpm android:build
```

구조는 `apps/mobile`(React UI), `packages/core`(플랫폼 독립 모델), `packages/capacitor-pc-control`(Android native bridge)로 나뉩니다. React는 UI를 담당하고 SSH, 네트워크, VPN, 전원 orchestration은 native layer가 담당합니다.

실제 기기에서의 SSH host-key 등록, VPN 연결, 그리고 Power On/Shutdown/Reboot는 이 저장소의 자동 빌드가 대신 실행하지 않습니다. 변경 후에는 harmless SSH 테스트를 먼저 수행하고, 실제 전원 명령은 기기에서 수동으로 확인하세요.
