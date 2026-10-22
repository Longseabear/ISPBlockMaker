# Central Agent API

이 문서는 현재 개발 버전의 구현 기준이다. 기존 릴리스에 이 기능이 포함되었다는 의미는 아니며, 중앙 Agent API를 포함한 서버와 Windows 서버 관리 실행 파일이 필요하다.

```text
메신저 ↔ 브릿지 앱 ↔ 중앙 ISP 서버 ↔ 워크스페이스 서버 ↔ 세션
```

## 설정

1. Windows **서버 관리 → 고급 옵션**을 연다.
2. 허용 워크스페이스를 체크하고 **API 켜기 / 토큰 발급**을 누른다.
3. 표시된 주소와 한 번만 제공되는 토큰을 브릿지의 비밀 설정에 보관한다.
4. 요청마다 `Authorization: Bearer <token>`을 보낸다.

기본은 꺼짐이며 localhost 전용이다. 중앙 토큰 하나로 선택한 워크스페이스에 접근한다. UI 및 LAN MCP 공유 토큰과 별개다. 해시와 허용 범위는 중앙 상태 폴더의 `agent-api.json`에 저장한다. 워크스페이스는 서버 관리에서 폴더를 열어 등록한다.

**접근 범위 저장**, **토큰 재발급**, **API 끄기**로 관리한다. 변경 시 이벤트 연결도 종료한다. 이미 접수한 작업은 계속되므로 해당 run을 별도로 취소한다. API가 켜져 있으면 관리 창을 닫아도 Hub를 유지한다. PC 재부팅 후에는 서버 관리를 다시 실행한다.

## 대상 선택

주소 예시: `http://127.0.0.1:4309/api/agent/v1`. 실제 주소는 고급 옵션에서 복사한다.

1. `GET /workspaces`에서 허용된 id/name/status를 읽는다.
2. `GET /workspaces/{workspace_id}/sessions`에서 세션을 고른다.
3. 필요하면 같은 경로에 POST하여 세션을 만든다.
4. `POST /workspaces/{workspace_id}/sessions/{session_id}/messages`로 요청한다.
5. 반환된 run_id로 `GET /workspaces/{workspace_id}/runs/{run_id}`를 조회한다.

브릿지는 메신저 대화마다 `(workspace_id, session_id)`를 보관한다. workspace ID는 중앙 등록부의 UUID이며 재시작해도 유지된다. 폴더 재등록 후에는 목록을 다시 확인한다. UI 선택은 API 대상에 영향을 주지 않는다. `/workspaces/current`는 409, 다른 워크스페이스의 세션은 404이며 자동 생성하지 않는다.

꺼진 작업 서버는 자동 시작하지 않는다(503). 서버 관리에서 먼저 시작한다. 구버전 서버는 409와 재시작 안내를 반환한다. 내부 포트/자격 증명은 브릿지에 노출하지 않는다.

`GET /sessions`, `GET /runs`는 허용된 워크스페이스별 목록을 모은다. 꺼진 서버는 해당 그룹에 unavailable을 표시한다. 전체 runs 조회는 워크스페이스당 최근 50개다. `GET /openapi.json`은 OpenAPI 3.1 계약이다.

## 생성 및 요청

세션 생성/메시지 요청에는 `Idempotency-Key` 헤더가 필수다(공백 없는 ASCII 1–200자). 같은 키/내용은 기존 결과를 반환하며 다른 내용이면 409다. 재시도 시 동일 키를 사용한다. 토큰 재발급 후에도 중복 방지는 유지된다.

세션 생성:

```json
{"title":"메신저 검증","provider":"claude","diagram_id":"main","block_id":"denoise"}
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
session = api(prefix + "/sessions", {"title": "Messenger"}, "conversation-001")
sid = session["session"]["id"]
run = api(prefix + "/sessions/" + sid + "/messages",
          {"text": "주요 블록을 요약해줘."}, "message-001")
print(api(prefix + "/runs/" + run["run_id"]))
```

후속 메시지는 session ID를 재사용한다. 메신저 및 직접 접속하는 모바일 앱은 포함하지 않는다. 외부 네트워크 연결은 브릿지가 담당하며 ISP 서버를 자동 공개하지 않는다.

## 기존 API에서 이동

- 작업 서버의 `/api/agent/v1`, `/api/personal-agent`는 410으로 중앙 이동을 안내한다.
- 이전 토큰 파일은 보존하지만 인증에 사용하지 않는다. 중앙에서 새 토큰과 허용 범위를 설정한다.
- `.isp/interaction.json`의 세션/실행 기록은 유지한다. 브릿지 주소와 workspace ID를 중앙 기준으로 변경한다. session/run ID는 유지한다.
- `/api/internal/agent/v1`은 중앙과 작업 서버 사이 전용이다.

[OpenCode 공식 Server 문서](https://docs.opencode.ai/docs/server/)의 서버/클라이언트 분리, 비동기 요청, SSE, OpenAPI를 참고했다. 중앙 라우팅과 중복 요청 방지를 추가했으며 OpenCode를 내장하거나 API 호환을 제공하지는 않는다.
