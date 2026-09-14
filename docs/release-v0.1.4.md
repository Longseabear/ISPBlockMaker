# ISP Block Maker v0.1.4

Windows x64용 Image Viewer 업데이트입니다.

## 변경 사항

- **Bayer / Tetra · CFA colors**: 원본 픽셀을 해당 R/G/B 채널로 표시합니다. Bayer, Tetra, TetraSquare와 네 가지 pixel order 및 원본 CFA 위치 오프셋을 반영합니다.
- CFA 배열을 확인할 수 있도록 최대 1200×1200 원본 영역을 표시하며 View x/y로 이동합니다.
- **Simple ISP · Demosaic + Gamma**: 간단한 보간과 감마를 적용합니다. 기본 감마는 2.2이며 0.1–5 범위에서 조절할 수 있습니다.
- Tetra·TetraSquare는 같은 색 그룹을 먼저 평균낸 뒤 보간합니다. 화이트밸런스나 색 보정은 적용하지 않는 미리보기 기능입니다.
- RAW 원본과 크롭의 픽셀 값은 변경하지 않습니다.

## 설치 및 실행

`ISPBlockMaker-Setup.exe`를 실행하세요. Windows x64용 Node와 실행 의존성을 포함하며 예제·사용자 작업 데이터는 포함하지 않습니다. 설치 후 새 터미널에서 작업 폴더로 이동해 `isp-block-maker .`를 실행하세요.

Git, Python, 에이전트 CLI와 모델 접속 환경은 별도입니다. 설치파일은 코드 서명되지 않았으며 SHA-256 체크섬을 함께 제공합니다. 기존 프로젝트의 사용자 스킬은 자동으로 덮어쓰지 않습니다.
