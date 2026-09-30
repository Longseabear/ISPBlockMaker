## 변경사항

- 기존 Visualization 리포트를 중복 등록 없이 갱신하는 `artifact-update` 명령과 `PATCH /api/artifacts/:id` API를 추가했습니다.
- 리포트 ID, 블록, 실험 revision, run 연결과 생성 시각을 유지합니다. 제목은 선택적으로 수정할 수 있으며 수정 시각을 기록합니다.
- 연결된 Visualizations 화면은 새 파일로 갱신됩니다. 시각화 정보에서 수정 시각을 확인할 수 있고 활동 기록에도 수정 작업이 남습니다.
- 현재 파일명을 비교하여 다른 작업이 먼저 수정한 리포트는 덮어쓰지 않고 충돌로 처리합니다.
- 에이전트 가이드에 HTML과 생성 코드의 편집을 허용한다고 명시하고, 기존 결과의 표현 수정과 새로운 실험 결과 등록을 구분했습니다.

## 사용법

`isp project`에서 대상 artifact의 ID와 현재 `file`을 확인하고 원본 HTML을 수정한 뒤 실행하세요.

```text
isp artifact-update ARTIFACT_ID result.html --expected-file CURRENT_FILE --title "Corrected report"
isp present --artifact ARTIFACT_ID --message "Report updated"
```

제목은 생략할 수 있습니다. HTML, PNG, JPEG, WebP를 기존과 같은 형식으로 갱신하며 최대 크기는 10MB입니다. 충돌 시 최신 내용을 확인하고 병합한 뒤 다시 요청하세요. 새로운 실험이나 변경된 측정 결과는 새 artifact로 등록하세요. LAN 공유 사본은 자동 변경되지 않으며 공유 창에서 별도로 업데이트해야 합니다.

## 업데이트

전체 자동 테스트 164개가 통과했습니다. CLI/API 갱신, 동일 ID·메타데이터 유지, 오래된 수정 거부, 인증과 파일 교체를 검증했습니다. Windows 패키지의 시작 검사 및 갱신 모듈·CLI 포함 여부도 확인했습니다.

Windows x64 설치파일, 오프라인 ZIP, 설치파일 SHA-256을 제공합니다. 실행 중인 작업을 마친 뒤 기존 서버를 종료하고 새 버전으로 workspace를 여세요. 사용자 workspace와 예제는 배포본에서 제외합니다.
