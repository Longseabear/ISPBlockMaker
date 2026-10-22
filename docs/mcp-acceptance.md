# MCP 전환 및 검색 — 구현 검증 기록

검증일: 2026-10-22. 커밋/배포 전 작업 트리 기준. 배포나 기존 실행 서버의 재시작을 의미하지 않는다.

## 요구사항과 근거

| 요구사항 | 구현 및 확인 근거 |
| --- | --- |
| 기존 앱 서버를 사용하는 기본 MCP | `server/workspace-mcp.mjs`, `server/index.mjs`. 공식 SDK HTTP 클라이언트 협상·도구 조회·인증 실패를 `workspace-mcp`, `mcp-api` 테스트로 확인 |
| 앱에서 실행한 Claude/Codex 기본 등록 | `mcp-settings.mjs`, `claude-interaction.mjs`, `interaction.mjs`. Windows PTY Codex 인수, Claude SDK 옵션, 전역/저장 설정 비변경 확인 |
| 스킬은 작성 규칙, MCP는 동작 계약 | 관리 템플릿의 `mcp-search.md`와 각 블록/뷰어/시각화 스킬 연결. 기존 CLI 유지. 관리 스킬 설치/사용자 수정 보존 테스트 포함 |
| 일반적인 근거 검색 | SQLite FTS5 BM25, 구문/all/any, 한국어 부분 일치, ID/범위, 근거 행·해시·카운트·문서 읽기. `workspace-search`, `search-worker` 테스트 |
| 관련 문맥 검색 | `retrieve-context.mjs`. 인접 블록/연결 포함, 전체 JSON 크기 제한, 공개 범위에서 JOB 제외 검사 |
| 검색 상태의 일관성 | 변경/삭제 반영, 워크스페이스 전환과 동일 경로 복원, worker 종료 복구, stale 문서 거절 테스트 |
| UI 검색 | 실제 별도 서버에서 검색, 원문 열기, Board 이동, 결과 없음 표시 확인. 검색 화면과 리포트 중복 렌더링 수정 |
| Board와 작업 관리 MCP | 다이어그램/블록/연결, JOB, Runs, 하네스 시작·제어·조회 도구 등록. API/그래프/하네스 기존 검증과 수정 충돌·재전송 검사 |
| 이미지와 시각화 MCP | 이미지 등록/표시, 뷰 상태/명령 상태, 수치 픽셀/통계, 크롭 요청/조회/소비, 리포트 파일 등록/갱신/삭제. 실제 API 테스트는 RAW 등록과 크롭 요청, 리포트 수정/삭제 포함 |
| 로컬망 URL 읽기 공유 | 같은 프로세스의 별도 리스너. 기본 OFF, capability URL, 재발급/중지/워크스페이스 격리, 실행 도구 미노출 테스트 |
| 선택적인 소스/이미지 공개 | 소스 ID·이미지 ID별 명시적 선택. 미선택 접근 거부, 공유 이미지 최대 크기 및 경로 누출 검사 |
| Windows 추가 설치 최소화 | 설치 패키지의 Node만으로 저장소 밖에서 SDK import, MCP 도구 45개 조회, SQLite 검색 확인. 회사 Claude 실행 파일 재사용 |
| 클라이언트 API | 사용자가 요청한 범위는 설계. `personal-agent-api-design.md`에 계약·재시도·상태·권한·검증 항목 기록. 구현하거나 클라이언트에 전송하지 않음 |

## 실행 근거

- `npm test`: 250/250 통과 (`output/mcp-regression-current.log`).
- Claude 기본 MCP 옵션 검증 보강 후 해당 테스트 및 설정 테스트: 9/9 통과 (`output/mcp-default-injection-audit.log`). 실행 코드 변경 없음.
- `npm run build:installer`, 격리 출력 `output/mcp-package-current`: 성공. 설치 파일 63,882,752 bytes.
- 패키지 복사본에서 배포된 `node.exe`로 `scripts/check-packaged-mcp.mjs` 실행: 성공 (`output/mcp-packaged-current.log`). SDK 도구 45개, 검색 일치, 공유 기본 OFF 확인.
- 브라우저 확인 이미지: `output/playwright/workspace-search-review.png`, `output/playwright/mcp-sharing-review.png`.

## 정확한 범위와 제한

검색은 구조화된 Board/문서와 명시적 소스, 로컬 JOB 대상이다. 전체 채팅 검색이나 대용량 데이터셋 의미 검색은 구현 범위가 아니다. 모든 CLI를 MCP로 제거하지 않았고 도구 목록에 없는 세부 조작은 스킬의 CLI 경로를 유지한다.

패키지 검증은 패키지 런타임의 실행 확인이다. 다른 PC에서 설치 마법사를 클릭한 검증이나 회사 모델의 실제 유료 추론 호출을 수행했다는 의미는 아니다. LAN 프로토콜/권한은 로컬 네트워크 리스너와 실제 MCP 클라이언트로 검증했으며 다른 PC 방화벽을 통과했다는 주장은 하지 않는다.

사용자의 4400 서버와 열린 터미널을 강제 종료하지 않았다. 새 서버 프로세스와 새 에이전트 세션에서 기본 MCP 코드가 적용된다. 커밋, push, 외부 release는 이 검증에서 수행하지 않았다.
