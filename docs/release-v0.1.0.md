# ISP Block Maker v0.1.0

Windows x64용 초기 버전입니다. 로컬 웹 UI에서 ISP 그래프를 구성하고 터미널 에이전트와 함께 구현·검증·시각화할 수 있습니다.

## 다운로드 및 실행

- `ISPBlockMaker-Setup.exe`: Node와 실행 의존성을 포함한 Windows 설치파일.
- `ISPBlockMaker-Setup.exe.sha256`: 설치파일 SHA-256 체크섬.
- ZIP: 동일한 설치 페이로드. 압축을 푼 뒤 `install.ps1`을 실행하거나 설치 EXE를 사용하세요.

설치 후 새 터미널에서 작업 폴더로 이동하여 `isp-block-maker .`를 실행하세요. 폴더 초기화, 프로젝트 스킬 준비, 로컬 서버 및 브라우저 실행을 지원합니다. 시작 메뉴 실행 시에는 작업 폴더를 선택합니다.

## 포함 기능

- 블록·간선 편집, 사용자 설명 및 에이전트 구현 계약, 노드별 구현 코드 보기.
- 로컬 터미널, 블록·전체 요청 메모 및 JOB 관리, 작업 기록.
- 프레임워크와 작업 프로젝트의 독립 Git 관리 및 구현 버전 조회·전환.
- HTML·이미지 시각화, SDD 문서 생성 요청, 결과 파일·메타데이터 삭제.
- BMP·RAW Viewer, 에이전트의 이미지 등록·크롭 요청, CFA 정렬된 무손실 RAW 크롭.
- Bayer/Tetra/TetraSquare, 배열 이름으로 pixel order 선택, 16bit little-endian 컨테이너의 10/12bit 등 입력.

## 범위 및 검증

예제, 사용자 그래프·코드, 이미지, 인증정보 및 로컬 결과는 배포에 포함하지 않습니다. Git·Python·Claude Code/Codex는 별도 설치 환경을 사용하며 모델 연결도 별도입니다. 프레임워크 실행에는 npm 다운로드가 필요 없지만 에이전트의 폐쇄망 사용 가능 여부는 모델 접속 환경에 달려 있습니다.

RAW packed 10/12bit는 지원하지 않습니다. Color preview는 CFA 셀 평균 기반 미리보기이며 정식 demosaic가 아닙니다. 설치파일은 코드 서명되지 않았습니다.

Windows에서 자동 테스트 25개와 프로덕션 빌드를 통과했습니다.
