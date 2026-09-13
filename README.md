# ISP Block Maker

로컬 CLI 에이전트와 함께 ISP 블록을 설계·구현·시각화하는 웹 작업 공간입니다. MCP 없이 HTTP API와 WebSocket으로 동작합니다.

프레임워크 저장소입니다. 예제 구현, 개인 `workspace/graph.json`, 요청·JOB·시각화 결과는 포함하지 않습니다. 새 clone은 빈 Input 블록으로 시작합니다. 상단 프로젝트 이름에서 별도 작업 폴더를 선택하세요. 기본 `workspace/`의 사용자 파일은 프레임워크 Git에서 제외되므로 구현 버전 관리는 별도 Git 작업 폴더에서 진행하세요.

## 실행

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
4. 에이전트에 `작업 전에 ISP bridge로 context를 읽고 선택 블록을 구현해줘`라고 요청합니다. `workspace/AGENTS.md`와 `CLAUDE.md`가 명령을 안내합니다.
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

외부 터미널에서는 저장소 루트에서 `npm run isp -- context`를 사용합니다. 에이전트의 별도 셸에서 `isp`를 찾지 못하면 `workspace/` 기준 `node ../scripts/isp.mjs context`를 사용합니다. 웹 터미널에는 `ISP_API_URL`, `ISP_API_TOKEN`, `ISP_BLOCK_ID`, `ISP_CLI` 환경변수가 전달됩니다. 외부 CLI의 서버 연결 정보는 Git에서 제외된 `.isp/connection.json`에서 읽습니다.

`update` 파일은 변경할 블록 필드만 포함하는 JSON입니다. `artifact`는 HTML/PNG/JPEG/WebP를 최대 10MB까지 지원합니다. 생성 시점의 revision을 명시해야 하며 현재 UI가 다른 revision이면 이전 결과로 표시됩니다. HTML은 inline JS/CSS와 data URL 이미지를 사용하세요. 외부 CDN, fetch, 부모 DOM 접근은 허용되지 않습니다.

## 프로젝트 로컬 스킬

간선 강조는 `isp present --edges EDGE_ID,EDGE_ID`를 사용합니다. 해당 간선과 양끝 노드를 함께 강조하고 화면에 맞춥니다. `--blocks`와 함께 쓸 수 있으며 삭제된 간선은 대신 남은 양끝 노드를 표시합니다.

작업 완료 후 `isp present --blocks ID,ID`로 변경 블록을 강조하고 화면에 맞추거나, `isp present --artifact ARTIFACT_ID`로 등록된 시각화를 바로 표시할 수 있습니다. `--message`는 완료 알림을 지정하며 `--graph`는 전체 그래프를 표시합니다. 현재 연결된 탭에만 전달하고 그래프 revision은 변경하지 않습니다. 미저장 편집이 있으면 사이드바의 ‘결과 보기’로 적용을 보류합니다. 터미널 세션과 표시 상태는 유지합니다. 스킬에는 작업 종류별 최종 화면 선택과 중간 단계의 불필요한 전환을 피하는 지침이 포함되어 있습니다.

`workspace/.agents/skills/isp-block-maker/SKILL.md`가 공통 스킬이며, Claude Code는 `workspace/.claude/skills/isp-block-maker/SKILL.md`에서 같은 문서를 참조합니다. 전역 스킬 폴더와 사용자 설정은 변경하지 않습니다. workspace 및 그 아래에서 시작한 에이전트가 사용할 수 있고, `workspace/AGENTS.md`와 `CLAUDE.md`에도 적용 경로가 연결되어 있습니다. 중첩된 별도 Git 저장소는 에이전트의 탐색 경계가 될 수 있으므로 그 경우 workspace에서 에이전트를 시작하거나 공통 스킬 경로를 명시하세요.

Codex에서는 `$isp-block-maker`, Claude Code에서는 `/isp-block-maker`로 호출합니다. 이미 실행 중인 에이전트에서 목록에 보이지 않으면 다시 시작하거나 스킬 파일을 직접 읽도록 요청하세요. 스킬 발견 방식은 [Codex 공식 문서](https://developers.openai.com/codex/skills)와 [Claude Code 공식 문서](https://code.claude.com/docs/en/skills)를 참고하세요.

하위 디렉터리에서 사용할 때는 `node "<workspace 절대경로>/isp.mjs" ...`를 실행합니다. 이 진입점은 실제 현재 경로가 workspace 밖이면 거부합니다. 네트워크 요청은 숫자 loopback HTTP 주소만 허용하며 리다이렉트를 따라가지 않습니다. 이것은 프로젝트 로컬 적용과 CLI 범위 검사이며 에이전트의 전체 셸 권한을 격리하는 기능은 아닙니다.

`add-block` JSON은 최소한 `id`, `name`이 필요합니다. 생략한 설명은 빈 문자열, status는 draft, 포트는 빈 배열, 위치는 (300,300)입니다. `delete-block`은 연결이 있으면 실패하며 `--with-edges`로 노드와 연결을 함께 제거할 수 있습니다. 소스 파일과 과거 결과물은 보존합니다. 모든 그래프 변경에는 조회한 `--revision`이 필요하고, 성공 응답의 새 revision을 다음 명령에 사용합니다.

## 통신 경로

상단 프로젝트 이름을 클릭하면 **작업 폴더 선택** 창이 열립니다. 경로 입력 후 찾아보기 또는 하위 폴더 탐색으로 이동한 뒤 “이 폴더에서 작업”을 누르세요. 전환은 서버 전체에 적용되며 연결된 터미널은 종료됩니다. 새 터미널은 선택한 폴더에서 시작합니다. 다른 탭은 작성 내용을 보관한 뒤 새로고침해야 합니다.

외부 작업 폴더는 `graph.json`과 `.isp/`에 각각 그래프와 로컬 기록을 저장합니다. 처음 여는 폴더에는 빈 Input 블록, 프로젝트 스킬, CLI(`.isp/tools/isp.mjs`), AGENTS/CLAUDE 안내와 Git 제외 규칙을 준비합니다. 기존 지침은 보존하며 기존 스킬은 덮어쓰지 않습니다. Git 저장소를 자동 생성하거나 커밋하지는 않습니다. 기본 workspace는 기존 `.isp` 저장 위치를 유지합니다. 마지막 선택 경로는 서버 재시작 후에도 사용합니다. 폴더를 옮겼거나 삭제해 서버를 시작할 수 없다면 앱의 `.isp/active-workspace.json`을 수정하거나 제거하여 기본 경로로 돌아올 수 있습니다.

```text
Browser ── HTTP ──────────── Local Node server ── workspace/graph.json (Git)
        └─ WebSocket ───────┤
                           ├─ PTY ── cmd / Claude Code / Codex
                           ├─ .isp/project.json (local requests / JOBs / results)
                           └─ Artifact store

CLI agent ── isp.mjs ── HTTP API ── Local Node server
```

HTTP와 WebSocket도 TCP 위에서 동작합니다. Raw TCP를 직접 구현하면 메시지 경계·요청 ID·오류·재연결 처리를 별도로 만들어야 하며 브라우저에서 직접 raw TCP를 사용할 수도 없습니다. 실행 중인 에이전트에 TCP 패킷을 보내는 것만으로 새 도구 호출이나 사용자 요청이 되지는 않습니다. 이번 구현은 에이전트가 context를 명시적으로 조회하는 pull 방식입니다. WebSocket push는 웹 화면 갱신과 터미널 입출력에 사용합니다. 필요하면 같은 서비스 위에 MCP 어댑터를 추가할 수 있습니다.

주요 API는 `Authorization: Bearer <token>`을 사용합니다.

| Method | Path                    | 역할                            |
| ------ | ----------------------- | ------------------------------- |
| GET    | /api/project            | 전체 프로젝트                   |
| PUT    | /api/project            | revision을 확인하여 그래프 저장 |
| GET    | /api/context?blockId=ID | 블록·상하류·결과물 정보         |
| POST   | /api/selection          | UI 선택 블록 설정               |
| PATCH  | /api/blocks/ID          | `{revision, patch}`로 블록 수정 |
| POST   | /api/artifacts          | base64 결과물 등록              |
| GET    | /api/mermaid            | Mermaid 내보내기                |
| POST   | /api/demo               | 고정된 합성 영상 예제 실행      |

## 구현 버전 선택

상단 버전 버튼에 현재 브랜치와 짧은 커밋 해시를 표시합니다. `*`는 미커밋 변경이 있다는 뜻입니다. 버튼을 열면 로컬 브랜치, 최근 50개 커밋 또는 직접 입력한 해시/태그를 선택할 수 있습니다. 커밋 제목·본문과 현재 버전 대비 변경 파일, 추가·수정·삭제된 블록을 확인한 뒤 적용하세요. 특정 커밋/태그 선택은 detached HEAD로 열립니다.

적용하면 연결된 터미널을 종료하고 Git으로 그래프와 구현을 함께 전환한 뒤 화면을 다시 엽니다. 로컬 요청·JOB·시각화는 유지합니다. 미저장 편집이나 저장소의 미커밋 변경이 있으면 전환을 차단하며 자동 stash/폐기는 하지 않습니다. 작업 폴더 밖의 앱 파일까지 달라지는 버전, 그래프 명세가 없는 버전, 로컬 기록을 Git에 포함한 버전도 UI에서 적용할 수 없습니다. 저장소가 없거나 첫 커밋 전이면 안내만 표시하며 자동으로 초기 커밋을 만들지 않습니다.

## 파일과 검증

- `src/`: React Flow 그래프, 명세 편집기, xterm.js 터미널, 결과물 뷰어.
- `server/`: HTTP/WebSocket/PTY 및 revision 검증·파일 저장.
- `scripts/isp.mjs`: 에이전트가 호출하는 HTTP CLI.
- `workspace/`: IP 구현 코드와 에이전트 지침.
- `workspace/graph.json`: Git으로 구현 코드와 함께 관리할 그래프 원본. 블록 ID·설명·계약·포트·파라미터·위치·구현 경로·상태와 간선을 저장합니다. Mermaid는 여기서 생성합니다.
- `.isp/project.json`: 로컬 요청·JOB·시각화 목록·선택 노드·동시 편집 revision. Git에서 제외됩니다. 결과물 사본과 연결 정보도 `.isp/`에 유지합니다.

기존 통합 데이터는 최초 실행 시 자동 분리하며 `.isp/project.legacy.json`에 원본을 보관합니다. API는 두 저장소를 합친 기존 프로젝트 형식을 유지합니다. 요청 작성, JOB 처리, 시각화 등록, 노드 선택만으로 그래프 파일은 변경되지 않습니다.

Git으로 `workspace/graph.json`과 구현 코드를 함께 복원한 뒤 브라우저를 새로고침하세요. 서버는 다음 조회/저장 시 명세를 다시 읽고 revision을 갱신하여 오래된 저장을 거부합니다. 그래프에서 사라진 노드의 로컬 기록은 ID별로 보관하고 해당 ID가 돌아오면 다시 연결합니다. ID를 다른 의미의 노드에 재사용하지 마세요. 명세 파일이 없거나 잘못된 JSON이면 자동 덮어쓰기 없이 오류를 반환합니다. 이전 결과물은 유지하며 Git 커밋별 결과 추적은 별도로 제공하지 않습니다.

```sh
npm test
npm run build
```

테스트는 그래프 타입/순환 검증, 저장 충돌·재로딩, 참조 모델 불변성, API 접근 검사, HTML 격리 헤더, 실제 WebSocket → PTY → HTTP context 조회를 확인합니다.

현재 범위는 단일 프로젝트, 평면 블록 그래프, 탭당 한 개의 활성 터미널입니다. 설명은 블록 JSON에 저장하며 구현 코드는 파일 경로로 참조합니다. 배치 변경도 revision을 증가시킵니다. 결과물은 블록 ID·revision·생성 시간과 선택적 실행 ID/metadata를 기록합니다. 예제는 입력 규격·난수 seed·파라미터·RMSE·코드 해시를 포함합니다.

터미널 연결이 끊기면 60초간 유지하며 같은 화면에서 네트워크 재연결 시 복원합니다. 페이지를 새로고침하면 새 cmd 터미널이 자동으로 시작됩니다. 하위 그래프, 블록 정의 재사용, 임의 그래프 자동 실행, RAW 뷰어, RTL 도구 연동은 아직 구현하지 않았습니다. 생성 HTML의 격리는 로컬 CLI 자체를 sandbox하는 기능은 아닙니다.
