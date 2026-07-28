# iRead Tobii Prototype

iRead Tobii Prototype은 Tobii Eye Tracker 5의 시선 데이터를 웹 기반 문장 읽기 활동에 연결하기 위한 로컬 검증용 프로토타입입니다.

브라우저는 Tobii 기기와 직접 통신하지 않습니다. 로컬 FastAPI 서버가 Tobii Game Integration SDK 기반 native bridge를 실행하고, 시선 좌표를 WebSocket으로 프론트엔드에 전달합니다.

이 저장소는 iRead 본 서비스에 병합하기 전, 문장 읽기 중 단어별 체류시간과 역행 횟수를 수집할 수 있는지 확인하기 위해 사용합니다.

## 검증 범위

| 항목 | 내용 |
| --- | --- |
| 시선 수신 | `/gaze` WebSocket으로 gaze frame 수신 |
| 문장 읽기 | 문장을 띄어쓰기 기준 단어 토큰으로 분리 |
| 지표 계산 | 단어별 체류시간, 방문 횟수, 역행 횟수 계산 |
| 보정 | 웹 화면 기준 5점 보정과 단어 기준 보정 지원 |
| 저장 | 로컬 API를 통해 세션과 단어별 metrics 저장 |
| 연동 | 추후 iRead Frontend의 독서 활동 화면에 gaze adapter로 병합 가능 |

## 현재 상태

| 구분 | 상태 |
| --- | --- |
| Native Tobii bridge | 구현됨 |
| Simulation mode | 구현됨 |
| 5점 웹 보정 | 구현됨 |
| 문장 읽기 metrics | 구현됨 |
| SQLite 저장 | 프로토타입 용도로 구현됨 |
| 학생 로그인 | 미구현 |
| 최종 Backend API 계약 | 미확정 |
| Tobii Experience 프로필 자동 전환 | 미확정 |
| 개인정보 동의와 보관 정책 | 미확정 |

## 기술 구성

| 영역 | 기술 |
| --- | --- |
| Local backend | FastAPI, Python |
| Frontend prototype | HTML, CSS, JavaScript |
| Eye tracking bridge | C++, Tobii Game Integration SDK |
| Local storage | SQLite |
| Runtime | Windows, Tobii Eye Tracker 5 |

## 필수 준비물

GitHub에서 이 저장소를 clone한 팀원은 다음 항목을 준비해야 합니다.

| 항목 | 설명 |
| --- | --- |
| Windows PC | Tobii Eye Tracker 5와 native bridge 실행 환경 |
| Python | FastAPI 로컬 서버 실행에 필요 |
| Visual Studio Build Tools | C++ workload가 포함되어야 함 |
| Tobii Eye Tracker 5 | 실제 시선 데이터 수집 장치 |
| Tobii Experience | 사용자별 기본 눈 보정에 필요 |
| Tobii Game Integration SDK | native bridge 빌드에 필요 |

Tobii Game Integration SDK는 저장소에 포함하지 않습니다. 팀원은 각자 보유한 SDK 압축파일을 원하는 위치에 압축 해제한 뒤, 아래 native bridge 빌드 단계에서 해당 경로를 전달합니다.

## Clone 후 실행 흐름

```text
1. 저장소 clone
2. SDK 압축 해제
3. Python 가상환경 생성 및 의존성 설치
4. config.example.json을 config.json으로 복사
5. native bridge 빌드
6. 서버 실행
7. reading.html 접속
```

## 실행 준비

가상환경을 만들고 Python 의존성을 설치합니다.

```powershell
setup_venv.bat
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

로컬 설정 파일을 생성합니다.

```powershell
Copy-Item config.example.json config.json
```

`config.json`은 로컬 SDK 경로와 실행 파일 경로를 담을 수 있으므로 Git에 커밋하지 않습니다.

## 실행 방법

서버를 실행합니다.

```powershell
run_server.bat
```

문장 읽기 프로토타입을 엽니다.

```text
http://127.0.0.1:8765/reading.html
```

기본 실행 모드는 simulation입니다. 실제 Tobii Eye Tracker 5를 사용하려면 native bridge를 먼저 빌드한 뒤 화면에서 native mode를 선택합니다.

## Native Bridge 빌드

Visual Studio Build Tools의 C++ workload가 필요합니다.

Tobii Game Integration SDK 경로를 인자로 전달해 빌드합니다.

```bat
cd native
build_native_with_vs2022.bat C:\path\to\tobii_gameintegration_9.0.4.26
```

또는 환경변수를 사용할 수 있습니다.

```bat
set TOBII_GAMEINTEGRATION_SDK_DIR=C:\path\to\tobii_gameintegration_9.0.4.26
build_native_with_vs2022.bat
```

빌드 산출물은 `native/build/`에 생성되며 Git에 커밋하지 않습니다.

## Gaze Frame 계약

프론트엔드는 WebSocket으로 전달되는 JSON gaze frame만 의존합니다.

```json
{
  "type": "gaze",
  "source": "tobii",
  "x": 0.5,
  "y": 0.5,
  "screenX": 960,
  "screenY": 540,
  "valid": true,
  "presence": true,
  "timestamp": 1720000000000
}
```

프로토타입 디버깅 중에는 `rawX`, `rawY`, `rawUnit`, `trackingLeft`, `trackingRight` 같은 추가 필드가 포함될 수 있습니다.

## Reading Metrics API

| 목적 | API |
| --- | --- |
| 읽기 세션 생성 | `POST /api/reading/sessions` |
| 단어별 metrics 저장 | `POST /api/reading/sessions/{sessionId}/metrics` |
| 세션 목록 조회 | `GET /api/reading/sessions` |
| 세션 상세 조회 | `GET /api/reading/sessions/{sessionId}` |

현재 저장소는 프로토타입 검증을 위해 `data/reading_sessions.sqlite3`에 데이터를 저장합니다. `data/` 디렉터리는 Git에 커밋하지 않습니다.

## Backend Gaze Sync

`config.json`에서 backend sync를 켜면 로컬 저장과 함께 Spring Boot gaze API로도 전송합니다.

```json
"backend": {
  "enabled": true,
  "baseUrl": "http://localhost:8080",
  "sessionCookie": "JSESSIONID=...",
  "timeoutSeconds": 5
}
```

The prototype maps local summary fields to the backend contract like this:

| Local summary | Backend request field |
| --- | --- |
| `totalDwellMs` | `totalVisitedDuration` |
| `totalVisitCount` | `totalVisitedCount` |
| `totalRegressionCount` | `reverseReadCount` |
| `totalDwellMs / visitedWords` | `avgVisitedDuration` |

Session start uses `studentId`, `contentType`, `contentId`, and `calibrationStatus`.
`contentId` is sent as `testId`, `trainingId`, or `storyId` according to `contentType`.

`gaze_payloads.py` centralizes the conversion from prototype metrics to the iRead backend contract:

| Prototype data | Contract payload |
| --- | --- |
| session context | `POST /api/app/gaze/sessions` request |
| reading summary | `POST /api/app/gaze/sessions/{gazeSessionId}/analysis-results` request |
| session status/filter summary | `PATCH /api/app/gaze/sessions/{gazeSessionId}/end` request |
| word gaze metrics | contract-shaped `wordAttempts` preview for frontend/backend alignment |

When a reading session is saved, `/api/reading/sessions/{sessionId}/metrics` returns `payloadPreview`.
The web mock also stores the latest preview in `localStorage` under `iread-gaze-payload-preview`.
This is intended for API alignment and does not upload raw high-FPS gaze coordinates.

## iRead 병합 방향

| 대상 | 병합 방식 |
| --- | --- |
| iRead Frontend | gaze WebSocket client, 보정 화면, 문장 읽기 metrics collector를 Vue 컴포넌트 또는 composable로 분리 |
| iRead Backend | 세션 생성과 metrics 저장 API를 정식 계약에 맞게 Spring Boot API로 이전 |
| Local bridge | Tobii SDK 접근이 필요한 Windows 로컬 helper로 유지 |

브라우저 단독으로 Tobii Eye Tracker 5에 직접 접근하는 구조가 아니므로, 실제 서비스에서도 로컬 bridge 실행 방식이 필요합니다.

## Git 관리 주의사항

커밋 전에 다음 파일과 디렉터리가 staging에 포함되지 않았는지 확인합니다.

| 제외 대상 | 이유 |
| --- | --- |
| `.venv/` | 로컬 Python 가상환경 |
| `data/` | 로컬 SQLite 데이터 |
| `config.json` | 개인 PC의 SDK와 앱 경로 포함 가능 |
| `native/build/` | 빌드 산출물 |
| `*.exe`, `*.dll`, `*.obj` | 실행 파일, SDK DLL, 컴파일 산출물 |
| `vs_BuildTools.exe` | 로컬 설치 파일 |

추천 저장소명은 `iRead-tobii-prototype`입니다.
