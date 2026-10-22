# Central Agent API

이 기능은 v0.1.27부터 제공한다. 업데이트 후 중앙 서버와 워크스페이스 서버, Windows 서버 관리 실행 파일을 다시 시작해야 한다.

```text
에이전트 프로그램 ↔ 중앙 ISP 서버 ↔ 워크스페이스 서버 ↔ 세션
```

## 연결 프로그램 개발자에게 전달할 것

이 문서와 실행 중인 서버의 `GET /openapi.json`을 함께 전달한다. OpenAPI는 경로와 요청 스키마 확인용이며, 재시도·복구·결과 전달 규칙은 이 문서를 따른다.

- 공개 가이드: https://github.com/Longseabear/ISPBlockMaker/blob/main/docs/personal-agent-api.md
- API 주소: 관리 창 → 에이전트 프로그램 연결 탭에서 복사한 주소. 예: `http://127.0.0.1:4309/api/agent/v1`
- 인증: 발급 토큰은 연결 프로그램 PC의 환경 변수 또는 비밀 저장소에 설정한다. Git, 채팅 프롬프트, 로그에 토큰을 넣지 않는다.
- 클라이언트 종류와 연결 방식, 허용 사용자/접근 범위, 기본 워크스페이스 선택 정책을 지정한다. 클라이언트 인증 정보도 별도로 설정한다.
- 연결 프로그램은 ISP 서버와 같은 PC에서 실행한다. 원격 개발 에이전트는 이 PC의 localhost에 직접 접근할 수 없으므로 문서로 구현하고 실제 연결 검증은 해당 PC에서 수행한다.

## 중앙 서버 시작

`isp-block-maker`를 실행하면 관리 창과 중앙 서버가 함께 열립니다. 첫 화면의 **중앙 서버**에서 실행 상태와 주소를 확인합니다. 현재 폴더를 초기화하거나 워크스페이스 서버를 자동 시작하지 않습니다.

관리 창 없이 중앙 서버만 실행하려면 `isp-block-maker serve --hub`를 사용합니다. 이미 실행 중이면 주소를 출력합니다. 새로 시작한 서버는 Ctrl+C로 종료합니다.

중앙 서버 실행만으로 프로그램 접근이 허용되지는 않습니다. **에이전트 프로그램 연결** 탭에서 허용 범위와 토큰을 설정합니다. 작업할 워크스페이스 서버는 **워크스페이스** 탭에서 별도로 시작합니다.

## 설정

1. Windows **서버 관리 → 에이전트 프로그램 연결**을 연다.
2. 허용 워크스페이스를 체크하고 **API 켜기 / 토큰 발급**을 누른다.
3. 표시된 주소와 한 번만 제공되는 토큰을 연결 프로그램의 비밀 설정에 보관한다.
4. 요청마다 `Authorization: Bearer <token>`을 보낸다.

기본은 꺼짐이며 localhost 전용이다. 중앙 토큰 하나로 선택한 워크스페이스에 접근한다. UI 및 LAN MCP 공유 토큰과 별개다. 해시와 허용 범위는 중앙 상태 폴더의 `agent-api.json`에 저장한다. 워크스페이스는 서버 관리에서 등록하거나, 아래의 워크스페이스 관리 권한을 허용한 뒤 API로 등록한다.

**접근 범위 저장**, **토큰 재발급**, **API 끄기**로 관리한다. 변경 시 이벤트 연결도 종료한다. 이미 접수한 작업은 계속되므로 해당 run을 별도로 취소한다. API가 켜져 있으면 관리 창을 닫아도 Hub를 유지한다. v0.1.28 이상은 API 설정과 관계없이 창 닫기가 서버를 유지하며, **전체 서버 종료**로 중앙/작업 서버를 종료한다. 종료해도 API 설정은 보존된다. PC 재부팅 후에는 서버 관리를 다시 실행한다.

## 대상 선택

주소 예시: `http://127.0.0.1:4309/api/agent/v1`. 실제 주소는 에이전트 프로그램 연결 탭에서 복사한다.

1. `GET /workspaces`에서 허용된 id/name/status를 읽는다.
2. `GET /workspaces/{workspace_id}/sessions`에서 세션을 고른다.
3. 필요하면 같은 경로에 POST하여 세션을 만든다.
4. `POST /workspaces/{workspace_id}/sessions/{session_id}/messages`로 요청한다.
5. 반환된 run_id로 `GET /workspaces/{workspace_id}/runs/{run_id}`를 조회한다.

연결 프로그램은 클라이언트 대화마다 `(workspace_id, session_id)`를 보관한다. workspace ID는 중앙 등록부의 UUID이며 재시작해도 유지된다. 폴더 재등록 후에는 목록을 다시 확인한다. UI 선택은 API 대상에 영향을 주지 않는다. `/workspaces/current`는 409, 다른 워크스페이스의 세션은 404이며 자동 생성하지 않는다.

세션 요청은 꺼진 작업 서버를 자동 시작하지 않는다(503). 먼저 `POST /workspaces/{workspace_id}/start`에 `{}`를 보내 시작하거나 관리 창에서 시작한다. 구버전 서버는 409와 재시작 안내를 반환한다. 내부 포트/자격 증명은 연결 프로그램에 노출하지 않는다.

`GET /sessions`, `GET /runs`는 허용된 워크스페이스별 목록을 모은다. 꺼진 서버는 해당 그룹에 unavailable을 표시한다. 전체 runs 조회는 워크스페이스당 최근 50개다. `GET /openapi.json`은 OpenAPI 3.1 계약이다.

## 워크스페이스 조회·등록·시작

- `GET /workspaces`: 접근 가능한 등록 워크스페이스의 ID·이름·실행 상태 조회.
- `POST /workspaces`: `{"path":"C:\\Projects\\demo"}`로 기존 절대 경로 폴더 등록. `{workspace:{id,name,path}}` 반환. 같은 실제 경로를 반복 등록하면 같은 ID를 반환하며 파일을 초기화·이동하거나 서버를 시작하지 않는다.
- `POST /workspaces/{workspace_id}/start`: 본문 `{}`. 허용된 초기화 완료 워크스페이스 서버를 시작하거나 기존 서버를 재사용한다. `{workspace:{id,name,status}}` 반환. 브라우저를 열거나 화면 선택을 바꾸지 않는다. 준비되지 않은 폴더는 409와 명시적 초기화 안내를 반환한다.

**에이전트 프로그램 연결 → 모든 워크스페이스 조회·등록·시작 및 작업 허용**을 켜고 설정을 저장하면 등록 기능과 모든 등록 워크스페이스 접근을 허용한다. 기본은 꺼짐이며 기존 토큰 설정은 자동 확대하지 않는다. 이 옵션이 꺼져 있으면 선택한 워크스페이스만 조회·시작·작업할 수 있고 등록은 403이다. 옵션을 켜면 워크스페이스를 아직 선택하지 않아도 연결을 허용할 수 있다.

등록·시작은 경로/ID 기준으로 재호출 가능하므로 Idempotency-Key가 필요 없다. 세션 생성·메시지 전송은 기존대로 키가 필수다. 등록 후 받은 ID로 시작 → 세션 생성 → 메시지 전송 순서로 호출한다. 시작 응답을 잃으면 목록을 조회하고 같은 ID로 재시도한다.

## 생성 및 요청

세션 생성/메시지 요청에는 `Idempotency-Key` 헤더가 필수다(공백 없는 ASCII 1–200자). 같은 키/내용은 기존 결과를 반환하며 다른 내용이면 409다. 재시도 시 동일 키를 사용한다. 토큰 재발급 후에도 중복 방지는 유지된다.

세션 생성:

```json
{"title":"클라이언트 검증","provider":"claude","diagram_id":"main","block_id":"denoise"}
```

provider는 claude(기본) 또는 codex. diagram_id/block_id는 선택이며 실제 ID를 사용한다. 모델/권한은 워크스페이스 설정을 따른다. 생성만으로 작업을 실행하지 않는다.

메시지 요청:

```json
{"text":"이 블록을 검증해줘.","delivery":"queue","external_ref":"message-123"}
```

HTTP 202의 session_id/run_id/status는 접수 결과다. steer는 지원하지 않는다. 수정하려면 run을 취소하고 새 키로 요청한다. 기존 Interaction 충돌 방지 정책에 따라 같은 블록 또는 대상이 불명확한 작업은 순차 처리될 수 있다. 삭제한 세션 생성 키를 재사용하면 410이다.

## 조회 및 제어

아래 경로는 `/workspaces/{workspace_id}` 아래다.

| 메서드와 경로 | 기능 |
| --- | --- |
| GET /runs?limit=50&offset=0 | 최신순 실행, total, event_cursor |
| GET /runs/{run_id} | 상태, output, error, 현재 질문 |
| POST /runs/{run_id}/cancel | 대기 제거 또는 중단 요청. 본문 `{}` |
| POST /runs/{run_id}/answers | 해당 run 질문에 응답 |
| GET /artifacts | 워크스페이스 등록 결과물 |
| GET /artifacts/{artifact_id} | 결과물 다운로드 |
| GET /events?after=0 | SSE 상태 이벤트 |

상태: queued, dispatching, running, waiting_input, completed, failed, cancelled, interrupted. output은 요청별 에이전트 텍스트 최대 100,000자다. 대화를 삭제해도 API 실행 결과는 남는다. 결과물은 워크스페이스 전체이며 특정 run의 소유라고 추정하지 않는다.

질문 응답 예: `{"request_id":"질문 ID","decision":"accept"}`. 선택형 질문은 `{"request_id":900,"answers":{"format":["PNG"]}}`. 만료되거나 다른 run의 질문에는 응답할 수 없다.

## 이벤트와 복구

- SSE는 Authorization 헤더를 지원하는 클라이언트를 사용한다. after 또는 Last-Event-ID로 재연결한다.
- 이벤트는 run.queued/run.running/run.completed 등이며 id/run_id/session_id/status/phase/time을 포함한다. 텍스트 토큰 스트림은 아니다. 완료 후 run API에서 답변을 읽는다.
- 최근 1,000개 이벤트를 보관한다. 잘못되거나 오래된 커서는 409다. runs를 재조회해 event_cursor부터 연결한다. 커서는 워크스페이스별로 저장하고 중복 ID를 제거한다.
- 중앙 접근 설정 변경 시 스트림을 종료한다. 작업 서버 교체는 최대 약 5초 간격으로 확인한다.
- Hub만 재시작하면 작업 서버 실행은 계속된다. 재연결해 상태를 조회한다.
- 작업 서버 재시작 시 진행/대기 API 요청은 interrupted로 복구하고 자동 재실행하지 않는다. 파일을 확인한 후 새 키로 요청한다.
- 네트워크 오류 뒤 새 키로 무조건 재전송하지 않는다. 상태 조회 또는 같은 키로 재시도한다.

## Python 예제

아래 코드는 실제 요청을 만든다. workspace ID는 `/workspaces`에서 고른 값이다.

```python
import json, os, urllib.request
BASE = os.environ["ISP_AGENT_URL"]
TOKEN = os.environ["ISP_AGENT_TOKEN"]
WORKSPACE = os.environ["ISP_WORKSPACE_ID"]

def api(route, body=None, key=None):
    headers = {"Authorization": "Bearer " + TOKEN}
    if key:
        headers["Idempotency-Key"] = key
    data = None if body is None else json.dumps(body).encode("utf-8")
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + route, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

prefix = "/workspaces/" + WORKSPACE
session = api(prefix + "/sessions", {"title": "API client"}, "conversation-001")
sid = session["session"]["id"]
run = api(prefix + "/sessions/" + sid + "/messages",
          {"text": "주요 블록을 요약해줘."}, "message-001")
print(api(prefix + "/runs/" + run["run_id"]))
```

후속 메시지는 session ID를 재사용한다. 클라이언트 및 직접 접속하는 모바일 앱은 포함하지 않는다. 외부 네트워크 연결은 연결 프로그램가 담당하며 ISP 서버를 자동 공개하지 않는다.

## 지원 범위와 클라이언트 명령 예시

아래는 연결 프로그램가 구현할 명령 예시다. ISP 서버가 클라이언트 명령을 직접 해석하는 것은 아니다.

| 클라이언트 명령 예시 | 연결 프로그램 동작 |
| --- | --- |
| 워크스페이스 목록 | GET /workspaces → 이름·실행 상태·선택 버튼 |
| 디노이징 선택 | 목록에서 확인한 workspace_id 저장; 이름이 중복되면 사용자에게 선택 요청 |
| 대화 목록 | 선택 워크스페이스의 GET /sessions |
| 새 대화, Claude로 | POST /sessions → session.id 저장; provider=claude |
| 기존 대화 선택 | 목록의 session ID로 연결; 웹에서 열어둔 Interaction 대화도 가능 |
| 일반 메시지 | 선택 세션의 POST /messages → run_id 저장, 접수 알림 |
| 진행 상황 | GET /runs/{run_id}; 작업별 상태와 질문 표시 |
| 취소 | 선택한 run에 POST /cancel; 실제 최종 상태는 다시 확인 |
| 질문에 답하기 | run의 현재 질문 ID와 선택값으로 POST /answers |
| 결과 보기 | 완료 run의 output/error 조회; 필요 시 등록 artifacts 조회 |

이 API의 세션은 Interaction 채팅이다. 셸 터미널 세션에 명령을 주입하는 API가 아니다. 여러 세션에 요청할 수 있지만 동일 블록 등 충돌하는 작업은 순차 처리될 수 있다. 실행 중 후속 메시지는 queue이며 즉시 steer가 아니다.

공개 API는 기존 폴더 등록과 서버 시작을 지원한다. 새 폴더 생성·초기화·마이그레이션 및 세션 이름 변경/삭제는 제공하지 않는다. 결과물 목록은 워크스페이스 전체이므로 모든 파일을 현재 작업의 결과로 자동 전송하지 않는다.

현재 제한: 워크스페이스의 채팅은 최대 50개, 세션 대기열은 최대 100개다. API 세션 생성 키와 API 실행 기록도 각각 10,000개 상한이 있으므로 무한히 새 세션을 생성하지 않는다. 상한 도달의 409는 사용자에게 알리고, 기록을 임의 삭제하거나 새 키로 반복 재시도하지 않는다. 메시지는 최대 30,000자다.

## 연결 프로그램 구현 순서

1. **연결 확인:** 환경 변수 `ISP_AGENT_URL`, `ISP_AGENT_TOKEN`을 읽고 인증 헤더로 /workspaces와 /openapi.json을 조회한다. 요청 사용자와 접근 범위의 허용 여부를 확인한 뒤 요청을 받는다.
2. **대상 연결:** 클라이언트의 사용자·작업 단위 키에 `(workspace_id, session_id)`를 영속 저장한다. 사용자 간 연결을 섞지 않는다. 새 대화 요청 때만 세션을 만들고 기존 메시지는 같은 session ID를 재사용한다. 웹에서 선택한 탭에 의존하지 않는다.
3. **중복 방지:** 전송 전에 클라이언트 message ID, 대상 IDs, 요청 본문, Idempotency-Key를 저장한다. ASCII 키를 세션 생성/메시지 요청별로 구분하고 재시도 시 원래 본문과 키를 유지한다. 이름만으로 대상을 추측하거나 네트워크 실패 때 새 세션을 만들지 않는다.
4. **비동기 실행:** 202 응답은 완료가 아닌 접수다. run_id를 저장하고 접수 사실을 알린다. SSE로 상태를 받거나 간격을 둔 조회를 사용한다. 텍스트 토큰 스트리밍이라고 표시하지 않는다.
5. **완료 전달:** completed/failed/cancelled/interrupted를 구분하고 run API에서 최종 output/error를 읽어 전달한다. 클라이언트 글자 수 제한에 맞춰 분할한다. `(workspace_id, run_id)`별 전달 상태를 보관하고 재연결 때 중복 통지를 줄인다. 클라이언트가 멱등 전송을 제공하지 않으면 전송 직후 장애 시 중복 가능성이 있으므로 정확히 한 번 전달을 보장한다고 주장하지 않는다.
6. **질문 처리:** waiting_input은 해당 run의 질문에만 답하도록 표시한다. 자동으로 권한 승인을 대신하지 말고 허용된 사용자의 답변을 전달한다.
7. **재시작 복구:** 연결 프로그램가 재시작하면 저장한 진행 중 run을 재조회한다. SSE 커서는 워크스페이스별로 관리한다. 오래된 커서의 409는 runs 조회로 복구하고, 다른 409는 본문을 확인한다. interrupted 작업은 사용자 확인 없이 재실행하지 않는다.
8. **에러 안내:** 401/403은 인증·접근 허용 확인, 404는 대상 재선택, 410은 삭제된 세션 등 기존 요청 상태 확인, 503은 워크스페이스 서버 시작 안내로 처리한다. 오류를 숨기고 다른 워크스페이스나 세션으로 보내지 않는다.

연결 프로그램의 최소 저장 항목은 대화 연결, 발신 메시지/멱등 키/요청 본문, run_id/상태, 완료 알림 전송 상태, 워크스페이스별 이벤트 커서다. SQLite 등 재시작 후 복구 가능한 저장소를 사용한다. 토큰은 이 기록과 분리한다.

## 개발 에이전트에게 복사할 요청

```text
아래 가이드와 실제 서버의 OpenAPI를 기준으로 ISP Block Maker 에이전트 프로그램 연결을 구현해줘.
가이드: https://github.com/Longseabear/ISPBlockMaker/blob/main/docs/personal-agent-api.md
클라이언트: [연결할 프로그램 지정]
허용 사용자·접근 범위: [지정]
연결 프로그램은 ISP 서버와 같은 Windows PC에서 실행한다.
ISP_AGENT_URL과 ISP_AGENT_TOKEN은 환경 변수로 받고 비밀값을 코드나 로그에 넣지 마.

워크스페이스 목록/선택, 기존 대화 선택, 새 Claude 또는 Codex 대화 생성,
메시지 요청, 진행 상태, 취소, 에이전트 질문 응답, 완료 결과 전달을 구현해줘.
대화별 workspace_id/session_id 연결과 멱등 키, 실행 및 전달 상태를 영속 저장해.
재시도 시 같은 요청의 키를 유지하고, 연결 프로그램 재시작 후 진행 중 run을 복구해.
SSE는 상태 이벤트이며 완료 텍스트는 run API로 가져와.
세션 삭제·즉시 steer를 지원한다고 표시하지 마.
클라이언트 명령을 셸 명령으로 직접 실행하지 마.
가이드의 검증 목록을 실행하고, 실제 연결하지 못한 항목은 미검증으로 보고해줘.
설치/설정/시작/종료 방법과 Windows 재시작 후 운영 방법도 문서화해줘.
```

## 연결 프로그램 완료 검증 목록

- 허용 워크스페이스만 표시하고, 꺼진 서버는 시작 안내를 한다.
- 새 세션 생성만으로 작업이 시작되지 않으며, 메시지 전송 후 반환된 run을 추적한다.
- 기존 웹 Interaction 세션으로 후속 요청을 보내 대화가 이어지는지 확인한다.
- 서로 다른 클라이언트 대화의 workspace/session 연결이 섞이지 않는다.
- 같은 메시지를 중복 수신하거나 HTTP 응답을 잃어도 같은 키로 조회/재시도하여 작업이 중복 생성되지 않는다.
- 두 세션의 요청과 결과를 run ID로 구분한다. 충돌 작업의 대기를 실패로 오인하지 않는다.
- 에이전트 질문, 취소, 실패, 서버 재시작의 interrupted 상태를 각각 구분한다.
- 연결 프로그램 재시작 및 SSE 재연결 후 결과를 복구하고 완료 알림 전달 상태를 확인한다.
- 등록 결과물이 다른 run의 파일일 수 있음을 UI에 반영하고, 무관한 파일을 자동 유출하지 않는다.
- 허용되지 않은 발신자는 실행할 수 없고 토큰이 로그/저장소/Git에 노출되지 않는다.

## 기존 API에서 이동

- 작업 서버의 `/api/agent/v1`, `/api/personal-agent`는 410으로 중앙 이동을 안내한다.
- 이전 토큰 파일은 보존하지만 인증에 사용하지 않는다. 중앙에서 새 토큰과 허용 범위를 설정한다.
- `.isp/interaction.json`의 세션/실행 기록은 유지한다. 연결 프로그램 주소와 workspace ID를 중앙 기준으로 변경한다. session/run ID는 유지한다.
- `/api/internal/agent/v1`은 중앙과 작업 서버 사이 전용이다.

[OpenCode 공식 Server 문서](https://docs.opencode.ai/docs/server/)의 서버/클라이언트 분리, 비동기 요청, SSE, OpenAPI를 참고했다. 중앙 라우팅과 중복 요청 방지를 추가했으며 OpenCode를 내장하거나 API 호환을 제공하지는 않는다.
