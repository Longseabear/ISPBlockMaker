# Linux 서버 사용

Linux에서는 명령어로 서버를 실행하고 기존 브라우저 UI로 작업합니다. 별도 데스크톱 GUI나 Windows 실행파일은 사용하지 않습니다.

## 설치

Node.js 24 이상, npm, Git과 Bash가 필요합니다. 터미널용 `node-pty`를 빌드할 Python 3, make, C++ 컴파일러도 준비하세요 (Ubuntu/Debian: `sudo apt-get install git python3 build-essential`). Node와 에이전트 CLI는 Linux용으로 설치해야 합니다. WSL에서 Windows의 node.exe/npm을 재사용하지 마세요.

`ISPBlockMaker-<version>-linux.tar.gz`와 `.sha256` 파일을 같은 폴더에 놓고:

```sh
sha256sum -c ISPBlockMaker-<version>-linux.tar.gz.sha256
tar -xzf ISPBlockMaker-<version>-linux.tar.gz
cd ISPBlockMaker-<version>-linux
bash setup.sh
./isp-block-maker --version
./isp-block-maker ~/ISPWorkspaces/my-project
```

압축 파일에는 빌드된 웹 UI, 서버와 프로젝트 템플릿이 포함됩니다. Node 및 node_modules는 포함하지 않으며 설치 시 npm 레지스트리에 접속합니다. CPU별 네이티브 의존성은 설치하는 Linux 환경에서 준비합니다. 기존 workspace는 별도 경로에 두고 업데이트할 때 새 패키지에서 같은 경로를 지정하세요.

출력되는 `http://127.0.0.1:4310`을 브라우저에서 엽니다. 서버는 포그라운드로 동작하며 Ctrl+C로 종료합니다. 포트는 `PORT=4320 ./isp-block-maker ~/ISPWorkspaces/my-project`처럼 지정합니다. 로그는 실행한 터미널에 출력됩니다. `ISP_STATE_HOME`으로 서버 상태 저장 위치를 변경할 수 있으며 기본값은 `~/.local/share/ISPBlockMaker/state`입니다.

실행 파일을 PATH에 추가하려면 패키지 폴더를 PATH에 넣으세요. 예: `export PATH="$HOME/apps/ISPBlockMaker-<version>-linux:$PATH"`. 실행 스크립트만 다른 폴더로 복사하면 서버 파일을 찾을 수 없습니다.

## 원격 Linux 서버

서버는 기존과 같이 루프백 주소에서만 대기합니다. 다른 PC에서는 SSH 터널을 연결합니다:

```sh
ssh -L 4310:127.0.0.1:4310 user@linux-host
# 연결된 Linux 셸에서:
~/apps/ISPBlockMaker-<version>-linux/isp-block-maker ~/ISPWorkspaces/my-project
```

접속 PC의 브라우저에서 `http://127.0.0.1:4310`을 엽니다. 터미널·에이전트·파일 경로는 모두 Linux 서버 기준입니다. SSH 세션이 종료되어도 서버를 유지하려면 tmux 또는 사용자 서비스에서 실행하세요.

## 에이전트와 터미널

Claude Code/Codex는 Linux에 별도 설치·인증하고 서버가 실행되는 PATH에서 찾을 수 있어야 합니다. Claude 인터랙션은 설치된 Claude 실행 파일을 사용하며 `ISP_CLAUDE_PATH`로 지정할 수도 있습니다. SDK에 포함된 별도 Claude 실행 파일로 대체하지 않습니다. 모델과 인증은 기존 CLI 설정을 사용합니다.

앱 터미널과 Terminal Hub에서 실행한 Claude/Codex에는 기존 MCP 자동 연결을 적용합니다. 별도로 연 외부 SSH 셸에는 앱의 환경변수가 상속되지 않습니다. 터미널의 키보드 모드를 `SSH·Linux 키`로 선택하면 Ctrl+Backspace를 Ctrl+W로 전달합니다.

Recipe는 Linux 실행파일과 경로로 작성해야 합니다. Windows의 cmd.exe, PowerShell 경로, .exe를 포함한 Recipe는 자동 변환하지 않습니다. Windows 설치 프로그램·서버 관리 창은 Linux 패키지에 포함하지 않습니다.

## 소스 빌드

```sh
npm ci
npm run build
ISP_WORKSPACE="$HOME/ISPWorkspaces/my-project" npm run start:checked
# 배포 압축 파일 생성 (release/):
npm run build:linux
```

`build:linux`는 웹 UI를 빌드한 뒤 플랫폼별 node_modules 없이 패키징하므로 Windows에서도 생성할 수 있습니다. 실제 Linux 실행 검증은 별도로 수행해야 합니다.

## 검증 범위

Ubuntu 24.04.3 LTS(WSL2 x64), Linux Node.js 24.18.0에서 패키지 의존성 설치, 시작 검사, 새 workspace 서버 실행, 웹 UI 응답, 실제 MCP 연결 및 Bash 명령 실행, Recipe 실행과 중단 시 자식 프로세스 종료, 서버 SIGTERM 종료를 검증했습니다. Claude 실행 파일 선택·실행 권한 검사는 테스트용 CLI로 검증했으며 실제 모델 호출은 수행하지 않았습니다. ARM64와 다른 Linux 배포판은 아직 실행 검증하지 않았습니다.
