# v0.1.42 · Linux 브라우저 서버 배포

Linux에서 명령어로 서버를 실행하고 기존 브라우저 UI를 사용할 수 있습니다. Windows 설치 프로그램과 함께 Linux 패키지를 제공합니다.

## Linux 설치

`ISPBlockMaker-0.1.42-linux.tar.gz`를 풀고 패키지 폴더에서 실행하세요.

```sh
bash setup.sh
./isp-block-maker ~/ISPWorkspaces/my-project
```

브라우저 주소는 `http://127.0.0.1:4310`입니다. 다른 PC에서는 `ssh -L 4310:127.0.0.1:4310 user@linux-host`로 연결한 뒤 접속합니다. 서버는 루프백에서만 대기합니다.

Node.js 24 이상, npm, Git, Bash, Python 3, make, C++ 컴파일러가 필요합니다. Ubuntu/Debian 빌드 도구: `sudo apt-get install git python3 build-essential`. 패키지는 빌드된 UI와 서버를 포함하며 설치 시 npm에서 Linux 의존성을 받습니다. Node 런타임은 별도입니다.

## 변경 사항

- Linux용 실행 명령, 시작 검사, 압축 패키징과 GitHub Actions 검증 추가.
- Linux Claude 인터랙션에서 설치된 CLI 실행 파일 사용 지원. SDK 내장 CLI로 대체하지 않습니다.
- Linux Recipe 실행 지원 및 중단 시 자식 프로세스 정리.
- Linux MCP workspace 경로의 대소문자를 구분하도록 수정.
- Linux 업데이트 링크에서 Windows 설치파일 대신 Linux 패키지 선택.
- 설치·원격 접속·업데이트 안내 추가: [Linux 사용 안내](https://github.com/Longseabear/ISPBlockMaker/blob/v0.1.42/docs/linux.md).

## 검증 범위

Windows 전체 회귀 테스트와 Ubuntu 24.04.3 LTS(WSL2 x64), Node.js 24.18.0의 패키지 설치 및 실행을 검증했습니다. Linux 검증에는 웹 UI 응답, MCP 실제 연결, Bash 명령 실행, Recipe 실행·중단, 서버 종료 및 버전 명령이 포함됩니다. 실제 Claude 모델 호출, ARM64 및 다른 Linux 배포판은 검증하지 않았습니다.

업데이트 전 기존 서버를 종료하고 새 패키지에서 기존 workspace 경로를 지정하세요. Windows 사용자는 `ISPBlockMaker-Setup.exe`를 사용합니다. 체크섬 파일을 함께 제공합니다.
