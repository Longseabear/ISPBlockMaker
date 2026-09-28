# ISP Block Maker

[설치·사용·공유 가이드 (GitHub Pages)](https://longseabear.github.io/ISPBlockMaker/) · [프로젝트 공유 방법](https://longseabear.github.io/ISPBlockMaker/#sharing)

로컬 CLI 에이전트와 함께 ISP 블록을 설계·구현·시각화하는 웹 작업 공간입니다. MCP 없이 HTTP API와 WebSocket으로 동작합니다.

프레임워크와 작업 프로젝트는 독립 Git 저장소입니다. 각 workspace의 `project/`만 그래프·코드 저장소로 사용하고, 입력 데이터·요청/JOB·시각화·작업 기록은 workspace에 따로 보관합니다. 예제 구현·프로젝트 그래프·로컬 결과는 이 프레임워크 저장소에 포함하지 않습니다.

```text
ISPBlockMaker/                  # 프레임워크 Git
├─ server/  src/  scripts/
├─ templates/project/          # 프로젝트용 에이전트 스킬
└─ workspace/                  # 프레임워크 Git에서 전체 제외
   ├─ adaptive-denoise/        # 하나의 workspace
   │  ├─ project/             # 독립 소스 Git 저장소
   │  │  ├─ .git/  graph.json
   │  │  └─ blocks/  tests/    # 소스 내부 구조는 자유롭게 구성 가능
   │  ├─ data/                # 입력 데이터
   │  ├─ tmp/                 # 중간 산출물, 번들 제외
   │  ├─ artifacts/generated/ # 등록 전 준비한 최종 결과물
   │  ├─ .agents/  .claude/    # workspace 및 하위 폴더용 스킬
   │  └─ .isp/                # 요청·JOB·시도·체크포인트 기록·시각화·CLI
   └─ another-project/
```

서버는 프레임워크 루트에서 실행합니다. 상단 폴더 선택으로 `workspace/<프로젝트>` 또는 외부 workspace 폴더를 여세요. 새 workspace는 `project/`와 독립 Git 저장소를 준비하며 자동 일반 커밋이나 push는 하지 않습니다. 상위 프레임워크 Git은 프로젝트 버전으로 조회하지 않습니다. `isp workspace-info`의 `workspace`, `sourceRoot`, `graphFile`, `dataDir`, `tmpDir`로 실제 경로를 확인할 수 있습니다.

기존 workspace 루트에 있던 그래프·소스·독립 `.git`은 폴더를 열 때 사전 검사를 거쳐 `project/`로 이전합니다. 기존 Git 이력과 staging을 보존하고 `.isp/`, 입력 데이터와 결과물은 workspace에 남깁니다. 충돌하는 대상 경로, 지원하지 않는 Git worktree/submodule 또는 Git에 들어간 로컬 데이터 등은 자동으로 덮어쓰거나 삭제하지 않고 이전을 중단합니다. 경로가 바뀌므로 외부 스크립트의 작업 디렉터리는 `sourceRoot`로 갱신하고, 데이터/출력 경로는 workspace 기준으로 명시하세요. `.isp/`에는 중요한 작업 기록과 결과물이 있으므로 캐시처럼 삭제하면 안 됩니다.

## 실행

### Windows 배포

[GitHub Releases](https://github.com/Longseabear/ISPBlockMaker/releases/latest)에서 `ISPBlockMaker-Setup.exe`를 내려받아 설치하세요. Windows x64용이며 Node와 서버 의존성이 포함되어 별도 npm 설치가 필요하지 않습니다. 예제와 사용자 워크스페이스는 포함하지 않습니다.

설치 후 새 터미널에서 작업 폴더로 이동해 `isp-block-maker .`를 실행하면 해당 폴더를 초기화하고 서버와 브라우저를 엽니다. 시작 메뉴에서 실행하면 폴더를 선택할 수 있습니다. Git, Python, Claude Code/Codex 및 에이전트의 모델 연결은 별도 환경을 사용합니다. 폐쇄망에서는 사용할 에이전트와 모델 접속 환경을 별도로 준비해야 합니다.

`ISPBlockMaker-Setup.exe.sha256`으로 설치파일 무결성을 확인할 수 있습니다. 설치파일은 코드 서명되지 않은 초기 버전입니다.

Node.js 24 이상이 필요합니다. 검증 환경은 Windows입니다.

```sh
npm install
npm run dev
```

브라우저에서 http://127.0.0.1:4310 을 엽니다. 빌드한 버전을 실행하려면:

```sh
npm run build
npm start
```

서버는 로컬 PC의 loopback에만 연결합니다. Claude Code / Codex는 PC에 설치 및 로그인되어 있어야 합니다. 페이지를 열면 cmd 셸이 자동 연결됩니다. 에이전트를 바꾸려면 Stop을 누른 뒤 Terminal agent에서 CLI를 선택하면 바로 실행됩니다. 수동 종료한 셸은 Reconnect로 다시 연결합니다. 각 CLI의 권한 및 승인 설정은 그대로 사용합니다. Windows 기본 터미널은 cmd이며, macOS/Linux에서는 로컬 셸을 사용합니다.

## 사용 흐름

왼쪽 사이드바의 설계/구현/시각화 모드로 작업 공간을 전환합니다. 설계는 그래프 중심, 구현은 그래프+터미널, 시각화는 결과물 중심입니다. 상세/터미널 열기 버튼과 패널 최대화 메뉴로 각 영역을 접거나 최대화할 수 있습니다. 접힌 터미널의 프로세스와 작성 중인 상세 정보는 유지됩니다. 패널 크기와 상세 열림 상태는 브라우저에 저장됩니다. 터미널은 페이지를 열 때 항상 펼쳐지며, 시각화로 전환해도 유지됩니다.

노드 상세는 Overview(사람용 요약), Shared I/O(공통 명세), Agent contract(구현 계약), Results(블록별 결과)로 나뉩니다. 에이전트 계약에는 데이터 형식, 경계 처리, 수치 정밀도, 구현 순서, 검증 명령과 완료 조건을 기록합니다. `isp context`는 `human`과 `agent` 정보를 구분해서 반환하고 공통 명세는 동일한 블록 원본에서 구성합니다. 기존 블록의 미작성 계약은 빈 필드로 읽으며 원래 설명과 알고리즘은 유지됩니다.

1. 그래프에서 블록을 선택하고 오른쪽 Specification / Ports & params에서 수정 후 저장합니다.
2. 포트를 드래그하여 연결합니다. 타입 불일치·입력 중복·순환을 거부합니다. 간선을 클릭하고 Delete로 연결을 삭제합니다.
3. 선택한 블록에서 터미널을 시작합니다. 해당 블록 ID가 세션에 고정됩니다.
4. 에이전트에 `작업 전에 ISP bridge로 context를 읽고 선택 블록을 구현해줘`라고 요청합니다. `workspace/<프로젝트>/AGENTS.md`와 `CLAUDE.md`가 명령을 안내합니다.
5. 이미지 또는 자체 완결된 HTML을 생성한 뒤 `isp artifact`로 등록하면 Visualizations에 실시간 표시됩니다.

`Run example`은 로컬에 별도로 예제를 보유한 경우에만 동작합니다. 예제는 저장소에 배포하지 않습니다. 해당 로컬 예제는 합성 영상에 실제 3 × 3 분산 기반 flat detection과 선택적 mean filtering을 실행합니다. 입력/flat mask/출력/정답, RMSE, 전후 비교 슬라이더를 포함한 HTML을 만듭니다. RAW 처리나 RTL 검증 예제는 아닙니다.

## 에이전트용 CLI

웹 cmd 터미널에서:

```sh
isp context
isp context --selection
isp context --block denoise
isp project
isp add-block block.json --revision 1
isp connect input:image new-block:image --revision 2 --id input-new
isp disconnect input-new --revision 3
isp delete-block new-block --revision 4
isp demo
isp mermaid
isp update patch.json --block denoise --revision 1
isp artifact artifacts/generated/result.html --block denoise --revision 1 --title "Denoise result"
```

프레임워크 체크아웃의 외부 터미널에서는 `npm run isp -- context`를 사용합니다. 에이전트의 별도 셸에서 `isp`를 찾지 못하면 `node "<workspace>/.isp/tools/isp.mjs" context`를 사용합니다. 웹 터미널에는 `ISP_API_URL`, `ISP_API_TOKEN`, `ISP_BLOCK_ID`, `ISP_CLI` 환경변수가 전달됩니다. 외부 CLI의 서버 연결 정보는 workspace `.isp/connection.json`에서 읽습니다. `project/`에서 실행해도 CLI는 workspace 루트의 것을 사용하며, `isp workspace-info`로 실제 소스·데이터·tmp 위치를 확인하세요.

`update` 파일은 변경할 블록 필드만 포함하는 JSON입니다. `artifact`는 HTML/PNG/JPEG/WebP를 최대 10MB까지 지원합니다. 생성 시점의 revision을 명시해야 하며 현재 UI가 다른 revision이면 이전 결과로 표시됩니다. HTML은 inline JS/CSS와 data URL 이미지를 사용하세요. 외부 CDN, fetch, 부모 DOM 접근은 허용되지 않습니다.

## 프로젝트 로컬 스킬

간선 강조는 `isp present --edges EDGE_ID,EDGE_ID`를 사용합니다. 해당 간선과 양끝 노드를 함께 강조하고 화면에 맞춥니다. `--blocks`와 함께 쓸 수 있으며 삭제된 간선은 대신 남은 양끝 노드를 표시합니다.

작업 완료 후 `isp present --blocks ID,ID`로 변경 블록을 강조하고 화면에 맞추거나, `isp present --artifact ARTIFACT_ID`로 등록된 시각화를 바로 표시할 수 있습니다. `--message`는 완료 알림을 지정하며 `--graph`는 전체 그래프를 표시합니다. 현재 연결된 탭에만 전달하고 그래프 revision은 변경하지 않습니다. 미저장 편집이 있으면 사이드바의 ‘결과 보기’로 적용을 보류합니다. 터미널 세션과 표시 상태는 유지합니다. 스킬에는 작업 종류별 최종 화면 선택과 중간 단계의 불필요한 전환을 피하는 지침이 포함되어 있습니다.

`isp-block-maker`는 공통 연결 규칙과 작업별 스킬을 안내하는 짧은 진입점입니다. 에이전트는 필요한 스킬과 참고 문서만 읽으며, 여러 작업을 요청하면 해당 스킬들을 조합합니다.

| 스킬 | 사용하는 상황 | 주요 내용 |
| --- | --- | --- |
| `isp-block-maker` | ISP 작업 시작, 어떤 도구를 쓸지 불명확할 때 | 로컬 연결, 컨텍스트, 작업별 안내 |
| `isp-block-development` | 블록 구현·수정, 그래프 연결, 알고리즘 개선 | 그래프 범위, 입출력 계약, description/detail/에이전트 설명 동기화 |
| `isp-job-management` | JOB 등록·분할·병합, 메모 구현, 작업 상태 관리 | 등록과 실행 구분, 요청 출처 보존, 완료·취소 처리 |
| `isp-visualizations` | “리포트 발행해”, “시각화해”, 결과 비교 | HTML·이미지 생성, Visualizations 등록과 표시 |
| `isp-image-viewer` | “뷰어에 띄워”, RAW 검사, 현재 화면·크롭 분석 | RAW/CFA 설정, 확대·이동·강조, 양방향 화면·크롭 전달 |
| `isp-documentation` | 명시적인 SDD·Documentation 요청 | Overview → Flow → 블록 상세 HTML 문서 |
| `isp-version-sharing` | 작업 시도·체크포인트, 버전 비교·복원, 태그, 공유 | 소스 스냅샷, 실행 결과 연결, 번들 저장·복원 |

템플릿은 프로젝트를 열 때 `.agents/skills/`와 `.claude/skills/`에 공급됩니다. Claude용 스킬은 같은 이름의 공통 문서를 참조합니다. 프로젝트 및 하위 디렉터리에 적용되며, 전역 스킬 폴더나 사용자 설정은 변경하지 않습니다. 프로젝트의 `AGENTS.md`와 `CLAUDE.md`도 기존 진입점을 안내합니다.

기본 공급본과 확인 가능한 구형 기본본은 자동 갱신합니다. 사용자가 수정한 파일은 보존하고, 병합이 필요한 새 지침은 `.isp/skill-updates/`에 원래 경로대로 남깁니다. 공급 이력은 `.isp/skill-manifest.json`에 기록합니다. 프로젝트의 실제 목적·진입점·제약은 스킬에 복제하지 않고 그래프 Overview와 블록 설명에 기록하세요.

Codex에서는 `$isp-block-maker`, Claude Code에서는 `/isp-block-maker`로 호출합니다. 이미 실행 중인 에이전트에서 목록에 보이지 않으면 다시 시작하거나 스킬 파일을 직접 읽도록 요청하세요. 스킬 발견 방식은 [Codex 공식 문서](https://developers.openai.com/codex/skills)와 [Claude Code 공식 문서](https://code.claude.com/docs/en/skills)를 참고하세요.

하위 디렉터리에서 사용할 때는 `node "<프로젝트 절대경로>/.isp/tools/isp.mjs" ...`를 실행합니다. 이 진입점은 실제 현재 경로가 workspace 밖이면 거부합니다. 네트워크 요청은 숫자 loopback HTTP 주소만 허용하며 리다이렉트를 따라가지 않습니다. 이것은 프로젝트 로컬 적용과 CLI 범위 검사이며 에이전트의 전체 셸 권한을 격리하는 기능은 아닙니다.

`add-block` JSON은 최소한 `id`, `name`이 필요합니다. 생략한 설명은 빈 문자열, status는 draft, 포트는 빈 배열, 위치는 (300,300)입니다. `delete-block`은 연결이 있으면 실패하며 `--with-edges`로 노드와 연결을 함께 제거할 수 있습니다. 소스 파일과 과거 결과물은 보존합니다. 모든 그래프 변경에는 조회한 `--revision`이 필요하고, 성공 응답의 새 revision을 다음 명령에 사용합니다.

## 통신 경로

상단 프로젝트 이름을 클릭하면 **작업 폴더 선택** 창이 열립니다. 경로 입력 후 찾아보기 또는 하위 폴더 탐색으로 이동한 뒤 “이 폴더에서 작업”을 누르세요. 전환은 서버 전체에 적용되며 연결된 터미널은 종료됩니다. 새 터미널의 구현 작업 디렉터리는 해당 workspace의 `sourceRoot`입니다. 다른 탭은 작성 내용을 보관한 뒤 새로고침해야 합니다.

외부 workspace는 `project/graph.json`과 `.isp/`에 각각 그래프와 로컬 기록을 저장합니다. 처음 여는 폴더에는 빈 Input 블록, 소스 Git 저장소, 프로젝트 스킬, CLI(`.isp/tools/isp.mjs`), AGENTS/CLAUDE 안내를 준비합니다. 기존 사용자 지침과 직접 수정한 스킬은 보존하며, 수정하지 않은 기본 스킬은 갱신합니다. 모든 workspace는 자신의 `.isp/`를 사용하며 마지막 선택 경로는 서버 재시작 후에도 유지합니다. 직접 경로를 추측하기보다 `isp workspace-info`로 현재 경로를 조회하세요.

```text
Browser ── HTTP ──────────── Local Node server ── workspace/<프로젝트>/project/graph.json (Git)
        └─ WebSocket ───────┤
                           ├─ PTY ── cmd / Claude Code / Codex
                           ├─ .isp/project.json (local requests / JOBs / results)
                           ├─ Work tracking (attempts / checkpoint references)
                           └─ Artifact store

CLI agent ── isp.mjs ── HTTP API ── Local Node server
```

HTTP와 WebSocket도 TCP 위에서 동작합니다. Raw TCP를 직접 구현하면 메시지 경계·요청 ID·오류·재연결 처리를 별도로 만들어야 하며 브라우저에서 직접 raw TCP를 사용할 수도 없습니다. 실행 중인 에이전트에 TCP 패킷을 보내는 것만으로 새 도구 호출이나 사용자 요청이 되지는 않습니다. 이번 구현은 에이전트가 context를 명시적으로 조회하는 pull 방식입니다. WebSocket push는 웹 화면 갱신과 터미널 입출력에 사용합니다. 필요하면 같은 서비스 위에 MCP 어댑터를 추가할 수 있습니다.

주요 API는 `Authorization: Bearer <token>`을 사용합니다.

| Method | Path                    | 역할                            |
| ------ | ----------------------- | ------------------------------- |
| GET    | /api/project            | 전체 프로젝트                   |
| GET    | /api/workspace-info     | workspace·소스·데이터·tmp 경로    |
| PUT    | /api/project            | revision을 확인하여 그래프 저장 |
| GET    | /api/context?blockId=ID | 블록·상하류·결과물 정보         |
| POST   | /api/selection          | UI 선택 블록 설정               |
| PATCH  | /api/blocks/ID          | `{revision, patch}`로 블록 수정 |
| POST   | /api/artifacts          | base64 결과물 등록              |
| GET    | /api/mermaid            | Mermaid 내보내기                |
| POST   | /api/demo               | 고정된 합성 영상 예제 실행      |

## 구현 버전 선택

상단 버전 버튼에 현재 태그 또는 브랜치와 짧은 커밋 해시를 표시합니다. `*`는 미커밋 변경이 있다는 뜻입니다. 기본 목록은 완성본 용도의 태그이며, 브랜치와 최근 커밋도 선택할 수 있습니다. 커밋 제목·본문과 현재 버전 대비 변경 파일, 추가·수정·삭제된 블록을 확인한 뒤 적용하세요. 특정 커밋/태그 선택은 detached HEAD로 열립니다. 작업 과정과 결과를 함께 보려면 아래 시도·체크포인트 기록을 사용하세요.

적용하면 연결된 터미널을 종료하고 Git으로 그래프와 구현을 함께 전환한 뒤 화면을 다시 엽니다. 로컬 요청·JOB·시각화는 유지합니다. 미저장 편집이나 저장소의 미커밋 변경이 있으면 전환을 차단하며 자동 stash/폐기는 하지 않습니다. 작업 폴더 밖의 앱 파일까지 달라지는 버전, 그래프 명세가 없는 버전, 로컬 기록을 Git에 포함한 버전도 UI에서 적용할 수 없습니다. 저장소가 없거나 첫 커밋 전이면 안내만 표시하며 자동으로 초기 커밋을 만들지 않습니다.

## 파일과 검증

- `src/`: React Flow 그래프, 명세 편집기, xterm.js 터미널, 결과물 뷰어.
- `server/`: HTTP/WebSocket/PTY 및 revision 검증·파일 저장.
- `scripts/isp.mjs`: 에이전트가 호출하는 HTTP CLI.
- `workspace/`: IP 구현 코드와 에이전트 지침.
- `workspace/<프로젝트>/project/graph.json`: 소스 Git으로 구현 코드와 함께 관리할 그래프 원본. 블록 ID·설명·계약·포트·파라미터·위치·구현 경로·상태와 간선을 저장합니다. 구현 경로는 `sourceRoot` 기준이며 Mermaid는 이 명세에서 생성합니다.
- `.isp/project.json`: 로컬 요청·JOB·시각화 목록·선택 노드·동시 편집 revision. Git에서 제외됩니다. 결과물 사본과 연결 정보도 `.isp/`에 유지합니다.

기존 통합 데이터는 최초 실행 시 자동 분리하며 `.isp/project.legacy.json`에 원본을 보관합니다. API는 두 저장소를 합친 기존 프로젝트 형식을 유지합니다. 요청 작성, JOB 처리, 시각화 등록, 노드 선택만으로 그래프 파일은 변경되지 않습니다.

버전이나 체크포인트로 `project/graph.json`과 구현 코드를 함께 복원한 뒤 최신 화면과 컨텍스트를 확인하세요. 서버는 명세를 다시 읽고 revision을 갱신하여 오래된 저장을 거부합니다. 그래프에서 사라진 노드의 로컬 기록은 ID별로 보관하고 해당 ID가 돌아오면 다시 연결합니다. ID를 다른 의미의 노드에 재사용하지 마세요. 명세 파일이 없거나 잘못된 JSON이면 자동 덮어쓰기 없이 오류를 반환합니다. 이전 결과물은 유지하며 시도 기록에서 실행 조건·검증·결과 체크포인트를 연결할 수 있습니다.

```sh
npm test
npm run build
```

테스트는 그래프 타입/순환 검증, 저장 충돌·재로딩, 참조 모델 불변성, API 접근 검사, HTML 격리 헤더, 실제 WebSocket → PTY → HTTP context 조회를 확인합니다.

현재 범위는 단일 프로젝트, 평면 블록 그래프, 탭당 한 개의 활성 터미널입니다. 설명은 블록 JSON에 저장하며 구현 코드는 파일 경로로 참조합니다. 배치 변경도 revision을 증가시킵니다. 결과물은 블록 ID·revision·생성 시간과 선택적 실행 ID/metadata를 기록합니다. 예제는 입력 규격·난수 seed·파라미터·RMSE·코드 해시를 포함합니다.

터미널 연결이 끊기면 60초간 유지하며 같은 화면에서 네트워크 재연결 시 복원합니다. 페이지를 새로고침하면 새 cmd 터미널이 자동으로 시작됩니다. 하위 그래프, 블록 정의 재사용, 임의 그래프 자동 실행, RTL 도구 연동은 아직 구현하지 않았습니다. 생성 HTML의 격리는 로컬 CLI 자체를 sandbox하는 기능은 아닙니다.

## JOB Queue와 반복실험

왼쪽 사이드바의 작업 화면들 아래에 **JOB Queue**가 있습니다. 전역 요청과 모든 블록의 JOB을 함께 표시하며, 남은 작업 수·진행 상태·검색·완료 필터를 제공합니다. 아직 JOB으로 변환되지 않은 요청은 별도 접이식 목록으로 표시합니다. 작업의 “요청 / JOB 관리” 버튼으로 기존 편집창을 열어 삭제하거나 내용을 확인하세요. 단순 조회는 요청을 소비하지 않습니다.

프로젝트 스킬 옆 `experiment-loop.md`는 반복실험용 에이전트 지시문입니다. 고정 입력/seed/metric, 시도별 기준·결과 체크포인트, 검증·시각화 연결, JOB 완료, 실패/횟수에 따른 종료와 결과 화면 제시를 정의합니다. 기본 한도는 최대 5개 후보, 연속 실패 2회 또는 개선 없는 후보 3회입니다. 사용자가 지정한 범위가 우선합니다. 자동 터미널 타이머나 결과 채택을 시작하지 않습니다.

## 작업 시도와 체크포인트

왼쪽 **JOB Queue**를 열면 **Work Tracking**의 **작업 목록 / 작업 시도 · 체크포인트 / 활동 기록** 탭을 사용할 수 있습니다. JOB 카드의 **새 시도**는 해당 JOB을 연결해 시작합니다. 시도 화면에서 **결과 기록**, **변경 비교**, **채택**, **이 구현으로 돌아가기**를 사용할 수 있고, 아래 체크포인트 목록에서는 이름을 붙여 저장하거나 두 버전을 비교할 수 있습니다.

작업은 JOB → 시도 → 결과 체크포인트로 연결할 수 있습니다. 한 JOB에서 여러 접근을 시험하거나, 관련된 여러 JOB을 한 시도로 처리할 수 있습니다. JOB 없이 시작한 알고리즘 작업도 시도로 기록할 수 있고, 같은 구현으로 입력만 바꾼 실험도 각각 남길 수 있습니다.

| 구분 | 기록하는 내용 |
| --- | --- |
| JOB | 달성할 목표와 완료 조건 |
| 시도 | 접근 방법, 연결된 JOB/블록, 시작 구현, 입력·파라미터, 검증, 시각화, 결과 구현 |
| 체크포인트 | 이름을 붙인 전체 그래프·코드의 Git 스냅샷 |
| 채택 | 사용자가 선택한 시도. 코드를 자동으로 바꾸지 않음 |
| 태그 | 사용자가 완성본으로 지정한 Git 버전 |

체크포인트는 별도 Git 인덱스와 보존용 ref로 만들기 때문에 현재 브랜치 HEAD나 사용자 staging을 변경하지 않습니다. 저장 당시 소스의 미커밋 변경과 Git에서 무시하지 않은 새 파일도 포함합니다. 에이전트는 본인 변경과 기존 사용자 변경을 구분해 설명하고, 실제 검증한 체크포인트에 결과를 연결해야 합니다. 체크포인트 자체가 실행·검증 성공을 보증하지는 않습니다.

```text
isp workspace-info
isp attempts
isp attempt-start "<workspace>/tmp/my-task/start.json"
isp checkpoint --title "max-min candidate"
isp attempt-update ATTEMPT_ID "<workspace>/tmp/my-task/result.json"
isp checkpoints
isp checkpoint-compare BASELINE_ID RESULT_ID
```

시도 시작 JSON은 `title`, 선택적 `approach`, `blockIds`, `jobRefs` (`{blockId, jobId}` 배열; 전역 JOB의 `blockId`는 `null`), `inputConditions`, `baselineCheckpointId`를 받습니다. 기준 체크포인트를 생략하면 현재 소스를 캡처합니다. 갱신에는 `summary`, `validation` (문자열 배열), `artifactIds`, `resultCheckpointId`, `status` (`in_progress`, `completed`, `failed`, `cancelled`)도 사용할 수 있습니다. 입력 파일·해시·파라미터·seed·실행 명령은 `inputConditions`, 실제 검증 결과와 수치는 `validation`에 남기세요.

완료 시 결과 체크포인트를 생략하면 현재 소스를 저장합니다. **검증 후 코드가 바뀌었다면 이전에 검증한 `resultCheckpointId`를 명시하거나 최종 소스로 다시 검증하세요.** 시각화는 `--run ATTEMPT_ID`로 등록하고 반환된 결과 ID를 연결할 수 있습니다. 완료·실패·취소한 시도는 기록을 고정하며, 다음 접근은 새 시도로 남깁니다. 시도 완료와 JOB 완료는 별도입니다.

복원은 먼저 `isp checkpoint-preview ID`로 확인한 뒤 반환된 `snapshot`을 `isp checkpoint-restore ID --snapshot VALUE`에 전달합니다. 그 사이 소스·HEAD·staging이 변경되면 다시 확인해야 합니다. 복원 직전 현재 상태를 안전 체크포인트로 보존하고, 연결된 터미널을 종료한 뒤 전체 그래프와 코드를 함께 복원합니다. JOB 상태·시도·시각화는 과거로 되감지 않습니다. 공유 `.py`와 블록 간 계약 때문에 노드 하나만 복원하는 기능은 제공하지 않습니다.

`isp attempt-accept ID`는 완료된 시도의 채택 표시만 변경합니다. 현재 구현과 화면에서 보고 있는 결과는 별도로 유지되며, 채택만으로 복원하거나 태그를 만들지 않습니다. 스킬은 큰 구현 작업의 시도/체크포인트를 기록하되, 단순 JOB 등록·조회·이미지 표시에는 불필요한 실험을 만들지 않도록 안내합니다.

## GPU simulator extensions

왼쪽 **GPU simulator**에서 WebGL2로 이미지의 파라미터 변화를 봅니다. 기본 이미지 조정과 소스 루트의 `extensions/gpu/*.json` 확장을 선택할 수 있습니다. 이미지 업로드(20MB 이하, 긴 변 최대 1024px), 고정 seed 합성 입력, 슬라이더, 비교 결과 고정, 명시적인 그래프 파라미터 적용, PNG 시각화 저장을 지원합니다. 저장 후 Visualizations로 이동합니다. 기존 그래프를 자동으로 GPU로 변환하지는 않습니다.

확장은 아래 형태입니다. `fragment`에는 GLSL ES 3.00 전체 소스를 넣습니다. `u_image`는 sampler2D, `u_resolution`은 vec2이며, 매니페스트의 각 파라미터는 float uniform입니다. 정점 셰이더는 프레임워크가 제공합니다. `blockId`와 `parameter`를 함께 지정하면 그래프의 해당 숫자 파라미터에 연결됩니다. 결과용 최상위 `blockId`는 선택 사항입니다.

```json
{
  "version": 1,
  "id": "my-filter",
  "name": "My filter",
  "description": "GPU implementation and its approximations",
  "blockId": "filter",
  "fragment": "#version 300 es\nprecision highp float;\nuniform sampler2D u_image;\nuniform float gain;\nout vec4 color;\nvoid main(){color=vec4(texelFetch(u_image,ivec2(gl_FragCoord.xy),0).rgb*gain,1.0);}",
  "parameters": [{"name":"gain","label":"Gain","min":0,"max":2,"step":0.01,"default":1,"blockId":"filter","parameter":"gain"}]
}
```

미리보기는 RGBA8이며 RAW/float 파이프라인 정밀도를 보장하지 않습니다. 표시되는 RMSE는 **입력과 출력의 차이**이고 품질 점수가 아닙니다. 시간은 셰이더 준비·실행·GPU 읽기를 포함한 벽시계 시간입니다. GPU 동등성을 주장하려면 프로젝트의 CPU 참조와 허용오차 검증을 별도로 수행하세요. WebGL2 지원과 실제 장치/드라이버에 따라 하드웨어 가속 여부가 달라질 수 있습니다. 규격 참고: [WebGL2 API](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext).

## 활동 기록과 편집 단축키

JOB Queue의 **활동 기록** 탭에서 최근 API 변경·오류, JOB 완료, 시각화와 프로젝트 Git 커밋을 확인합니다. 새 API 활동은 프로젝트 `.isp/activity.json`에 최대 1,000개 보관하고 화면에는 최근 300개를 표시합니다. 도입 이전의 모든 작업/터미널 출력을 복원하는 기능은 아니며, 기존 JOB 완료·시각화·Git 기록을 함께 조회합니다.

Ctrl+S (macOS Cmd+S)는 현재 블록/전역 요청 편집을 저장합니다. Ctrl+Z는 텍스트 입력 중에는 기본 텍스트 되돌리기를 사용하고, 입력창 밖에서는 미저장 편집을 최대 100단계 되돌립니다. 저장된 Git 버전을 되돌리는 단축키는 아닙니다. 터미널의 단축키는 가로채지 않습니다.

미저장 상태로 사이드바·다른 노드·프로젝트 폴더로 이동하면 **저장 후 이동 / 변경 버리고 이동 / 계속 편집** 팝업을 표시합니다. 저장 오류나 revision 충돌이면 입력과 팝업을 유지합니다. 브라우저 새로고침/닫기는 기본 미저장 경고를 사용합니다.

### 작업 요약과 커밋 상세

활동 기록의 커밋 카드에서 **변경 파일 · 블록 · 코드 보기**를 펼치면 해당 커밋의 부모 대비 파일 목록, 블록 변경 항목, 파라미터 전후 값, 코드 diff를 확인할 수 있습니다. 첫 커밋은 전체 추가이며 merge는 첫 부모 기준입니다. 공통 구현 파일을 참조하는 블록은 영향받는 블록으로 함께 표시합니다. 현재 작업 파일을 변경하지 않는 읽기 전용 비교입니다.

에이전트는 `isp summary "<workspace>/tmp/<task>/summary.json"`으로 별도 작업 요약을 기록합니다. JSON 필드는 `title`, `summary`(필수), `reason`, `changes`(문자열 배열), `validation`(문자열 배열), `limitations`, `commit`, `blockIds`, `jobIds`, `artifactIds`입니다. 검증 결과는 에이전트가 작성한 기록으로 표시하며 자동 실행/검증으로 간주하지 않습니다. 연관된 블록/JOB/결과는 활동 카드에서 열 수 있습니다. 과거에 작성되지 않은 이유·검증은 자동으로 추측하지 않습니다.

### GPU 소스 변경 감지

GPU 확장의 선택적 `reference`는 `{ "shaderSha256": "<fragment 문자열의 SHA256>", "sources": [{"path":"blocks/filter.py", "sha256":"<소스 파일 바이트의 SHA256>"}] }` 형식입니다. 셰이더는 UTF-8 문자열, 소스는 원본 파일 바이트 기준으로 해시를 계산합니다. 프로젝트 안의 2MB 이하 파일을 최대 30개 지정할 수 있습니다. 관련 소스·공통 helper를 빠짐없이 지정하세요.

GPU 탭은 열려 있는 동안 15초 간격 및 ‘확장 새로고침’으로 기준과 현재 파일을 비교합니다. 상태만 갱신될 때 슬라이더 값은 보존합니다. 미등록, 기준 일치, 변경 감지, 파일 확인 불가를 구분하며 결과 메타데이터에도 조회된 상태를 남깁니다. 기준 일치는 기록한 파일이 그대로라는 의미이며 CPU/GPU 동등성 검증을 보증하지 않습니다. 경고를 없애려고 자동으로 기준을 갱신하지 말고, 변경을 검토한 뒤 관련 소스와 셰이더 기준을 함께 갱신하세요.

## Image Viewer: 크롭과 에이전트 분석

RAW는 CFA colors, BMP는 RGB로 열립니다. 축소 상태에서는 전체 미리보기를 사용하고, 원본 기준 100% 이상 확대하면 현재 보이는 원본 타일을 WebGL2로 렌더링합니다. RAW는 정렬된 16비트 정수 텍스처, BMP/RGB는 원본 RGB 텍스처를 사용하며 확대 보간 없이 픽셀을 표시합니다. `1:1`은 원본 한 픽셀을 화면의 한 CSS 픽셀로 맞춥니다. 커서를 올리면 원본 좌표와 RAW 값 또는 R/G/B 값을 확인할 수 있습니다.

원본 타일이 로딩 중이거나 GPU 오류가 있으면 확대 화면에서 새 크롭 확정을 기다립니다. Simple ISP는 타일 주변의 원본도 읽어 경계에서 보간이 끊기지 않도록 합니다. 현재 화면을 에이전트에게 전달할 때 WebGL 영상·픽셀 값·강조 표시를 함께 포함합니다. 이 확대 기능에는 WebGL2 지원이 필요하며 모든 데이터는 로컬 서버에서 읽습니다.

드래그로 영역을 그리고 **Shift + 추가 드래그**로 여러 영역을 묶습니다. 캔버스 위의 번호·미리보기는 아직 저장하지 않은 영역이며, **크롭 추가**를 누르면 한 크롭 항목으로 저장하고 그리던 선택은 비웁니다. 오른쪽 **이번 전달**에서 목적(영역 분석 / WB 계산 / 입력 데이터 만들기)과 공통 설명을 작성하고 전달합니다. 자동 저장·자동 전달은 하지 않습니다.

전달 후에는 선택이 해제되고 **처리 대기 / 처리 완료**가 표시됩니다. 에이전트가 읽거나 통계를 조회하는 것만으로 완료되지 않으며, 처리 후 해당 전달 ID를 확인해야 합니다. 이전 크롭은 접힌 기록에 남고, 눈 아이콘은 저장된 영역을 확인하는 표시만 띄웁니다. 상세 메뉴에서 설명 수정·다운로드·삭제가 가능합니다.

확대하면 실제 원본 RAW 값 또는 RGB 값이 물리적 픽셀 위치에 표시됩니다. 기본 켜짐이며 상단 `#` 아이콘으로 전환합니다. Bayer·Tetra(2×2)·TetraSquare(4×4), bit depth/alignment와 CFA 원점을 반영하며 감마·Simple ISP 처리 전 값입니다. 충분히 확대됐을 때만 보이는 영역을 조회합니다(최대 4,096픽셀). 현재 화면을 에이전트에게 보여줄 때도 이 표시가 포함됩니다.

```text
isp viewer-crops
isp viewer-crop-stats DELIVERY_ID --black 64 --white 1023
isp viewer-crops-ack DELIVERY_ID --note "두 영역의 WB 추정 완료"
isp viewer-stats IMAGE_ID --roi 100,100,64,64
isp viewer-pixels IMAGE_ID --roi 100,100,4,4
isp viewer-image current --vision
```

통계는 크롭 파일 또는 지정 ROI를 로컬에서 읽어 R/Gr/Gb/B별 평균·범위·표준편차·유효/포화 개수를 반환합니다. WB는 블랙·포화 샘플을 제외한 중성 패치 가정의 추정값입니다. 입력으로 관리할 때는 전달받은 정확한 크롭 파일과 규격을 사용합니다. 원본 전체나 base64를 에이전트 텍스트에 출력하지 않도록 CLI와 스킬을 보완했습니다. `viewer-image --vision`도 이미지 파일 경로를 반환하며, 이미지 입력이 가능한 도구에서 직접 읽습니다. 통계는 한 호출에 총 16,777,216픽셀, CLI 픽셀 표는 256픽셀까지입니다.

### 에이전트가 크롭 요청 후 기다리기

```sh
isp viewer-request IMAGE_ID --message "WB용 중성 영역을 선택하고 추가 → 전달해주세요" --purpose white_balance
isp viewer-wait REQUEST_ID
```

기본 동작은 **전달 또는 취소까지 계속 대기**입니다. 55초마다 서버의 long-poll 응답이 만료되어도 CLI는 동일 요청으로 자동 재연결합니다. 사용자가 **전달**하면 `fulfilled`와 여러 ROI의 파일 경로·규격을 반환합니다. 그리기·추가만으로는 완료되지 않고 이미지 바이너리는 출력하지 않습니다. 요청 ID는 생성 직후 stderr에 표시됩니다.

요청 등록만 하고 즉시 돌아오려면 `viewer-request ... --no-wait`, 대기 시간을 제한하려면 `--wait SECONDS`(0–600)를 지정합니다. `--wait 0`은 한 번만 상태를 확인합니다. `viewer-result REQUEST_ID`는 저장된 크롭 조회이며, `viewer-result REQUEST_ID --wait SECONDS`는 명시적인 전달을 기다립니다.

터미널 도구가 실행 중 핸들을 반환하면 에이전트는 같은 프로세스를 계속 기다려야 합니다. 프로세스가 살아 있는 동안 새 요청을 만들거나 최종 답변으로 작업을 종료하지 않도록 스킬에 명시했습니다. 도구가 실행을 강제 종료하거나 에이전트 자체가 중단된 경우에는 자동 실행하지 않으며 `viewer-wait REQUEST_ID`로 이어갑니다. 서버 재시작 후에도 요청과 전달은 남습니다.

작업 터미널 밖에서는 workspace에서 `node .isp/tools/isp.mjs viewer-wait REQUEST_ID`로 실행할 수 있습니다.

## Reference I/O · 선택적 참조 입출력

왼쪽 **Reference I/O**에서 원하는 블록·여러 블록 구간의 입력과 출력을 모읍니다. 연결 블록은 없어도 되고 여러 개여도 됩니다. Python 블록과 C-model 함수의 1:1 대응, 입력/출력 파일 개수, 필수 규격은 강제하지 않습니다.

세트를 만든 뒤 파일을 올리거나, 생성 시 Workspace 파일 경로를 지정합니다. **최근 전달 크롭으로 만들기**는 Viewer에서 전달한 여러 ROI를 각각의 원본 바이트와 규격으로 복사합니다. 전달을 자동 소비하지 않습니다. 파일별 역할(입력/출력/기타), 설명, 자유 JSON 규격과 세트별 실행 조건·선택적 체크포인트를 기록할 수 있습니다. 사본은 `.isp/reference-sets/`에 보관하며 원본은 변경하지 않습니다.

**입출력 세트 ZIP**으로 manifest와 파일을 내보내거나 프로젝트 `.bundle`에 함께 담습니다. Viewer·data/를 제외한 번들에서도 등록된 참조 사본은 유지됩니다. 등록 시 Git HEAD·dirty 여부·그래프 해시를 기록하지만, 파일을 그 구현으로 실행했다는 증명은 아닙니다. 생성 당시 실제 체크포인트와 조건을 명시하세요.

`isp reference-sets`, `reference-create FILE.json`, `reference-show SET_ID`, `reference-add SET_ID FILE.json`을 에이전트도 사용할 수 있습니다. `reference-compare SET_ID EXPECTED_FILE_ID ACTUAL_FILE_ID`와 UI의 **바이트 비교**는 직접 고른 두 파일의 완전 일치 여부·차이 개수·첫 차이 위치를 확인합니다. 현재 비교는 바이트 기준이며 dtype 변환·수치 허용오차·픽셀 좌표 비교는 자동 적용하지 않습니다. 파일당 256 MiB, 세트당 64개·512 MiB까지 지원합니다.

## 작업 프로젝트 공유 (.bundle)

상단 **공유 → .bundle 저장**으로 그래프·코드·프로젝트 스킬·요청/JOB·시도 기록·시각화/SDD·Viewer 크롭을 한 파일로 전달합니다. 저장 전 포함/제외 목록과 예상 용량을 확인하세요. Viewer 원본은 기본 포함이며 Git 이력은 선택입니다. **상대방도 과거 체크포인트로 돌아갈 수 있어야 한다면 Git 이력을 포함하세요.**

```powershell
isp-block-maker pack C:\Work\MyISP -o C:\Work\MyISP.bundle --with-git
isp-block-maker open C:\Work\MyISP.bundle --into C:\Work\ReceivedISP
```

UI의 **번들 열기**에서는 내용을 확인한 뒤 **새 폴더 만들기 / 기존 작업 폴더에 덮어쓰기**를 선택합니다. 새 폴더의 부모는 미리 준비합니다. 덮어쓰기는 기존 폴더 전체를 옆의 `.backup-시간-식별자` 폴더에 보관하고, 검증된 번들로 교체한 뒤 해당 프로젝트를 엽니다. 대상 서버의 터미널 작업은 종료됩니다. 대상이 미리보기 이후 변경됐다면 위치를 다시 확인해야 합니다. CLI에서는 서버를 먼저 종료하고 `open ... --into FOLDER --overwrite`로 명시합니다. `--no-open`은 복원과 초기화만 수행합니다. 현재 폴더를 여는 `isp-block-maker .`도 그대로 지원합니다.

`pack`에는 workspace 루트 또는 그 아래 `project/`를 지정할 수 있습니다. 그래프·구현은 항상 포함하고 **Visualizations는 전체 / 선택 / 제외**를 고릅니다. Viewer 자료·원본 이미지·`data/`·Git 이력은 각각 선택할 수 있습니다. CLI 옵션은 `--without-images`, `--without-viewer`, `--without-data`, `--without-visualizations` 또는 `--visualizations ID,ID`, `--with-git`, `--dry-run`입니다. Git 이력이 없으면 현재 구현과 시도 기록은 포함하지만 과거 체크포인트의 소스 복원은 보장할 수 없습니다. 이력을 포함해도 미커밋 구현은 보존됩니다. Git 원격 설정·훅은 복원하지 않습니다. 큰 번들 파일은 `sourceRoot` 밖에 저장하세요.

번들은 ZIP 저장 방식과 버전 2 명세/체크섬을 사용하며 기존 버전 1도 읽습니다. 최대 2 GiB, 파일당 256 MiB, 10,000개 파일입니다. 일반 ZIP이나 git bundle 형식과는 다릅니다. 가져올 때 파일 경로와 SHA-256/CRC, 그래프·로컬 기록을 확인합니다. 덮어쓰기는 유효한 ISP 작업 폴더만 대상으로 하고 프레임워크·홈·상위 폴더·연결된 경로는 보호합니다.

`.isp/connection.json`, `.isp/tools/`, node_modules, 가상환경, 알려진 비밀 파일명·개인 에이전트 설정과 링크는 제외됩니다. 소스에 직접 적힌 API 키나 Git 과거 커밋의 비밀값까지 검사하는 기능은 아닙니다. 에이전트 쓰기 작업을 잠시 멈추고 UI 편집을 저장한 뒤 공유하세요. 내보내기 중 변경이 감지되면 재시도를 요청합니다.

원본 제외 시 기존 크롭은 다운로드할 수 있지만 원본 미리보기·새 크롭은 제한됩니다. 동일 원본과 설정을 `viewer-open`으로 재등록하면 원본을 복구할 수 있습니다. Python 실행 환경과 외부 경로로 참조한 데이터는 별도 준비가 필요합니다.

소스 체크아웃에서는 `node scripts/workspace-cli.mjs pack ...` / `open ... --no-open`으로도 사용할 수 있습니다. [스크린샷과 공유 가이드](https://longseabear.github.io/ISPBlockMaker/#sharing)는 `docs/`에서 관리합니다.


### v0.1.10 편의 기능

- 상단 **번들 열기**에서 `.bundle`을 확인한 뒤 새 폴더 복원 또는 백업 후 덮어쓰기를 선택하고 해당 프로젝트를 엽니다.
- 왼쪽 사이드바 경계를 드래그하여 너비를 조절할 수 있습니다. 방향키로도 조절하며 더블클릭하면 초기 너비로 돌아갑니다.
- 그래프 왼쪽 위 **전체 그래프 설명 및 요청사항 → 사용자 설명**에서 목적, 상세 흐름, 실행 진입점, 자유 형식 에이전트 메모를 기록합니다. `graph.json`의 `overview`에 저장하며 에이전트는 `isp graph-info`로 조회하고 `isp graph-info patch.json --revision N`으로 수정합니다.
- 중간 산출물은 workspace의 `tmp/<task-or-job-id>/`에 작성하도록 프로젝트 스킬이 안내합니다. 루트 `tmp/`는 Git 및 번들에서 제외되므로 최종 구현/등록 결과물은 영구 경로로 옮기세요.
- Viewer에서 Esc, 취소 아이콘 또는 드래그 없는 클릭으로 현재 크롭 선택을 해제할 수 있습니다. 저장된 크롭은 유지됩니다.


## Project Skills · 프로젝트 전용 스킬

왼쪽 **Project Skills**에서 프로젝트 스킬을 만들고 본문·참조 문서·보조 스크립트를 함께 편집합니다. 프레임워크 기본 스킬은 읽기 전용으로 구분합니다. `SKILL.md`의 name과 description으로 사용 시점을 지정하고, 상세 절차는 본문이나 참조 파일에 적습니다. 목록 검색으로 필요한 스킬을 찾고 저장 상태·읽기 전용 배지를 확인합니다. Ctrl+S로 저장할 수 있으며 탭을 오가도 작성 중인 내용은 유지됩니다.

스킬은 workspace의 `.agents/skills/이름/`에 저장하고 Claude용 진입점은 `.claude/skills/이름/`에 연결합니다. 전역 설치는 하지 않습니다. 에이전트는 `isp skills`, `isp skill-show NAME`, `isp skill-save FILE.json`으로 조회·작성하고, `context`에도 프로젝트 스킬 목록이 포함됩니다. 현재 세션이 새 스킬 목록을 자동 반영하지 않으면 CLI로 읽거나 세션을 새로 시작하세요.

스킬 선택 후 **선택 스킬 공유**로 `.skills.bundle`을 내보내고, **스킬 번들 열기**에서 내용·충돌을 확인한 뒤 선택해 가져옵니다. 같은 이름은 명시적으로 선택해야 덮어쓰며, 미리보기 후 변경된 스킬은 덮어쓰지 않습니다. 스크립트는 가져올 때 실행하지 않습니다. 전체 프로젝트 `.bundle`에는 프로젝트 스킬이 함께 들어갑니다. 스킬 전용 번들은 Skills 탭에서, 프로젝트 전체 번들은 상단 번들 열기에서 사용하세요.

CLI: `isp skill-export NAME,NAME --out FILE.bundle`, `isp skill-import-preview FILE.bundle`, `isp skill-import FILE.bundle --choices FILE.json`. 선택 JSON은 미리보기에서 확인한 `{name, version}` 배열입니다. 이전 파일과 삭제한 스킬은 `.isp/skill-history/`에 백업되며 공유에서 제외합니다.

에이전트 가이드는 계획·재사용 가능한 발견·작업 완료 시 스킬화의 가치를 판단하도록 합니다. 반복 작업 절차는 스킬로, 현재 알고리즘 설명과 일회성 결과는 그래프/블록 설명·활동 기록으로 남깁니다. 기존 스킬 보완을 우선하며, 매 생각마다 스킬을 생성하거나 모든 스킬을 한꺼번에 읽도록 강제하지 않습니다.

### 터미널 새로고침 복구

같은 브라우저 탭을 새로고침하면 서버에 유지된 터미널 세션으로 다시 연결합니다. 재연결 중 입력은 전송하지 않으며, 최근 출력(최대 200,000자)을 복원한 뒤 입력을 활성화합니다. 같은 세션에 새 연결이 붙으면 이전 연결의 입력 권한은 해제됩니다. Stop·프로세스 종료·서버 종료·workspace 교체 시에는 세션이 종료됩니다. 탭을 닫는 것만으로 작업은 종료되지 않으므로 종료하려면 Stop을 누르세요. 서버 재시작과 새 탭에서는 새 세션을 시작합니다. 전체 로그를 영구 저장하는 기능은 아닙니다.

### 에이전트 지식과 그래프 유지 지침

기본 스킬은 공통 진입점과 블록 개발·JOB·시각화·Image Viewer·SDD·버전/공유의 7개입니다. 시각화는 **isp-visualizations**이며 Project Skills에서 `시각화`로 검색할 수 있습니다. 사용자 질문 → 비교 조건 → 적절한 그림/표 → 실제 검증 → 등록/표시의 방법론을 따릅니다. 구체적인 실행 명령과 형식 제약은 실행 가능한 도구 계약으로 유지합니다.

workspace 초기화/열기 시 `.agents/skills`와 `.claude/skills`를 함께 설치하고 `AGENTS.md`와 `CLAUDE.md`로 진입점을 안내합니다. `.claude` 전체나 기존 사용자 설정을 덮어쓰지 않습니다. 별도 주기 실행 훅은 설치하지 않습니다.

그래프는 구현/검증 단계가 끝났을 때, 입출력·알고리즘·진입점·보장 조건이 달라졌을 때, 작업 인계/완료 때 점검합니다. 실제로 달라진 정보만 갱신하고 일치하면 수정하지 않습니다. 카드 설명은 짧게 유지하며 상세 원리·정밀 I/O·수치 조건은 블록 Detail/agent contract에, 프로젝트 목적·실행법·블록 간 제약은 overview에 기록합니다. 재사용 방법은 스킬, 개별 실행 결과는 활동/시도/시각화에 남겨 정보 중복과 오래된 설명을 줄입니다.

workspace의 `AGENTS.md`에는 작업 시작·구현/검증 단계·완료 시 그래프 정합성 점검, 근거 기반 검증, 정보 배치, 충돌 처리, 재사용 스킬 판단, 결과 표시의 핵심 지침을 설치합니다. `CLAUDE.md`는 이를 참조합니다. 기존 사용자 문구와 사용자가 수정한 지침은 보존하며 재실행으로 같은 지침을 중복 추가하지 않습니다. 주기 실행 훅이나 자동 배경 작업은 만들지 않습니다.

### 에이전트용 개발 도구

반복 지침을 실제 점검·실행·표시 도구로 연결합니다. 수치 허용오차 비교기는 추가하지 않으며 기존 Reference I/O의 바이트 비교는 그대로 유지합니다.

| 명령 | 역할 |
| --- | --- |
| `isp graph-check [--block ID] [--changed blocks/a.py,blocks/b.py]` | 구현 파일·진입점·포트/연결을 읽기 전용으로 점검하고 공유 파일의 영향 블록과 검토 항목을 반환 |
| `isp recipes` / `isp recipe-show ID` | 프로젝트의 재사용 실행 방법 목록/정의와 해시 확인 |
| `isp recipe-save FILE.json` | `{recipe, expectedHash:null 또는 현재 해시}`로 실행 방법 저장. 저장만으로 실행하지 않음 |
| `isp recipe-plan ID --params FILE.json` | 실행 파일·인자·작업 디렉터리·예상 출력 미리보기. 파일 생성/실행 없음 |
| `isp recipe-run ID --params FILE.json --hash HASH` | 확인한 실행 정의로 로컬 실행하고 종료 상태·로그·출력과 실행 근거 기록 |
| `isp report-build FILE.json --out artifacts/generated/result.html` | 이미지 비교, 프로파일/곡선, 히스토그램, 표를 self-contained HTML로 생성 |

실행 정의는 `project/.isp-recipes/`에서 소스와 함께 관리하며 전체 프로젝트 번들에 포함됩니다. 하나의 실행이 여러 블록을 다루거나 여러 실행이 한 블록을 검증해도 됩니다. 명령은 실행 파일과 인자 배열로 구분하고 쉘 문자열로 재해석하지 않습니다. 쉘 스크립트가 필요하면 인터프리터와 인자를 명시합니다. 비밀번호나 토큰을 정의·파라미터·로그에 넣지 마세요. 가져온 정의는 먼저 읽고 미리보기한 뒤 작업 범위에 맞을 때 실행합니다.

실행별 기록과 로그는 `tmp/recipe-runs/`의 독립 디렉터리에 생성됩니다. 장기 보존할 결과는 등록된 시각화나 Reference I/O 등으로 보관하고 해당 기록의 경로·실행 ID를 활동/시도에 연결하세요. 성공적인 프로세스 종료와 출력 존재는 알고리즘의 정확성을 인증하지 않습니다. 실행 도구가 임의로 JOB 완료·후보 채택·태그 생성 등을 수행하지 않습니다.

`graph-check`의 구조/경로 검사와 에이전트의 의미 검토는 구분됩니다. 자연어 I/O 계약이 실제 알고리즘과 일치한다고 자동 증명하지 않으며 누락된 설명은 검토 제안입니다. `--changed` 경로는 소스 루트 기준이며 자동 수정하지 않습니다.

보고서 도구는 제공된 이미지와 측정값을 표현합니다. 차이 영상·측정값은 프로젝트 실행 코드에서 준비하고, 축 범위·단위·비교 조건을 지정하세요. 임의 디모자익·정규화·리샘플링이나 자동 품질 판정을 하지 않습니다. 생성 이후 `isp artifact ... --revision N`과 `isp present --artifact ID`로 등록·표시합니다. 자유로운 HTML 작성도 계속 지원합니다.

상세 스키마와 선택 기준은 로컬 스킬의 `execution-recipes.md`, `report-building.md`, `validation-method.md`, `change-impact.md`를 필요한 작업에서만 읽습니다. 검증은 변경한 보장 조건에 맞는 최소 사례를 선택하며 모든 블록에 CFA·시간축·포화 테스트를 일괄 강제하지 않습니다.
