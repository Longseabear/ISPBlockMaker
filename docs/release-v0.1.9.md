# ISP Block Maker v0.1.9

프로젝트를 `.bundle` 파일 하나로 공유하고 새 작업 폴더에 복원하는 Windows x64 릴리즈입니다.

## 프로젝트 공유

- 상단 **공유 → .bundle 저장**: 포함/제외 파일 목록, 예상 용량, Viewer 원본 포함 여부, Git 이력 포함 여부를 확인합니다.
- `isp-block-maker pack . -o project.bundle`로 명령줄에서도 저장합니다.
- `isp-block-maker open project.bundle --into C:\Work\MyISP`로 새 폴더에 복원한 뒤 서버와 브라우저를 엽니다. 부모 폴더는 미리 준비하세요.
- 그래프, 구현, 로컬 요청/JOB, 시각화·문서, Viewer 크롭과 설명, 프로젝트 스킬을 포함합니다. Viewer 원본은 기본 포함, Git 이력은 선택입니다.
- 서버 접속 토큰과 도구, 알려진 개인 설정·비밀 파일명, 가상환경·node_modules·링크는 제외합니다. 임의의 소스 내용에 적힌 비밀값은 검사하지 않습니다. Git 이력을 선택하면 과거 커밋도 공유됩니다.
- SHA-256/CRC 검증, 경로 검사, 새 폴더 전용 복원으로 기존 파일 덮어쓰기를 방지합니다. ZIP 저장 방식이며 최대 2 GiB, 파일당 256 MiB, 10,000개 파일입니다.
- 원본을 제외한 번들의 Viewer 크롭은 다운로드할 수 있습니다. 동일 RAW와 설정을 `viewer-open`으로 다시 등록하면 누락된 원본도 복구할 수 있습니다.

## 실행 옵션

```powershell
isp-block-maker pack . -o project.bundle --without-images
isp-block-maker pack . -o project.bundle --with-git
isp-block-maker pack . --dry-run
isp-block-maker open project.bundle --into C:\Work\MyISP --no-open
```

기존 `isp-block-maker .`와 시작 메뉴 실행도 유지합니다. 받는 사람도 v0.1.9 이상을 설치하세요. Git, Python 패키지, 에이전트 CLI와 모델 연결은 별도입니다. 설치파일에 Node와 서버 의존성이 포함되며 예제·사용자 워크스페이스는 포함하지 않습니다.
