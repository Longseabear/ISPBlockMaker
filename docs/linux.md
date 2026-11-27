# Linux 서버 사용

Linux에서는 명령어로 서버를 실행하고 기존 브라우저 UI로 작업합니다. 별도 데스크톱 GUI나 Windows 실행파일은 사용하지 않습니다.

## 설치

Node.js 22.16 이상, npm, Git과 Bash가 필요합니다. 터미널용 `node-pty`를 빌드할 Python 3, make, C++ 컴파일러도 준비하세요 (Ubuntu/Debian: `sudo apt-get install git python3 build-essential`). Node와 에이전트 CLI는 Linux용으로 설치해야 합니다. WSL에서 Windows의 node.exe/npm을 재사용하지 마세요.

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

출력되는 로컬 주소를 브라우저에서 엽니다. 기본 포트 4310이 사용 중이면 운영체제가 빈 포트를 자동 할당합니다. 프로젝트마다 다른 터미널에서 실행하면 포트를 직접 지정할 필요가 없습니다. 같은 workspace가 실행 중이면 새 서버를 만들지 않고 기존 주소를 안내합니다. 서버는 포그라운드로 동작하며 Ctrl+C로 종료합니다. 고정 포트가 필요하면 `env PORT=4320 ./isp-block-maker ~/ISPWorkspaces/my-project`처럼 지정합니다. 명시한 포트가 사용 중이면 다른 포트로 바꾸지 않고 오류를 안내합니다. 로그는 실행한 터미널에 출력됩니다. `ISP_STATE_HOME`으로 서버 상태 저장 위치를 변경할 수 있으며 기본값은 `~/.local/share/ISPBlockMaker/state`입니다.

실행 파일을 PATH에 추가하려면 패키지 폴더를 PATH에 넣으세요. 예: `export PATH="$HOME/apps/ISPBlockMaker-<version>-linux:$PATH"`. 실행 스크립트만 다른 폴더로 복사하면 서버 파일을 찾을 수 없습니다.

## 원격 Linux 서버

서버는 기존과 같이 루프백 주소에서만 대기합니다. 다른 PC에서는 SSH 터널을 연결합니다:

```sh
ssh -L 4310:127.0.0.1:4310 user@linux-host
# 연결된 Linux 셸에서:
env PORT=4310 ~/apps/ISPBlockMaker-<version>-linux/isp-block-maker ~/ISPWorkspaces/my-project
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

Node.js 22.16.0에서도 Linux 의존성 설치와 서버·MCP·Bash·Recipe·검색(SQLite FTS)·이미지 관련 테스트 32개를 통과했습니다. v0.1.43부터 설치 및 시작 검사의 최소 버전은 22.16입니다. v0.1.42에 게시된 기존 패키지는 Node 24 제한을 포함하므로 v0.1.43 이상 패키지를 사용하세요.

폐쇄망에서 npm 레지스트리 또는 사내 미러에 접속할 수 없다면 `setup.sh`만으로 설치할 수 없습니다. 같은 Linux CPU 아키텍처·libc 및 Node 버전 환경에서 설치한 런타임 의존성을 함께 반입하는 별도 패키지가 필요합니다.

## 오프라인 패키지 만들기

용량이 제한된 RHEL 8 x86_64 환경에서 이미 Node 22.16.0을 사용 중이면 `-offline-slim.tar.gz`를 선택하세요. 내장 Node와 SDK 내장 Claude, 다른 OS의 터미널 바이너리 및 브라우저 빌드에만 필요한 npm 패키지를 제외합니다. npm 설치는 여전히 필요 없으며, 네이티브 모듈 때문에 Node의 주 버전(22.x)이 빌드 버전과 일치해야 합니다. `setup.sh`에서 ABI를 검사합니다. 기존 작업 폴더는 유지하고 새 압축파일을 별도 폴더에 푸세요.

경량 빌드: `ISP_LINUX_TARGET=rhel8 node scripts/build-linux.mjs --offline --system-node`. 기존 내장 Node형도 같은 서버 의존성 정리를 적용합니다. UI 파일과 라이선스, 서버 실행 의존성 및 Linux 터미널 모듈은 유지합니다.

인터넷에 연결된, 대상과 호환되는 Linux 환경에서 웹 UI를 빌드한 뒤 `node scripts/build-linux.mjs --offline`을 실행합니다. `ISPBlockMaker-<version>-linux-<arch>-offline.tar.gz`에 빌드 머신의 Node 실행 파일과 런타임 npm 의존성을 포함합니다. `ISP_NODE_LICENSE`는 사용한 Node 배포본의 LICENSE 파일로 지정할 수 있습니다 (기본: Node의 bin 폴더 상위 LICENSE).

대상에서는 압축을 풀고 `bash setup.sh`를 실행한 뒤 `./isp-block-maker <workspace>`로 시작합니다. 이 패키지의 setup은 npm, 컴파일러 또는 다운로드를 사용하지 않으며, 런처는 내장 Node를 선택합니다. `offline.json`에서 Node 버전, CPU 아키텍처와 빌드 환경의 glibc를 확인할 수 있습니다. glibc가 오래된 다른 배포판에서는 호환되는 환경에서 다시 빌드해야 할 수 있습니다.

Git, 기본 Linux 셸과 시스템 라이브러리는 대상 환경에 필요합니다. SSH, Python, Claude Code/Codex 등 사용자가 실행할 외부 프로그램 및 모델은 이 패키지에 포함하지 않습니다. 일반 `-linux.tar.gz`와 `-offline.tar.gz`는 설치 방식이 다르므로 파일명을 확인하세요.

RHEL 8 x86_64용 패키지는 Red Hat UBI 8.10(glibc 2.28)에서 Node 22.16.0을 사용하여 `ISP_LINUX_TARGET=rhel8 node scripts/build-linux.mjs --offline`으로 생성했습니다. 빌드 환경에는 GCC C++, make, Git, Python 3.9 및 인터넷 접근이 필요하며 `npm_config_python=/usr/bin/python3.9`로 Python을 선택했습니다. 생성된 패키지는 네트워크를 차단한 UBI 8.10에서 npm·컴파일러 호출을 막고 설치·서버·MCP·터미널·Recipe·검색·이미지 테스트 32개를 통과했습니다. 사용자의 실제 RHEL 호스트 검증은 별도입니다.

```sh
tar -xzf ISPBlockMaker-0.1.44-linux-x64-rhel8-offline.tar.gz
cd ISPBlockMaker-0.1.44-linux-x64-rhel8-offline
bash setup.sh
./isp-block-maker ~/ISPWorkspaces/my-project
```
