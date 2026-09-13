import { useState } from "react";
import type { Api, Project } from "./types";

export function Documents({ project, api, selectedId }: { project: Project; api: Api; selectedId?: string }) {
  const docs = project.artifacts.filter(a => a.kind === "html" && a.metadata?.documentType === "sdd").slice().reverse();
  const [id, setId] = useState(selectedId || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const doc = docs.find(d => d.id === id) || docs[0];
  async function request() {
    setBusy(true);
    try { await api("/documents/request", {}); setMessage('전체 그래프 요청에 등록했습니다. 터미널 에이전트에게 “SDD 요청 처리해줘”라고 지시하세요.'); }
    catch (e) { setMessage(String(e)); }
    finally { setBusy(false); }
  }
  return <section className="sdd-view work-board">
    <div className="artifact-toolbar"><div><strong>SDD · Software Development Document</strong><p>Overview → Flow → 블록 상세</p></div>
      <button disabled={busy} onClick={request}>{busy ? "등록 중…" : "SDD 작성 요청"}</button>
      {doc && <select aria-label="SDD 문서 버전" value={doc.id} onChange={e => setId(e.target.value)}>{docs.map(d => <option key={d.id} value={d.id}>{d.title} · r{d.revision}</option>)}</select>}
      {doc && <a href={`/artifacts/${doc.file}`} download={`${doc.title}.html`}>HTML 저장</a>}
    </div>
    {message && <p role="status">{message}</p>}
    {doc ? <><small>문서 기준 r{doc.revision} · 현재 r{project.revision} · {new Date(doc.createdAt).toLocaleString()}</small><iframe key={doc.id} title="SDD 문서" src={`/artifacts/${doc.file}`} sandbox="allow-scripts" /></>
      : <div className="sdd-empty"><h2>그래프와 구현을 한 문서로</h2><p>전체 목적과 입출력부터 시작해 데이터 흐름, 각 블록의 알고리즘과 구현 근거를 그림과 글로 정리합니다.</p><p>작성 요청은 Global request에 남습니다. 에이전트가 JOB으로 나누어 처리하며, 등록된 HTML 문서가 여기에 표시됩니다.</p></div>}
  </section>;
}
