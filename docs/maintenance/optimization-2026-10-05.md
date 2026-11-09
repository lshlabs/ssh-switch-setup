# 디렉터리 정리 및 최적화 — 2026-10-05

## 검사 범위와 판단 기준

워크스페이스 전체의 파일 목록, Git 추적/무시 규칙, 패키지/빌드 설정, TypeScript import 그래프, React 실행 경로, Kotlin/Rust 함수 참조, Android 테스트와 PowerShell 리소스 경로를 검토했다. 의존성 설치 디렉터리와 생성된 빌드 파일은 소스로 수정하지 않았다. 현재 앱에서 참조하지 않는 이전 구현만 제거했고, Capacitor 플러그인 메서드·AIDL·Tauri 명령·공유 프로토콜은 런타임/API 계약이므로 유지했다.

`pnpm check:unused`로 미사용 파일·export·의존성을 재검사할 수 있다. Gradle에서 사용하는 `@capacitor/android`는 TypeScript 분석만으로 사용 여부를 판단할 수 없어 명시적으로 예외 처리했다. 패키지 진입점 export를 포함한 확장 검사에는 빌드된 `dist`를 경유하는 참조가 미사용으로 표시되므로 실제 소비 코드를 함께 확인했다.

## 제거 및 코드 개선

- 사용하지 않는 이전 OnboardingScreen, SshIdentityPanel, onboardingSession 및 이전 구현 전용 테스트를 제거했다.
- 사용되지 않는 HomeRecentAction 컴포넌트·타입·세션 반환 값·번역을 제거했다.
- 화면 내용이 없는 settings-sample 경로와 prop을 제거했다.
- 이전 온보딩 번역과 전용 CSS, SSH 키 패널 스타일 등 미사용 CSS 규칙 260개를 제거했다. 현재 설정 다이얼로그가 공유하는 스타일은 보존했다.
- 내부에서만 쓰는 PreferenceIcon/useRipple/Ripple과 ErrorParams의 불필요한 export를 제거했다. React Fast Refresh 경고가 해소됐다.
- 단일 차트에서 사용하던 범용 ChartContainer와 읽히지 않는 Context를 없애고 ResponsiveContainer를 직접 사용한다.
- LatencySparkline을 별도 파일로 추출하고 지연 로딩한다.
- useAutoRefresh에서 타이머 ref를 제거하고 effect의 수명으로 관리한다. 비동기 리스너 등록이 정리 이후 완료되어도 해제하며, 해제된 콜백과 숨겨진 문서의 갱신을 차단한다. 웹에서는 네이티브 리스너를 등록하지 않는다. 등록/해제 실패를 처리한다.
- 새로고침의 늦은 등록·숨김 상태·중단 상태·등록 실패를 검증하는 회귀 테스트 6개를 추가했다.
- 생성 템플릿의 `2 + 2` 테스트를 제거하고, 앱 패키지를 확인하는 계측 테스트는 AppContextInstrumentedTest로 이름을 변경했다.

## 이름과 배치

- 전체 화면은 `apps/mobile/src/screens`에 모았다. 현재 V1OnboardingScreen은 `screens/OnboardingScreen.tsx`로 이름을 변경했고, 스타일의 버전 접두사는 역할을 나타내는 setup 접두사로 정리했다.
- 설정 아이콘 데이터는 `components/ui/settings-icons.ts`로 이동했다. 모든 상대 import를 수정했다.
- CSS를 `styles/base.css`, `home.css`, `pages.css`, `preferences.css`, `onboarding.css`로 나눴다. 기존 적용 순서를 진입점 `styles.css`의 import 순서로 보존했다.
- 기존 `test`의 약 2.9GB 펌웨어/디자인 분석 자료는 실행 테스트가 아니므로 `docs/reference/oneui8`로 옮겼다. 자료 자체는 삭제하지 않았다.
- 과거 화면 캡처는 `docs/reference/screenshots`, 루트 백업/압축/목업 자료는 `docs/archive`로 옮겼다. 과거 지시서의 본문과 내부 파일명은 역사적 참조를 위해 유지했다. 이 자료들은 로컬 보관 자료이며 Git 추적 대상에서 제외된다.
- `.DS_Store`, 과거 `.playwright-cli` 실행 로그, 비어 있는 patch 디렉터리, 분석 자료의 Turbo 로그를 제거했다. 현재 검증의 브라우저 로그도 제거했고, 검토한 화면 캡처 3개는 docs/reference/screenshots에 보관했다.
- 워크스페이스 목록에서 실행 패키지가 아닌 `test` 항목을 제거했다.
- `.gitignore`의 광범위한 `test/` 규칙을 제거했다. 이 규칙 때문에 제외되던 네이티브 단위 테스트 4개 파일을 이제 Git이 인식한다.
- Rust/Tauri 생성물은 무시하고, 대용량 참조/아카이브와 생성된 브라우저 자료는 Prettier 대상에서 제외했다.

## 빌드 크기

Vite 프로덕션 빌드 출력, 압축 전 파일 기준이다. 실제 로딩 시간은 기기와 네트워크에서 별도로 측정해야 한다.

| 파일                             |          정리 전 |   정리 후 |
| -------------------------------- | ---------------: | --------: |
| 모바일 기본 JavaScript           |        796.56 KB | 414.96 KB |
| 모바일 CSS                       |        108.44 KB |  75.30 KB |
| 분리된 지연 시간 차트 JavaScript | 기본 파일에 포함 | 321.40 KB |

기본 JavaScript 파일은 약 48%, CSS는 약 31% 줄었다. 차트 청크도 포함한 전체 JavaScript가 48% 줄었다는 의미는 아니다.

## 검증

- ESLint: 오류 및 경고 없음.
- TypeScript: 모든 앱/공유 패키지 통과.
- Vitest: 44개 테스트 통과. 제거된 이전 구현 전용 테스트 2개와 추가한 회귀 테스트 6개가 반영된 수다.
- Knip: 설정된 검사 범위에서 미사용 코드/의존성 항목 없음.
- 웹 프로덕션 빌드: 모바일·Windows Setup 프런트엔드 통과.
- Android 네이티브 단위 테스트: 32개, 실패 0개.
- Capacitor 동기화 및 Android Debug APK 빌드 통과.
- 소스 포맷과 Git 공백 오류 검사 통과.
- Playwright로 390×844 브라우저에서 온보딩 수동 입력, 중단 확인, 홈, 설정 목록, PC 연결 상세, 입력 다이얼로그를 확인했다. 화면 캡처로 배치도 점검했다. 브라우저 콘솔에는 기존 favicon 404, 개발 중 HMR에 따른 플러그인 중복 등록 경고, 페이지 전환 중 aria-hidden/focus 경고가 있었다.

Windows용 Rust/Tauri 실행 파일은 이 Mac 환경에 Cargo가 없고 Windows 도구 체인이 필요해 빌드하지 않았다. 실제 PC의 SSH·VPN·전원 명령과 Android 계측 테스트는 실행하지 않았다. Gradle의 기존 flatDir/폐기 예정 API 경고는 유지된다.
