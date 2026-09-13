import crypto from "node:crypto";

export const sddInstructions = `SDD (Software Development Document)를 작성해주세요. 먼저 .agents/skills/isp-block-maker/sdd.md를 읽고 현재 graph.json과 실제 구현을 확인하세요. 독립 실행 가능한 일반 HTML 하나로 작성하며 Overview → Flow → 각 블록 상세 설명 순서를 지키세요. 그림은 inline SVG 또는 내장 이미지로 넣고 외부 CDN은 사용하지 마세요. 실제 동작, 입출력, 수치 처리, 파라미터, 구현 위치와 검증 결과를 설명하고 미구현/미검증은 구분하세요. 요청을 JOB으로 나누어 처리한 뒤 isp document <html> --revision <읽은 revision>으로 등록하세요. 알고리즘을 변경하라는 요청은 아닙니다.`;

export function requestDocument(store) {
  const state = store.get();
  const work = state.globalWork || { userRequests: [], jobs: [] };
  const existing = work.userRequests.find(r => r.text === sddInstructions &&
    (r.status === "pending" || work.jobs.some(j => j.sourceRequestId === r.id && j.status !== "done")));
  if (existing) return state;
  return store.global({ ...work, userRequests: [...work.userRequests, {
    id: crypto.randomUUID(), text: sddInstructions, status: "pending",
    createdAt: new Date().toISOString(), resolution: "", jobIds: [],
  }] }, state.revision);
}
