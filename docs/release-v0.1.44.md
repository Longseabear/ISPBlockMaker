# v0.1.44 · Linux 자동 포트 선택

Linux에서 여러 프로젝트를 열 때 포트를 직접 지정할 필요가 없습니다. 기본 포트가 사용 중이면 빈 포트를 자동 선택하고 로컬 접속 주소를 출력합니다. 같은 프로젝트가 실행 중이면 기존 주소를 안내합니다. `serve` 명령에도 동일하게 적용합니다.

```sh
isp-block-maker ~/ISPWorkspaces/project-a
# 다른 터미널에서:
isp-block-maker ~/ISPWorkspaces/project-b
```

기본 접속은 로컬(127.0.0.1)입니다. 외부 접속은 선택 사항이며 SSH 포트 포워딩 등을 별도로 설정합니다. 고정 포트가 필요하면 `env PORT=4320 isp-block-maker ~/ISPWorkspaces/project-a`를 사용하세요. 명시한 포트가 사용 중이면 오류를 안내합니다.

## RHEL 8 x86_64 / Node 22.16 환경

용량이 작은 `ISPBlockMaker-0.1.44-linux-x64-rhel8-offline-slim.tar.gz`를 권장합니다. 기존 Node 22.x와 Git을 사용하며 npm 설치·네트워크·컴파일러가 필요하지 않습니다. 내장 Claude와 Node, 다른 OS 바이너리 및 브라우저 빌드 전용 의존성을 제외했습니다.

```sh
tar -xzf ISPBlockMaker-0.1.44-linux-x64-rhel8-offline-slim.tar.gz
cd ISPBlockMaker-0.1.44-linux-x64-rhel8-offline-slim
bash setup.sh
./isp-block-maker ~/ISPWorkspaces/my-project
```

Node를 포함한 오프라인 패키지와 일반 Linux 온라인 설치 패키지, Windows 설치파일도 제공합니다. 기존 설치 서버를 종료한 후 새 폴더에서 같은 workspace를 지정하세요. PATH를 등록했다면 새 설치 폴더로 갱신하세요. 사용자 프로젝트는 삭제하지 마세요.

자동 포트, 실제 MCP 연결, 동일 workspace 재실행, 명시 포트 충돌, 터미널·Recipe·검색·이미지 기능을 검증합니다. 실제 모델 호출은 검증 범위에 포함하지 않습니다.
