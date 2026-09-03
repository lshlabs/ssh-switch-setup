# Galaxy 시스템 설정 UI 해체 분석

## 1. 문서 목적

이 문서는 ADB로 연결된 실제 Galaxy 기기의 시스템 설정 앱을 여러 화면으로 이동하면서 캡처하고, 각 화면의 시각 구조와 UI 계층을 기록한 실기기 관찰 문서다.

이 문서만 읽어도 화면을 직접 보지 않고 다음을 파악할 수 있어야 한다.

- 설정 홈의 전체 정보 구조와 스크롤 구간
- 연결, Wi-Fi, 연결된 Wi-Fi 상세, 디스플레이, 일반, 보안 및 개인정보 보호 화면의 배치
- 카드와 row가 어떻게 묶이고 분리되는지
- 상태값·요약문·토글·하단 동작이 어느 UI 슬롯에 표시되는지
- UIAutomator에서 노출되는 텍스트, resource-id, 클래스, 접근성 설명, bounds
- 화면 이동이 Activity와 back stack으로 어떻게 표현되는지
- 같은 화면에서 단순 조회와 실제 설정 변경을 어떻게 구분해야 하는지

이 문서는 프로젝트 앱의 구현 문서가 아니다. 캡처 시점의 포그라운드 앱은 프로젝트 앱이 아닌 삼성 시스템 설정이었다.

> 주의: 일부 캡처에는 기기에서 사용 중인 Wi-Fi 이름, 로컬 IP, MAC 주소처럼 장치 식별 정보가 보인다. 문서 본문에서는 가능한 한 값을 반복하지 않았지만, 원본 이미지/XML은 외부 공유나 커밋 전에 검토해야 한다.

## 2. 분석 대상과 캡처 방법

### 2.1 캡처 시점 환경

| 항목                        | 관찰값                                           |
| --------------------------- | ------------------------------------------------ |
| 기기 모델                   | Samsung SM-G981N                                 |
| Android                     | 13                                               |
| One UI 식별값               | 50100 (5.1 계열로 해석)                          |
| 물리 해상도                 | 1440 × 3200                                      |
| ADB override 해상도         | 1080 × 2400                                      |
| 논리 앱 창 bounds           | 0,0 ~ 1080,2178                                  |
| 시스템 상태 표시줄          | y=0 ~ 78                                         |
| 앱 콘텐츠 시작              | y=78 이후                                        |
| 하단 시스템 내비게이션 영역 | 앱 UI dump에서 제외된 별도 영역                  |
| 포그라운드 패키지           | com.android.settings                             |
| 포그라운드 Activity         | com.android.settings/.Settings 또는 .SubSettings |
| 테마                        | 다크 모드                                        |
| 글자 배율                   | 1.0                                              |

### 2.2 수행한 작업

다음 작업만 수행했다.

- 현재 화면 스크린샷 캡처
- uiautomator dump로 현재 UI 계층 저장
- dumpsys activity로 현재 Activity 확인
- 설정 홈의 하위 화면으로 탭 이동
- 화면 내부 스크롤
- back으로 이전 화면 복귀

다음 작업은 수행하지 않았다.

- Wi-Fi, Bluetooth, NFC, 비행기 탑승 모드 토글 변경
- 네트워크 연결/해제
- 저장된 네트워크 삭제
- QR 코드 생성·공유
- 보안·권한·잠금 설정 변경
- 소프트웨어 업데이트 실행
- 전원·재부팅·종료

### 2.3 재현에 사용한 읽기 명령

    adb devices -l
    adb shell wm size
    adb shell dumpsys activity activities
    adb exec-out screencap -p > <capture>.png
    adb shell uiautomator dump /sdcard/window.xml
    adb pull /sdcard/window.xml <capture>.xml

화면을 하위 페이지로 이동할 때는 UI bounds를 참고해 adb shell input tap을 사용했고, 화면 이동 후 매번 PNG와 XML을 함께 저장했다. 좌표는 이 기기의 1080 × 2400 override 기준이며, 다른 해상도나 글자 크기에서는 달라질 수 있다.

## 3. 캡처 목록

PNG는 사람이 보는 시각 캡처이고, 같은 번호의 XML은 캡처 직후 UIAutomator 계층이다. XML은 구현 소스가 아니라 현재 화면에 노출된 접근성/UI 노드의 스냅샷이다.

| 번호 | 화면                                | Activity     | 시각 캡처                                                               | UI 계층                                                                 |
| ---: | ----------------------------------- | ------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
|   01 | 설정 홈: 캡처 당시 현재 스크롤 상태 | .Settings    | [PNG](screenshots/galaxy-settings/01-current-settings.png)              | [XML](screenshots/galaxy-settings/01-current-settings.xml)              |
|   02 | 연결                                | .SubSettings | [PNG](screenshots/galaxy-settings/02-connections.png)                   | [XML](screenshots/galaxy-settings/02-connections.xml)                   |
|   03 | Wi-Fi 목록                          | .SubSettings | [PNG](screenshots/galaxy-settings/03-wifi.png)                          | [XML](screenshots/galaxy-settings/03-wifi.xml)                          |
|   04 | Wi-Fi 목록 확장 상태                | .SubSettings | [PNG](screenshots/galaxy-settings/04-wifi-network-details.png)          | [XML](screenshots/galaxy-settings/04-wifi-network-details.xml)          |
|   05 | 연결된 Wi-Fi 상세 상단              | .SubSettings | [PNG](screenshots/galaxy-settings/05-wifi-network-settings.png)         | [XML](screenshots/galaxy-settings/05-wifi-network-settings.xml)         |
|   06 | Wi-Fi 상세 더보기 확장              | .SubSettings | [PNG](screenshots/galaxy-settings/06-wifi-network-more.png)             | [XML](screenshots/galaxy-settings/06-wifi-network-more.xml)             |
|   07 | Wi-Fi 상세 하단 스크롤              | .SubSettings | [PNG](screenshots/galaxy-settings/07-wifi-network-details-scrolled.png) | [XML](screenshots/galaxy-settings/07-wifi-network-details-scrolled.xml) |
|   08 | 설정 홈 복귀                        | .Settings    | [PNG](screenshots/galaxy-settings/08-settings-main-restored.png)        | [XML](screenshots/galaxy-settings/08-settings-main-restored.xml)        |
|   09 | 디스플레이                          | .SubSettings | [PNG](screenshots/galaxy-settings/09-display.png)                       | [XML](screenshots/galaxy-settings/09-display.xml)                       |
|   10 | 설정 홈 중간                        | .Settings    | [PNG](screenshots/galaxy-settings/10-settings-main-lower.png)           | [XML](screenshots/galaxy-settings/10-settings-main-lower.xml)           |
|   11 | 설정 홈 하단                        | .Settings    | [PNG](screenshots/galaxy-settings/11-settings-main-bottom.png)          | [XML](screenshots/galaxy-settings/11-settings-main-bottom.xml)          |
|   12 | 일반                                | .SubSettings | [PNG](screenshots/galaxy-settings/12-general.png)                       | [XML](screenshots/galaxy-settings/12-general.xml)                       |
|   13 | 설정 홈 하단 현재 위치              | .Settings    | [PNG](screenshots/galaxy-settings/13-settings-main-current.png)         | [XML](screenshots/galaxy-settings/13-settings-main-current.xml)         |
|   14 | 설정 홈 중하단                      | .Settings    | [PNG](screenshots/galaxy-settings/14-settings-main-security-region.png) | [XML](screenshots/galaxy-settings/14-settings-main-security-region.xml) |
|   15 | 보안 항목이 보이는 설정 홈          | .Settings    | [PNG](screenshots/galaxy-settings/15-settings-main-security.png)        | [XML](screenshots/galaxy-settings/15-settings-main-security.xml)        |
|   16 | 보안 및 개인정보 보호               | .SubSettings | [PNG](screenshots/galaxy-settings/16-security-privacy.png)              | [XML](screenshots/galaxy-settings/16-security-privacy.xml)              |
|   17 | 설정 홈: 최상단 복원 상태           | .Settings    | [PNG](screenshots/galaxy-settings/17-final-settings-home.png)           | [XML](screenshots/galaxy-settings/17-final-settings-home.xml)           |

## 4. 공통 레이아웃 모델

### 4.1 화면 좌표와 시스템 영역

캡처 해상도는 1080 × 2400이지만, UIAutomator root는 [0,0][1080,2178]로 보고됐다. 즉, 실제 이미지 전체와 앱이 상호작용 대상으로 노출하는 논리 창 영역이 다르다.

    y=0
    ┌──────────────────────────────────────────────┐
    │ 시스템 상태 표시줄 0..78                      │
    ├──────────────────────────────────────────────┤
    │ 앱 콘텐츠 78..2178                            │
    │   상단 앱 바 78..318                          │
    │   스크롤 콘텐츠 318..2178                     │
    ├──────────────────────────────────────────────┤
    │ 시스템 내비게이션 영역 2178..2400             │
    └──────────────────────────────────────────────┘
    y=2400

상단 앱 바는 보통 다음 요소를 포함한다.

- 왼쪽 back 버튼: content-desc="상위 메뉴로 이동"
- 큰 페이지 제목: 일반 TextView
- 선택 화면에 따라 오른쪽 검색, QR, 더보기 버튼

설정 홈에는 collapsing app bar가 적용된다. 최상단에서는 제목이 중앙에 크게 펼쳐지고, 콘텐츠를 아래로 스크롤하면 제목이 축소되어 상단 앱 바에 남는다. 홈 화면의 콘텐츠만 아래로 스크롤되며, 검색 버튼은 상단 action 영역에 유지된다.

### 4.2 카드와 row

삼성 설정은 단일 거대 리스트보다 여러 개의 둥근 모서리 그룹을 세로로 배치한다.

일반적인 row 구조는 다음과 같다.

    row: android.widget.LinearLayout, clickable=true
    ├─ icon_frame / android:id=icon
    └─ RelativeLayout
       ├─ android:id=title       : 제목
       └─ android:id=summary     : 현재값 또는 짧은 설명

관찰된 공통값:

- row 전체 LinearLayout이 클릭 대상이다.
- 텍스트 자체는 보통 clickable=false다.
- 제목은 android:id/title이다.
- 부제·현재값은 android:id/summary다.
- 선택 가능한 row는 같은 카드 안에서 가는 구분선으로 나뉜다.
- 서로 다른 의미 그룹은 카드 사이의 검은 여백으로 분리된다.
- 카드의 높이는 row 수와 row 타입에 따라 정해지며, 상태값이 summary 한 줄 안에서 바뀌는 경우 주변 레이아웃이 크게 밀리지 않는다.

### 4.3 상태 표현 슬롯

화면에서 상태는 대부분 다음 중 하나에 들어간다.

| 상태 표현   | 사용 위치                             | 관찰 예                              |
| ----------- | ------------------------------------- | ------------------------------------ |
| 현재값/요약 | summary TextView                      | 연결됨, DHCP, 자연스러운 화면        |
| 활성/비활성 | Switch                                | Wi-Fi, Bluetooth, 자동으로 다시 연결 |
| 선택됨      | 파란 텍스트·라디오 표시               | 다크 모드, 현재 Wi-Fi                |
| 주의/추천   | 카드 내부 영웅 영역 또는 우측 아이콘  | 보안 추천, 앱 보안 !                 |
| 보조 동작   | 상단 액션 또는 하단 navigation button | QR 코드, 지우기, 검색                |
| 긴 설명     | 카드 안의 여러 줄 summary             | Quick Share 설명, 디바이스 보호 안내 |

중앙에 조건부로 별도 경고 문단을 삽입하기보다, 해당 row의 summary, trailing switch/status, 또는 별도 행동 카드 안에서 상태를 표현한다. 이 때문에 상태가 바뀌어도 페이지 중간에 독립 문단이 나타나 주변 요소를 밀어내지 않는 구조다.

## 5. 화면별 분석

## 5.1 설정 홈: 최초 화면

근거: [01 PNG](screenshots/galaxy-settings/01-current-settings.png), [01 XML](screenshots/galaxy-settings/01-current-settings.xml), [17 PNG](screenshots/galaxy-settings/17-final-settings-home.png), [17 XML](screenshots/galaxy-settings/17-final-settings-home.xml)

### 화면 목적

기기 전체 설정의 진입점이다. 상단에 계정과 추천/보호 기능이 있고, 아래에 기능 영역을 큰 그룹으로 나눈다.

### 시각 구조

위에서 아래로 다음 순서가 보인다.

1. 상단 앱 바
   - 큰 제목 설정
   - 오른쪽 설정 검색
2. 삼성 계정 카드
   - 사용자 이름
   - 마스킹된 계정 이메일
   - 우측 프로필 아이콘
3. 백업으로 데이터 보호 추천 카드
4. 연결 그룹
   - Wi-Fi, Bluetooth, 비행기 탑승 모드 요약
5. 기기 간 연결 그룹
   - Quick Share, Samsung DeX, Android Auto 요약
6. 모드 및 루틴 단일 row 그룹
7. 소리 및 진동 단일 row 그룹
8. 알림 단일 row 그룹
9. 디스플레이 단일 row 그룹

각 row는 아이콘, 제목, summary의 3열 구조에 가깝다. 아이콘은 좌측 고정 영역, 텍스트는 그 오른쪽, summary는 제목 아래다. 카드 내부에는 수평 구분선이 있고, 카드 바깥의 간격이 더 큰 그룹 경계를 만든다.

01 캡처는 ADB가 연결되었을 때 이미 열려 있던 현재 스크롤 상태라서 app bar가 축소된 상태다. 17 캡처는 분석이 끝난 뒤 설정 홈 최상단으로 복원한 상태다. 17에서는 app bar가 [0,78][1080,927]까지 확장되고, 큰 제목 설정이 중앙에 배치된다. 01에서는 app bar가 [0,78][1080,318]로 축소되어 제목이 왼쪽 상단에 배치된다. 둘은 서로 다른 페이지가 아니라 같은 collapsing app bar의 두 상태다.

### UI 계층 관찰

- root에는 com.android.settings:id/recycler_view인 RecyclerView가 있다.
- RecyclerView의 직접 자식은 클릭 가능한 android.widget.LinearLayout row다.
- 축소 상태의 홈 제목은 bounds [72,179][184,264]의 TextView다.
- 최상단 확장 상태의 큰 제목은 com.android.settings:id/collapsing_appbar_extended_title이며 bounds [0,406][1080,542]였다.
- 검색은 텍스트가 아닌 content-desc="설정 검색" 버튼으로 노출된다.
- 연결 row의 전체 클릭 bounds는 [0,833][1080,1038]이었다.
- row의 제목과 summary는 각각 android:id/title, android:id/summary로 확인됐다.

### 상태 및 상호작용

- 현재 Wi-Fi 이름은 연결 row의 summary에 요약된다.
- 하위 화면으로 들어가려면 row 어느 곳을 눌러도 된다.
- 검색은 별도 상단 버튼이다.
- 화면을 아래로 스크롤하면 큰 제목이 축소되고, 축소된 제목과 검색은 상단에 유지되며 카드 목록만 움직인다.

## 5.2 설정 홈: 중간 구간

근거: [10 PNG](screenshots/galaxy-settings/10-settings-main-lower.png), [14 PNG](screenshots/galaxy-settings/14-settings-main-security-region.png), [15 PNG](screenshots/galaxy-settings/15-settings-main-security.png)

### 보이는 항목

중간 구간에는 다음 그룹이 연속해서 나온다.

- 홈 화면: 레이아웃, 앱 아이콘 배지
- 잠금화면: 화면 잠금 방식, Always On Display
- 보안 및 개인정보 보호: 생체 인식, 권한 관리자
- 위치: 위치 요청
- 안전 및 긴급: 의료정보, 재난문자
- 계정 및 백업: 계정 관리, Smart Switch
- Google: Google 서비스
- 유용한 기능: 실험실, 측면 버튼
- 디지털 웰빙 및 자녀 보호 기능: 사용 시간, 앱 타이머
- 배터리 및 디바이스 케어: 저장공간, 메모리, 디바이스 보호
- 애플리케이션: 기본 앱, 애플리케이션 설정

### 구조적 특징

- 단일 row 그룹과 여러 row 카드가 섞여 있다.
- 카드 내부의 row는 같은 배경색을 사용하고 구분선만으로 나뉜다.
- 카드의 위·아래 모서리는 그룹의 시작과 끝에서만 둥글다.
- 긴 페이지에서도 현재 스크롤 위치는 오른쪽 얇은 scrollbar로만 표시된다.
- 상태 또는 요약값이 없는 항목은 제목만 보이고, 값이 있는 항목은 제목 아래에 회색 summary가 붙는다.

## 5.3 설정 홈: 하단 구간

근거: [11 PNG](screenshots/galaxy-settings/11-settings-main-bottom.png), [13 PNG](screenshots/galaxy-settings/13-settings-main-current.png)

### 보이는 항목

- 배터리 및 디바이스 케어
- 애플리케이션
- 일반
- 접근성
- 소프트웨어 업데이트
- 사용 설명서
- 원격 지원 서비스
- 휴대전화 정보
- 개발자 옵션

### 하단 특성

- 시스템 관리 성격의 메뉴가 하단으로 모인다.
- 일반, 접근성처럼 summary가 있는 row와 개발자 옵션처럼 summary가 거의 보이지 않는 row가 공존한다.
- 휴대전화 정보는 상태, 법률 정보, 휴대전화 이름을 summary로 안내한다.
- 화면 끝까지 내려가도 축소된 설정 제목과 검색 버튼은 유지된다.

## 5.4 연결

근거: [02 PNG](screenshots/galaxy-settings/02-connections.png), [02 XML](screenshots/galaxy-settings/02-connections.xml)

### 화면 구조

상단 앱 바:

- back: 상위 메뉴로 이동
- 제목: 연결
- 검색 버튼

본문은 다음 그룹으로 나뉜다.

| 그룹            | 항목                                                  | 상태 표현                        |
| --------------- | ----------------------------------------------------- | -------------------------------- |
| 무선 연결       | Wi-Fi                                                 | 현재 네트워크 이름 + 켜짐 switch |
| 무선 연결       | Bluetooth                                             | switch                           |
| 무선 연결       | NFC 및 비접촉 결제                                    | switch                           |
| 별도 기능       | 비행기 탑승 모드                                      | switch                           |
| 모바일 네트워크 | 모바일 네트워크, 데이터 사용, 모바일 핫스팟 및 테더링 | row 제목 중심                    |
| 기타            | 해외 로밍, 기타 연결 설정                             | row 제목 중심                    |
| 안내            | 다른 기능을 찾고 있나요?                              | 파란색 행동 카드                 |

### 시각 구조

첫 번째 큰 카드에는 Wi-Fi, Bluetooth, NFC가 들어간다. 각 row 오른쪽에 세로 구분선과 switch가 배치된다. 비행기 탑승 모드는 별도 카드다. 모바일 네트워크와 기타 연결 설정은 각각 별도 카드로 묶인다.

### UI 계층과 상호작용

- 각 row는 android.widget.LinearLayout, clickable=true다.
- switch는 row와 분리된 android.widget.Switch로 노출된다.
- Wi-Fi row는 제목 Wi-Fi와 현재 네트워크명을 summary로 가진다.
- switch를 누르면 실제 시스템 설정이 변경되므로, 조회/분석 시에는 row 제목 영역을 눌러 상세 화면으로 이동해야 한다.
- 다른 기능을 찾고 있나요?는 목록의 일반 row가 아니라 하단의 파란 행동 영역이다.

## 5.5 Wi-Fi 목록

근거: [03 PNG](screenshots/galaxy-settings/03-wifi.png), [03 XML](screenshots/galaxy-settings/03-wifi.xml)

### 상단 영역

- 제목: Wi-Fi
- 왼쪽 back
- 오른쪽 QR 코드 스캔
- 오른쪽 옵션 더보기

UIAutomator에서 오른쪽 버튼은 다음 접근성 설명으로 노출된다.

- content-desc="QR 코드 스캔"
- content-desc="옵션 더보기"

### 본문

1. Wi-Fi 전체 상태 카드
   - 큰 파란 상태 텍스트 사용 중
   - 우측 switch
   - 검색/스캔 중에는 색깔 점 형태의 로딩 표시가 함께 나타남
2. 현재 네트워크 섹션
   - 현재 SSID
   - 연결됨
   - Wi-Fi 아이콘
   - 별도 설정 아이콘
3. 사용 가능한 네트워크 섹션
   - 네트워크 추가 row
   - 주변 네트워크가 있으면 동일한 row가 추가됨

### 상태 관찰

사용 중, 연결됨은 별도 경고 박스가 아니라 각각 상단 상태 카드와 현재 네트워크 row에 들어간다. 스캔 중 상태는 카드 안의 작은 시각 indicator와 목록 변화로 표현된다. 따라서 상태가 바뀌어도 페이지 중간에 독립 문단을 삽입하는 구조가 아니다.

### 안전한 분석 포인트

- Wi-Fi 전체 switch는 누르지 않는다.
- 현재 네트워크의 설정 아이콘 또는 row를 눌러 상세로 이동한다.
- 주변 네트워크 row를 누르면 연결 흐름으로 들어갈 수 있으므로, 이름 목록 확인만 하고 누르지 않는다.

## 5.6 연결된 Wi-Fi 상세: 상단

근거: [05 PNG](screenshots/galaxy-settings/05-wifi-network-settings.png), [05 XML](screenshots/galaxy-settings/05-wifi-network-settings.xml)

### 화면 구조

이 화면은 일반 설정 row 목록보다 큰 entity header를 먼저 보여준다.

    상단 back
            연결된 네트워크 이름
                  Wi-Fi icon
                  연결됨

    ┌──────────────────────────────────────────────┐
    │ 네트워크 속도                         값       │
    │ 보안                                  방식     │
    └──────────────────────────────────────────────┘

    ┌──────────────────────────────────────────────┐
    │ 자동으로 다시 연결                         ON │
    └──────────────────────────────────────────────┘

    ┌──────────────────────────────────────────────┐
    │ Quick Share                                  │
    │ 긴 설명                                      │
    │ ──────────────────────────────────────────── │
    │ 공유기 관리                                  │
    └──────────────────────────────────────────────┘

    더보기

    하단 고정 동작: QR 코드 / 지우기

### UI 계층

- entity 제목: com.android.settings:id/entity_header_title
- entity 상태: com.android.settings:id/entity_header_summary
- 네트워크 속도 제목/값: com.android.settings:id/title, com.android.settings:id/summary
- 자동 재연결 switch: com.android.settings:id/switch_widget
- 하단 QR 버튼: com.android.settings:id/qrcode_button, content-desc="QR 코드"
- 하단 삭제 버튼: com.android.settings:id/forget_button, content-desc="지우기"
- 더보기는 com.android.settings:id/title 텍스트와 확장 화살표로 표현된다.

### UX 특징

- 네트워크 이름과 연결 상태는 페이지의 시각적 중심에 있다.
- 핵심 속성은 별도 카드 안에서 label/value 2열로 배치된다.
- 자동 재연결은 한 줄 row의 trailing switch다.
- Quick Share 설명처럼 긴 텍스트가 필요한 경우에만 해당 기능 카드 내부 summary를 여러 줄로 사용한다.
- QR 코드와 지우기는 화면 하단에 고정된 2분할 action bar로 보인다.

## 5.7 연결된 Wi-Fi 상세: 더보기 확장

근거: [06 PNG](screenshots/galaxy-settings/06-wifi-network-more.png), [06 XML](screenshots/galaxy-settings/06-wifi-network-more.xml)

더보기를 누르면 기존 화면을 다른 페이지로 바꾸지 않고, 같은 스크롤 컨테이너 안에 하위 설정 카드가 추가된다. 캡처에서는 IP 설정 카드가 하단에 나타나기 시작했다.

이 방식의 의미:

- 기본 사용자는 연결 상태, 속도, 보안, 자동 재연결만 먼저 본다.
- 고급 네트워크 정보는 사용자가 요청할 때만 콘텐츠 높이를 차지한다.
- 확장 이후에는 스크롤이 필요하지만, 다른 Activity나 모달을 추가하지 않는다.
- 더보기 자체가 펼침 상태를 전환하는 disclosure control이다.

## 5.8 연결된 Wi-Fi 상세: 하단 스크롤

근거: [07 PNG](screenshots/galaxy-settings/07-wifi-network-details-scrolled.png), [07 XML](screenshots/galaxy-settings/07-wifi-network-details-scrolled.xml)

확장된 상세 정보에서 확인된 항목은 다음과 같다.

| 항목             | 현재 표시 형식 | 의미                      |
| ---------------- | -------------- | ------------------------- |
| IP 설정          | DHCP           | IP 할당 방식              |
| 프록시           | 설정 안 함     | 프록시 사용 여부          |
| 데이터 제한 설정 | 자동 감지      | 네트워크 데이터 제한 처리 |
| MAC 주소 유형    | 랜덤 MAC       | 연결에 사용하는 MAC 정책  |
| MAC 주소         | 회색 값        | 현재 연결의 MAC           |
| IP 주소          | IPv4와 IPv6    | 현재 네트워크 주소        |

이 화면은 label 아래에 현재값을 두는 세로형 row와, 여러 row를 구분하는 선을 함께 사용한다. 값은 파란색 또는 회색으로 의미를 구분한다.

> 문서에 기록된 실제 값은 기기·네트워크 식별 정보이므로 의도적으로 반복하지 않는다. 원본 [07 PNG](screenshots/galaxy-settings/07-wifi-network-details-scrolled.png)와 [07 XML](screenshots/galaxy-settings/07-wifi-network-details-scrolled.xml)에는 캡처 당시의 실제 값이 남아 있다.

## 5.9 디스플레이

근거: [09 PNG](screenshots/galaxy-settings/09-display.png), [09 XML](screenshots/galaxy-settings/09-display.xml)

### 상단: 테마 선택 카드

첫 카드에는 라이트와 다크 두 선택지가 나란히 있다.

- 각 선택지에 큰 미리보기 이미지가 있다.
- 선택된 다크는 파란색 텍스트와 선택 라디오로 표시된다.
- 선택되지 않은 라이트는 회색 텍스트와 빈 라디오로 표시된다.
- 카드 하단에는 다크 모드 설정 row가 있다.

### 중단: 밝기 카드

- 제목 밝기
- 수평 slider
- slider 왼쪽 밝기 아이콘
- slider 하단의 밝기 최적화 switch

slider는 화면의 한 줄 action이 아니라, 카드 내부의 독립 조절 컨트롤이다. 조회 시 thumb을 누르지 않도록 주의해야 한다.

### 하단: 화면 편의 카드

- 부드러운 모션 및 화면 전환
  - 현재값 높음
- 편안하게 화면 보기
  - trailing switch
- 화면 모드
  - 현재값 자연스러운 화면

### 레이아웃 관찰

- 선택 상태는 카드 안의 라디오/색상으로 표시된다.
- 조절 가능한 값은 slider나 switch라는 전용 컨트롤로 표시된다.
- 단순 선택 항목은 title + summary row다.
- 서로 다른 입력 타입을 모두 별도 페이지나 경고문으로 만들지 않고, 한 페이지 안에서 컨트롤 타입으로 구분한다.

## 5.10 일반

근거: [12 PNG](screenshots/galaxy-settings/12-general.png), [12 XML](screenshots/galaxy-settings/12-general.xml)

> 캡처 파일의 최초 임시 이름은 12-security-privacy였으나 실제 화면이 일반으로 확인되어 12-general로 정정했다.

### 화면 구조

상단 제목은 일반이다. 본문은 다음과 같다.

1. 언어
   - 현재값 한국어(대한민국)
2. 앱 언어
   - 앱별로 사용할 언어를 다르게 설정할 수 있습니다.
3. 글자 읽어주기
4. 음성 입력
5. 날짜 및 시간
6. 삼성 키보드 설정
   - English (US) 및 한국어
   - 기본 키보드 및 추가 키보드 설정
7. 하드웨어 키보드
   - 연결 안 됨
8. 마우스 및 트랙패드

### 상태 표현

- 언어·키보드처럼 현재 선택값이 있는 row는 파란색 summary를 사용한다.
- 연결되지 않은 하드웨어 키보드는 회색 summary 연결 안 됨으로 표시한다.
- 설명이 필요한 앱 언어는 row 아래에 회색 한 줄 설명을 둔다.
- 상태를 화면 중앙의 독립 alert로 띄우지 않고 각 기능 row의 값/설명 슬롯 안에서 처리한다.

## 5.11 보안 및 개인정보 보호

근거: [16 PNG](screenshots/galaxy-settings/16-security-privacy.png), [16 XML](screenshots/galaxy-settings/16-security-privacy.xml)

### 상단 추천 영역

페이지 상단에는 일반 row보다 큰 상태/추천 영역이 있다.

- 페이지 제목 보안 및 개인정보 보호
- 큰 주황색 방패 아이콘
- 추천 2개
- 디바이스 보호 켜기 추천 카드
- 휴대전화를 악성 소프트웨어나 의심스러운 앱으로부터 보호하라는 긴 설명
- 사용 안 함, 디바이스 보호로 이동 행동
- 여러 추천 항목을 나타내는 pagination dot

### 점검 상태 목록

추천 카드 아래에는 보안 점검 항목이 한 카드 안의 row로 표시된다.

| 항목             | 우측 상태     |
| ---------------- | ------------- |
| 잠금화면         | 초록색 check  |
| 계정             | 초록색 check  |
| 내 디바이스 찾기 | 초록색 check  |
| 앱 보안          | 주황색 느낌표 |
| 업데이트         | 주황색 느낌표 |

### UX 특징

- 전체 상태는 상단 hero 영역에 요약한다.
- 세부 점검 결과는 row별 trailing icon으로 나눈다.
- 해결 방법은 디바이스 보호로 이동 같은 명시적 action으로 제공한다.
- 상태의 심각도는 문장만으로 전달하지 않고 아이콘과 색상으로 함께 표현한다.
- 이 화면은 페이지 전체 상태를 안내해야 하는 예외적인 경우로, 상단 추천 영역을 별도 카드로 허용한다.

## 6. 네비게이션과 Activity 관찰

### 6.1 확인된 Activity

| 화면 유형 | Activity                          |
| --------- | --------------------------------- |
| 설정 홈   | com.android.settings/.Settings    |
| 하위 설정 | com.android.settings/.SubSettings |

설정 홈에서 연결, Wi-Fi, 디스플레이, 일반, 보안 및 개인정보 보호로 이동할 때 패키지는 유지되고 Activity가 .SubSettings로 바뀐다. back을 누르면 이전 하위 화면 또는 설정 홈으로 돌아온다.

### 6.2 관찰된 이동 경로

    설정 홈 (.Settings)
      └─ 연결 (.SubSettings)
           └─ Wi-Fi (.SubSettings)
                └─ 연결된 네트워크 상세 (.SubSettings)
                     └─ 더보기: 같은 화면 내부 확장
      └─ 디스플레이 (.SubSettings)
      └─ 일반 (.SubSettings)
      └─ 보안 및 개인정보 보호 (.SubSettings)

### 6.3 안전한 순회 원칙

화면 해체 분석 목적이라면 다음 동작은 안전한 조회 범위다.

- 설정 홈 row를 눌러 하위 화면 진입
- back 버튼 또는 시스템 back으로 복귀
- RecyclerView/스크롤 컨테이너 스크롤
- screenshot과 UIAutomator dump
- dumpsys activity 조회

반대로 다음은 단순 UI 분석 범위를 넘어선다.

- switch, slider, radio를 누르는 것
- Wi-Fi row를 눌러 연결 시도
- QR 코드, 지우기, 디바이스 보호로 이동 같은 실제 action
- 권한 허용·거부
- 계정·보안·잠금 설정 변경

## 7. 접근성/UI 계층 요약

### 7.1 공통 노드

| 역할            | 관찰된 클래스/ID                                |
| --------------- | ----------------------------------------------- |
| 전체 루트       | android.widget.FrameLayout                      |
| 콘텐츠 루트     | android:id/content                              |
| 상단 앱 바      | com.android.settings:id/app_bar                 |
| 리스트 컨테이너 | com.android.settings:id/recycler_view           |
| 일반 row        | android.widget.LinearLayout + clickable=true    |
| 제목            | android:id/title                                |
| summary         | android:id/summary                              |
| switch          | android.widget.Switch, android:id/switch_widget |
| 검색            | Button, content-desc="설정 검색"                |
| 뒤로가기        | ImageButton, content-desc="상위 메뉴로 이동"    |

### 7.2 접근성 설명의 불균일성

상단 검색·QR·더보기·하단 QR·지우기처럼 명시적 버튼은 content description이 노출된다. 반면 대부분의 row 제목은 TextView이고 클릭 가능성은 부모 LinearLayout에 있다.

따라서 자동화나 자체 앱 구현 시 다음을 구분해야 한다.

- 텍스트를 읽어야 하는 노드
- 실제 클릭 target인 부모 노드
- 시각 아이콘이지만 별도 content description이 없는 노드
- switch/slider처럼 독립 조작 가능한 노드

텍스트 노드만 찾아 탭하는 방식은 실패할 수 있다. row 전체 bounds 또는 접근성 action을 기준으로 찾아야 한다.

### 7.3 Bounds 해석 예

설정 홈의 축소 상태(01 캡처)에서 확인된 값은 다음과 같다.

    앱 바                  [0,78][1080,318]
    RecyclerView           [0,318][1080,2178]
    설정 제목              [72,179][184,264]
    검색 버튼              [924,126][1080,318]
    연결 row               [0,833][1080,1038]
    기기 간 연결 row       [0,1038][1080,1243]
    모드 및 루틴 row       [0,1303][1080,1508]
    디스플레이 row         [0,1978][1080,2178]

최상단 확장 상태(17 캡처)에서는 다음 값이 관찰됐다.

    확장 app bar            [0,78][1080,927]
    확장 큰 제목            [0,406][1080,542]
    축소 action bar 영역    [0,687][1080,927]
    RecyclerView            [0,927][1080,2178]

이 값은 SM-G981N, 1080 × 2400 override, 글자 배율 1.0인 한 시점의 값이다. 디자인 토큰이나 모든 기기의 고정값으로 사용하면 안 된다.

## 8. 상태/레이아웃 설계에서 얻은 적용 원칙

이번 캡처에서 반복적으로 확인된 시스템 설정의 원칙은 다음과 같다.

### 8.1 짧은 상태는 row의 summary에 둔다

예:

- 연결됨
- DHCP
- 설정 안 함
- 높음
- 자연스러운 화면
- 연결 안 됨

상태 때문에 별도 문단을 중간에 삽입하지 않고 label 아래의 고정 summary 슬롯을 사용한다.

### 8.2 조작 가능한 상태는 전용 control로 둔다

예:

- Wi-Fi/Bluetooth/NFC: Switch
- 자동 재연결: Switch
- 밝기: Slider
- 라이트/다크: Radio selection

문장을 버튼처럼 사용하지 않고, 실제 조작 대상과 상태 표시를 분리한다.

### 8.3 긴 설명은 해당 기능 카드 안에 둔다

Quick Share와 디바이스 보호처럼 설명이 긴 기능은 해당 기능의 카드 안에서만 여러 줄 summary를 허용한다. 관련 없는 카드 사이의 중앙에 독립 안내문을 끼우지 않는다.

### 8.4 페이지 전체를 막는 상태만 상단 hero/banner로 올린다

보안 및 개인정보 보호의 추천 2개처럼 페이지 전체를 점검해야 하는 정보는 상단 hero 카드로 요약한다. 일반적인 연결 상태나 입력 오류는 row/field 슬롯에 둔다.

### 8.5 고급 정보는 disclosure로 늦춘다

Wi-Fi 상세의 더보기처럼 자주 쓰지 않는 IP/MAC/프록시 정보는 기본 화면의 높이를 차지하지 않게 접어 둔다. 사용자가 요청하면 같은 화면에서 확장하고, 고정 하단 action은 유지한다.

### 8.6 카드 경계는 의미 그룹을 나타낸다

카드 사이의 큰 여백은 기능 그룹 경계다. 같은 기능 그룹 내부에서는 선을 사용하고, 다른 기능 그룹을 또 다른 카드로 분리한다. 모든 row를 각각 카드로 만들지는 않는다.

## 9. 프로젝트 앱 분석과의 구분

현재 캡처에서 포그라운드가 com.android.settings였으므로, 이 결과만으로 다음을 판단할 수 없다.

- 프로젝트 pc-control의 Settings 화면이 실기기에서 어떻게 렌더링되는가
- 프로젝트 Diagnostics 화면의 실제 상태 문구와 Toast
- 프로젝트 Onboarding의 입력 필드/Host Key/SSH 상태
- 프로젝트 앱의 카드 높이와 여백

프로젝트 앱 화면을 분석하려면 먼저 기기에서 해당 앱을 전면에 띄운 뒤 다음을 다시 수행해야 한다. 이때도 먼저 포그라운드 package/activity를 확인해야 한다.

    adb shell dumpsys activity activities | rg -m 3 'topResumedActivity|mResumedActivity|mCurrentFocus'
    adb exec-out screencap -p > docs/screenshots/pc-control/<screen>.png
    adb shell uiautomator dump /sdcard/window.xml
    adb pull /sdcard/window.xml docs/screenshots/pc-control/<screen>.xml

## 10. 한계와 해석 범위

- UIAutomator dump는 화면에 노출된 노드와 접근성 속성만 보여준다.
- 삼성 설정 앱 내부의 Kotlin/Java 소스, Compose/뷰 구현 방식, 디자인 토큰은 확인할 수 없다.
- 색상과 글꼴 크기는 캡처에서 관찰한 값이며, 픽셀 단위 디자인 토큰의 공식 값이 아니다.
- 화면 상태는 캡처 당시의 네트워크, 계정, 보안, 배터리 조건에 따라 달라질 수 있다.
- content-desc가 없는 아이콘도 있어 시각 분석과 계층 분석을 함께 봐야 한다.
- bounds는 디바이스 해상도, 글자 크기, 접근성 확대, 화면 회전, One UI 버전에 따라 달라진다.
- 원본 캡처는 장치 식별 정보가 포함될 수 있으므로 공개 문서나 배포물로 취급하면 안 된다.

## 11. 분석 완료 기준

다음 항목을 확인했으므로 현재 요청 범위의 실기기 시스템 설정 분석을 완료했다.

- [x] 설정 홈의 최상단 확장·축소·중간·하단 구조 캡처
- [x] 연결 화면 캡처
- [x] Wi-Fi 목록과 연결 상태 캡처
- [x] 연결된 Wi-Fi 상세 기본/확장/스크롤 상태 캡처
- [x] 디스플레이 화면 캡처
- [x] 일반 화면 캡처
- [x] 보안 및 개인정보 보호 화면 캡처
- [x] 화면별 PNG와 UIAutomator XML 보존
- [x] Activity와 핵심 bounds/resource-id 기록
- [x] 변경 동작을 실행하지 않은 분석 범위 기록
- [x] 프로젝트 앱과 시스템 설정의 대상 차이 명시
