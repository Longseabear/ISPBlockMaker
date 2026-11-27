# v0.1.43 · Node.js 22.16 지원

Linux 서버를 Node.js 22.16.0에서도 사용할 수 있도록 설치·시작 검사의 최소 버전을 조정했습니다. Node 24가 없는 환경에서도 기존 브라우저 UI, MCP, Terminal Hub와 Recipe를 사용할 수 있습니다.

- 최소 Node.js 버전: 22.16 이상.
- Linux CI에서 Node 22.16.0과 24의 빌드·실행을 각각 검증합니다.
- 설치 및 사용 문서를 갱신했습니다.
- Windows 설치파일은 기존처럼 Node 런타임을 포함합니다.

## Linux 설치

`ISPBlockMaker-0.1.43-linux.tar.gz`를 풀고 실행합니다:

```sh
bash setup.sh
./isp-block-maker ~/ISPWorkspaces/my-project
```

브라우저에서 `http://127.0.0.1:4310`에 접속하세요. 기존 v0.1.42 패키지에는 Node 24 제한이 남아 있으므로 새 패키지를 사용해야 합니다.

Node.js, npm, Git, Bash, Python 3, make, C++ 컴파일러가 필요합니다. Linux 패키지는 설치 시 npm 레지스트리 또는 사내 미러에서 의존성을 받습니다. 이 릴리스는 의존성을 포함한 Linux 오프라인 패키지가 아닙니다.

## 검증

Ubuntu 24.04.3 LTS(WSL2 x64), Node.js 22.16.0 + npm 10.9.2에서 의존성 설치 및 서버·MCP·Bash·Recipe 실행/중단·SQLite 검색·이미지 관련 테스트 32개를 검증했습니다. 실제 모델 호출, 다른 Linux 배포판 및 ARM64는 검증하지 않았습니다.
