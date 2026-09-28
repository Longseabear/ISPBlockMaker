import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Flag, GitCompareArrows, History, LoaderCircle, Plus, RotateCcw, Save, X } from "lucide-react";
import type { Api, Project } from "./types";
import type { Checkpoint, CheckpointComparison, CheckpointPreview, JobRef, TrackingState, WorkAttempt } from "./tracking-types";
import "./work-tracking.css";

const statusLabels = { in_progress: "진행 중", completed: "완료", failed: "실패", cancelled: "중단" };
const checkpointKinds = { manual: "직접 저장", baseline: "시작점", result: "결과", safety: "복원 전 보관" };
const dateLabel = (date: string) => new Date(date).toLocaleString();
const jobKey = (ref: JobRef) => JSON.stringify([ref.blockId, ref.jobId]);
const lines = (text: string) => text.split("\n").map(line => line.trim()).filter(Boolean);
function readDraft<T>(key: string): T | null {
  try { return JSON.parse(sessionStorage.getItem(key) || "null") as T | null; } catch { return null; }
}
function storeDraft(key: string, value: unknown) {
  try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* A full or disabled browser store must not block editing. */ }
}

type Props = {
  project: Project;
  api: Api;
  onArtifact: (id: string) => void;
  onOpen: (id: string | null) => void;
  initialJob?: JobRef | null;
};

function projectJobs(project: Project) {
  return [{ id: null, name: "전체 그래프", jobs: project.globalWork?.jobs }, ...project.blocks]
    .flatMap(scope => (scope.jobs || []).map(job => ({ ...job, blockId: scope.id, scopeName: scope.name })));
}

export function WorkTracking({ project, api, onArtifact, onOpen, initialJob }: Props) {
  const [data, setData] = useState<TrackingState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(!!initialJob);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [checkpointTitle, setCheckpointTitle] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [comparison, setComparison] = useState<CheckpointComparison | null>(null);
  const [preview, setPreview] = useState<CheckpointPreview | null>(null);
  const [restoring, setRestoring] = useState(false);
  const active = useRef(true);
  const requestId = useRef(0);
  const comparisonAnchor = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const next = await api<TrackingState>("/tracking");
    if (active.current && id === requestId.current) setData(next);
  }, [api]);

  useEffect(() => {
    active.current = true;
    const update = () => {
      if (document.visibilityState === "visible") void refresh().catch(e => {
        if (active.current) setError(String(e));
      });
    };
    update();
    const timer = setInterval(update, 10000);
    window.addEventListener("focus", update);
    return () => {
      active.current = false;
      ++requestId.current;
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [refresh, project.revision]);

  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (active.current) setError(String(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  const checkpoints = data?.checkpoints || [];
  const draftPrefix = `isp-work-draft:${data?.current.root || project.name}:`;
  const checkpoint = (id: string | null | undefined) => checkpoints.find(item => item.id === id);
  const accepted = data?.attempts.find(attempt => attempt.id === data.acceptedAttemptId);
  const acceptedCheckpoint = checkpoint(accepted?.resultCheckpointId);
  const currentCheckpoint = checkpoint(data?.current.checkpointId);
  const acceptedApplied = !!acceptedCheckpoint && acceptedCheckpoint.treeHash === data?.current.treeHash;
  const jobs = projectJobs(project);
  const attempts = (data?.attempts || []).filter(attempt =>
    (status === "all" || (status === "accepted" ? attempt.id === data?.acceptedAttemptId : attempt.status === status)) &&
    `${attempt.title} ${attempt.approach} ${attempt.summary} ${attempt.jobRefs.map(ref => jobs.find(job => job.id === ref.jobId && job.blockId === ref.blockId)?.title || ref.jobId).join(" ")}`.toLowerCase().includes(query.toLowerCase()),
  ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  async function compare(from: string, to: string) {
    if (!from || !to) return;
    setComparison(null);
    const result = await api<CheckpointComparison>(`/checkpoints/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (active.current) {
      setComparison(result);
      comparisonAnchor.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  async function openRestore(item: Checkpoint) {
    setPreview(null);
    const result = await api<CheckpointPreview>(`/checkpoints/${encodeURIComponent(item.id)}/preview`);
    if (active.current) setPreview(result);
  }

  async function restore() {
    if (!preview || restoring || preview.blockedReason) return;
    setRestoring(true);
    setError("");
    try {
      await api(`/checkpoints/${encodeURIComponent(preview.checkpoint.id)}/restore`, {
        checkpointId: preview.checkpoint.id,
        snapshot: preview.snapshot,
        stopTerminals: true,
      });
      location.reload();
    } catch (e) {
      setError(String(e));
      setPreview(null);
      setRestoring(false);
      void refresh().catch(() => {});
    }
  }

  return <div className="work-tracking" aria-busy={busy || restoring}>
    {error && <div className="tracking-error" role="alert">{error}</div>}
    {!data ? <div className="tracking-loading" role="status">{error ? <button disabled={busy} onClick={() => void perform(refresh)}><RotateCcw size={15} />다시 불러오기</button> : <><LoaderCircle className="tracking-spin" size={17} />작업 시도와 체크포인트를 불러오는 중…</>}</div> : <>
      <div className="tracking-summary">
        <div>
          <small>현재 적용된 구현</small>
          <strong>{currentCheckpoint?.title || (data.current.available ? data.current.branch || "작업 중인 구현" : "Git 저장소 확인 필요")}</strong>
          <small>{data.current.available ? <><code>{data.current.headHash?.slice(0, 8) || "첫 커밋 전"}</code>{data.current.dirty ? " · 커밋되지 않은 변경 포함" : " · 커밋된 상태"}</> : data.current.reason}</small>
        </div>
        <div className={accepted ? "tracking-accepted" : ""}>
          <small>채택한 결과</small>
          <strong>{accepted?.title || "아직 채택한 시도가 없습니다"}</strong>
          <small>{accepted ? (!data.current.available || !acceptedCheckpoint ? "현재 구현과 비교할 수 없습니다" : acceptedApplied ? "현재 구현과 내용이 같습니다" : "현재 적용된 구현과 다릅니다") : "완료된 시도를 비교한 뒤 채택하세요."}</small>
        </div>
      </div>
      <div className="tracking-heading">
        <div><h2>작업 시도</h2><p className="tracking-hint">JOB의 목표는 유지하고 접근 방법·실행 조건·검증 결과를 시도마다 기록합니다.</p></div>
        <div className="tracking-actions">
          <button title="작업 기록 새로고침" aria-label="작업 기록 새로고침" disabled={busy} onClick={() => void perform(refresh)}><RotateCcw size={15} /></button>
          <button className="tracking-primary" disabled={busy || !data.current.available} onClick={() => setCreating(value => !value)} aria-expanded={creating}><Plus size={15} />새 시도</button>
        </div>
      </div>
      {creating && <NewAttemptForm storageKey={`${draftPrefix}new:${initialJob ? jobKey(initialJob) : "general"}`} project={project} checkpoints={checkpoints} initialJob={initialJob} busy={busy} onCancel={() => setCreating(false)} onSubmit={body => perform(async () => {
        const attempt = await api<WorkAttempt>("/attempts", body);
        storeDraft(`${draftPrefix}new:${initialJob ? jobKey(initialJob) : "general"}`, null);
        setCreating(false);
        setExpandedId(attempt.id);
        setQuery("");
        setStatus("all");
        await refresh();
      })} />}
      <div className="tracking-filter">
        <input aria-label="작업 시도 검색" placeholder="시도 이름·접근 방법·JOB 검색" value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label="작업 시도 상태" value={status} onChange={e => setStatus(e.target.value)}><option value="all">모든 시도</option><option value="in_progress">진행 중</option><option value="completed">완료</option><option value="failed">실패</option><option value="cancelled">중단</option><option value="accepted">채택한 결과</option></select>
      </div>
      {!attempts.length && <div className="tracking-empty">{data.attempts.length ? "조건에 맞는 작업 시도가 없습니다." : <>첫 시도를 등록하면 현재 그래프와 코드가 시작 체크포인트로 보관됩니다.<br />작업을 마치면서 결과·검증·시각화를 연결할 수 있습니다.</>}</div>}
      {attempts.map(attempt => {
        const result = checkpoint(attempt.resultCheckpointId);
        const baseline = checkpoint(attempt.baselineCheckpointId);
        const isAccepted = attempt.id === data.acceptedAttemptId;
        const expanded = expandedId === attempt.id;
        return <article key={attempt.id} className={`tracking-attempt${isAccepted ? " is-accepted" : ""}`}>
          <div className="tracking-card-heading"><div><h3>{attempt.title}</h3><span className={`tracking-status ${attempt.status}`}>{statusLabels[attempt.status]}</span>{isAccepted && <span className="tracking-pill accepted"><Flag size={11} />채택</span>}{result?.treeHash === data.current.treeHash && <span className="tracking-pill">현재 구현</span>}</div><small>{dateLabel(attempt.createdAt)}</small></div>
          {attempt.summary || attempt.approach ? <p>{attempt.summary || attempt.approach}</p> : null}
          <div className="tracking-attempt-meta">
            {attempt.jobRefs.length ? attempt.jobRefs.map(ref => {
              const job = jobs.find(item => item.id === ref.jobId && item.blockId === ref.blockId);
              const original = attempt.jobSnapshots?.find(item => item.jobId === ref.jobId && item.blockId === ref.blockId);
              return job ? <button key={jobKey(ref)} disabled={busy} title={original?.job.description || job.description} onClick={() => onOpen(ref.blockId)}>JOB · {original?.job.title || job.title}</button> : <span key={jobKey(ref)} title={original?.job.description}>과거 JOB · {original?.job.title || ref.jobId}</span>;
            }) : <span>JOB에 연결되지 않은 시도</span>}
          </div>
          <div className="tracking-actions">
            <button disabled={busy} aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : attempt.id)}>{expanded ? "기록 접기" : attempt.status === "in_progress" ? "결과 기록" : "상세 기록"}</button>
            {baseline && result && <button disabled={busy || !baseline.available || !result.available} onClick={() => void perform(async () => { setFromId(baseline.id); setToId(result.id); await compare(baseline.id, result.id); })}><GitCompareArrows size={14} />변경 비교</button>}
            {attempt.status === "completed" && !isAccepted && <button disabled={busy} title="구현을 전환하지 않고 이 결과를 채택합니다" onClick={() => void perform(async () => { await api(`/attempts/${encodeURIComponent(attempt.id)}/accept`, {}); await refresh(); })}><Flag size={14} />채택</button>}
            {result && <button disabled={busy || !result.available} onClick={() => void perform(() => openRestore(result))}><History size={14} />이 구현으로 돌아가기</button>}
          </div>
          {attempt.artifactIds.length > 0 && <div className="tracking-attempt-meta">{attempt.artifactIds.map(id => {
            const artifact = project.artifacts.find(item => item.id === id);
            return artifact ? <button key={id} disabled={busy} onClick={() => onArtifact(id)}>결과 보기 · {artifact.title}<ArrowRight size={13} /></button> : <span key={id}>시각화 없음 · 번들에서 제외되었거나 삭제됨 · {id}</span>;
          })}</div>}
          {expanded && (attempt.status === "in_progress" || readDraft(`${draftPrefix}${attempt.id}`) ? <AttemptResultForm key={attempt.id} storageKey={`${draftPrefix}${attempt.id}`} attempt={attempt} project={project} checkpoints={checkpoints} busy={busy} onSave={body => perform(async () => { await api(`/attempts/${encodeURIComponent(attempt.id)}`, body, "PATCH"); storeDraft(`${draftPrefix}${attempt.id}`, null); setExpandedId(null); await refresh(); })} /> : <div className="tracking-detail">
            {attempt.approach && <div><h4>접근 방법</h4><p>{attempt.approach}</p></div>}
            {attempt.inputConditions && <div><h4>입력 · 실행 조건</h4><p>{attempt.inputConditions}</p></div>}
            {attempt.validation.length > 0 && <div><h4>검증 결과 · 작업자가 기록한 내용</h4><ul>{attempt.validation.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
            {attempt.parameterSnapshot?.some(item => Object.keys(item.parameters).length) && <details><summary>시작 시점의 블록 파라미터</summary>{attempt.parameterSnapshot.filter(item => Object.keys(item.parameters).length).map(item => <div key={item.blockId}><h4>{project.blocks.find(block => block.id === item.blockId)?.name || item.blockId}</h4><pre className="tracking-patch">{JSON.stringify(item.parameters, null, 2)}</pre></div>)}</details>}
            <p className="tracking-hint">시작점: {baseline?.title || "기록 없음"}<br />결과: {result?.title || "결과 체크포인트 없음"}{attempt.completedAt && <><br />종료: {dateLabel(attempt.completedAt)}</>}</p>
          </div>)}
        </article>;
      })}
      <section className="tracking-checkpoints" aria-label="구현 체크포인트">
        <div className="tracking-heading"><div><h2>체크포인트</h2><p className="tracking-hint">그래프와 코드 전체를 함께 보관합니다. 채택 여부와 구현 복원은 독립적입니다.</p></div></div>
        <form className="tracking-checkpoint-form" onSubmit={e => { e.preventDefault(); if (checkpointTitle.trim()) void perform(async () => { await api("/checkpoints", { title: checkpointTitle.trim() }); setCheckpointTitle(""); await refresh(); }); }}>
          <input aria-label="체크포인트 이름" placeholder="예: max-min 검증 통과" value={checkpointTitle} onChange={e => setCheckpointTitle(e.target.value)} maxLength={200} disabled={busy || !data.current.available} />
          <button disabled={busy || !data.current.available || !checkpointTitle.trim()}><Save size={14} />현재 구현 보관</button>
        </form>
        {!checkpoints.length ? <p className="tracking-hint">아직 보관한 체크포인트가 없습니다.</p> : <div className="tracking-checkpoint-list">{[...checkpoints].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(item => <div key={item.id} className="tracking-checkpoint-row">
          <div><strong>{item.title}</strong><span className="tracking-pill">{checkpointKinds[item.kind]}</span>{item.treeHash === data.current.treeHash && <span className="tracking-pill accepted">현재 내용</span>}<small>{dateLabel(item.createdAt)} · <code>{item.hash.slice(0, 8)}</code>{!item.available ? " · 원본 없음" : ""}</small></div>
          <div className="tracking-actions"><button disabled={busy || !item.available} onClick={() => { setFromId(item.id); setComparison(null); comparisonAnchor.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}>비교 기준</button><button disabled={busy || !item.available} onClick={() => void perform(() => openRestore(item))}>복원</button></div>
        </div>)}</div>}
        {checkpoints.length > 1 && <div ref={comparisonAnchor}>
          <div className="tracking-compare-controls"><label>비교 기준<select value={fromId} disabled={busy} onChange={e => { setFromId(e.target.value); setComparison(null); }}><option value="">체크포인트 선택</option>{checkpoints.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.title} · {item.hash.slice(0, 8)}</option>)}</select></label><span>→</span><label>비교 대상<select value={toId} disabled={busy} onChange={e => { setToId(e.target.value); setComparison(null); }}><option value="">체크포인트 선택</option>{checkpoints.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.title} · {item.hash.slice(0, 8)}</option>)}</select></label><button disabled={busy || !fromId || !toId || fromId === toId} onClick={() => void perform(() => compare(fromId, toId))}><GitCompareArrows size={14} />비교</button></div>
          {comparison && <div className="tracking-comparison"><h3>{comparison.from.title} → {comparison.to.title}</h3><p className="tracking-hint">변경 파일 {comparison.files.length}개 · 변경 블록 {comparison.blockChanges.length}개</p><div className="tracking-block-changes">{comparison.blockChanges.map(block => <span key={block.id}>{block.name} · {block.status === "added" ? "추가" : block.status === "removed" ? "삭제" : "수정"}{block.fields.length ? ` (${block.fields.join(", ")})` : ""}</span>)}</div><pre className="tracking-patch">{comparison.stats || "파일 내용이 같습니다."}</pre><details><summary>변경 파일 · 코드 diff</summary><ul>{comparison.files.map(file => <li key={file}><code>{file}</code></li>)}</ul><pre className="tracking-patch">{comparison.patch || "텍스트 변경 없음"}</pre>{comparison.truncated && <p className="tracking-hint">큰 diff는 일부만 표시됩니다.</p>}</details></div>}
        </div>}
      </section>
    </>}
    {busy && <div className="tracking-loading" role="status"><LoaderCircle className="tracking-spin" size={16} />처리 중…</div>}
    {preview && <RestoreDialog preview={preview} restoring={restoring} onClose={() => setPreview(null)} onRestore={() => void restore()} />}
  </div>;
}

type NewAttemptDraft = { title: string; approach: string; inputConditions: string; baseline: string; selectedJobs: string[] };
function NewAttemptForm({ project, checkpoints, initialJob, storageKey, busy, onCancel, onSubmit }: {
  project: Project;
  checkpoints: Checkpoint[];
  initialJob?: JobRef | null;
  storageKey: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const jobs = projectJobs(project);
  const initial = jobs.find(job => initialJob?.jobId === job.id && initialJob.blockId === job.blockId);
  const [draft, setDraft] = useState<NewAttemptDraft>(() => readDraft<NewAttemptDraft>(storageKey) || { title: initial?.title || "", approach: "", inputConditions: "", baseline: "", selectedJobs: initialJob ? [jobKey(initialJob)] : [] });
  const { title, approach, inputConditions, baseline, selectedJobs } = draft;
  const update = (change: Partial<NewAttemptDraft>) => setDraft(value => { const next = { ...value, ...change }; storeDraft(storageKey, next); return next; });
  const setTitle = (value: string) => update({ title: value }), setApproach = (value: string) => update({ approach: value }), setInputConditions = (value: string) => update({ inputConditions: value }), setBaseline = (value: string) => update({ baseline: value });
  const setSelectedJobs = (change: (value: string[]) => string[]) => update({ selectedJobs: change(selectedJobs) });
  return <form className="tracking-form" onSubmit={e => { e.preventDefault(); if (title.trim()) void onSubmit({ title: title.trim(), approach: approach.trim(), inputConditions: inputConditions.trim(), jobRefs: jobs.filter(job => selectedJobs.includes(jobKey({ blockId: job.blockId, jobId: job.id }))).map(job => ({ blockId: job.blockId, jobId: job.id })), ...(baseline ? { baselineCheckpointId: baseline } : {}) }); }}>
    <div className="tracking-heading"><h3>새 작업 시도</h3><button type="button" aria-label="새 시도 작성 취소" disabled={busy} onClick={onCancel}><X size={16} /></button></div>
    <p className="tracking-hint">작성 중인 내용은 이 브라우저 탭에 임시 보관됩니다. 시도 등록을 눌러야 작업 기록에 저장됩니다.</p>
    <label>시도 이름<input autoFocus required maxLength={200} placeholder="예: max-min 기반으로 평탄 영역 판별" value={title} onChange={e => setTitle(e.target.value)} disabled={busy} /></label>
    <label>접근 방법<textarea value={approach} onChange={e => setApproach(e.target.value)} placeholder="무엇을 바꾸고 어떤 효과를 확인할지" disabled={busy} /></label>
    <label>입력 · 실행 조건<textarea value={inputConditions} onChange={e => setInputConditions(e.target.value)} placeholder="입력 영상, 파라미터, 실행 명령 등 재현에 필요한 조건" disabled={busy} /></label>
    {jobs.length > 0 && <fieldset disabled={busy}><legend>연결할 JOB · 여러 개 선택 가능</legend>{jobs.map(job => { const key = jobKey({ blockId: job.blockId, jobId: job.id }); return <label className="tracking-checkbox" key={key}><input type="checkbox" checked={selectedJobs.includes(key)} onChange={e => setSelectedJobs(values => e.target.checked ? [...values, key] : values.filter(value => value !== key))} /><span>{job.scopeName} · {job.title}{job.status === "done" ? " (완료)" : ""}</span></label>; })}</fieldset>}
    <label>시작 기준<select value={baseline} onChange={e => setBaseline(e.target.value)} disabled={busy}><option value="">현재 구현을 시작 체크포인트로 보관</option>{checkpoints.filter(item => item.available).map(item => <option key={item.id} value={item.id}>{item.title} · {item.hash.slice(0, 8)}</option>)}</select></label>
    {baseline && <p className="tracking-hint">선택한 체크포인트를 비교 기준으로 기록합니다. 현재 구현은 자동으로 전환되지 않습니다.</p>}
    <div className="tracking-actions"><button className="tracking-primary" disabled={busy || !title.trim()}><Plus size={14} />시도 등록</button><button type="button" disabled={busy} onClick={onCancel}>취소</button></div>
  </form>;
}

type ResultDraft = { approach: string; inputConditions: string; summary: string; validation: string; artifactIds: string[]; resultCheckpointId: string; status: WorkAttempt["status"]; expectedUpdatedAt: string };
function AttemptResultForm({ attempt, project, checkpoints, storageKey, busy, onSave }: {
  attempt: WorkAttempt;
  project: Project;
  checkpoints: Checkpoint[];
  storageKey: string;
  busy: boolean;
  onSave: (body: unknown) => Promise<void>;
}) {
  const serverDraft = (): ResultDraft => ({ approach: attempt.approach, inputConditions: attempt.inputConditions, summary: attempt.summary, validation: attempt.validation.join("\n"), artifactIds: attempt.artifactIds, resultCheckpointId: attempt.resultCheckpointId || "", status: attempt.status, expectedUpdatedAt: attempt.updatedAt });
  const [draft, setDraft] = useState<ResultDraft>(() => readDraft<ResultDraft>(storageKey) || serverDraft());
  const { approach, inputConditions, summary, validation, artifactIds, resultCheckpointId, status } = draft;
  const update = (change: Partial<ResultDraft>) => setDraft(value => { const next = { ...value, ...change }; storeDraft(storageKey, next); return next; });
  const setApproach = (value: string) => update({ approach: value }), setInputConditions = (value: string) => update({ inputConditions: value }), setSummary = (value: string) => update({ summary: value }), setValidation = (value: string) => update({ validation: value }), setResultCheckpointId = (value: string) => update({ resultCheckpointId: value }), setStatus = (value: WorkAttempt["status"]) => update({ status: value });
  const setArtifactIds = (change: (value: string[]) => string[]) => update({ artifactIds: change(artifactIds) });
  const conflict = draft.expectedUpdatedAt !== attempt.updatedAt;
  const finished = attempt.status !== "in_progress";
  return <form className="tracking-form tracking-detail" onSubmit={e => { e.preventDefault(); if (!conflict && !finished) void onSave({ expectedUpdatedAt: draft.expectedUpdatedAt, approach: approach.trim(), inputConditions: inputConditions.trim(), summary: summary.trim(), validation: lines(validation), artifactIds, status, resultCheckpointId: resultCheckpointId || null }); }}>
    {(conflict || finished) ? <div className="tracking-error" role="status">{finished ? "이 시도는 다른 곳에서 종료되었습니다. 아래는 브라우저에 남겨 둔 입력입니다." : "에이전트 또는 다른 화면에서 기록을 변경했습니다. 작성 중인 내용은 보존되었으며, 오래된 내용으로 덮어쓸 수 없습니다."}<div className="tracking-actions"><button type="button" disabled={busy} onClick={() => { storeDraft(storageKey, null); setDraft(serverDraft()); }}>임시 입력 버리고 서버 기록 불러오기</button></div></div> : <p className="tracking-hint">작성 중인 내용은 이 브라우저 탭에 임시 보관됩니다. 기록 저장을 눌러야 서버에 반영됩니다.</p>}
    <label>접근 방법<textarea value={approach} onChange={e => setApproach(e.target.value)} disabled={busy} /></label>
    <label>입력 · 실행 조건<textarea value={inputConditions} onChange={e => setInputConditions(e.target.value)} disabled={busy} /></label>
    <label>결과 요약{status === "completed" ? " · 완료 시 필수" : ""}<textarea required={status === "completed"} value={summary} onChange={e => setSummary(e.target.value)} placeholder="무엇이 개선됐고 어떤 한계가 남았는지" disabled={busy} /></label>
    <label>검증 결과 · 한 줄에 하나<textarea value={validation} onChange={e => setValidation(e.target.value)} placeholder="예: 저조도 영상 3개 비교, 에지 영역 디테일 유지" disabled={busy} /></label>
    {(project.artifacts.length > 0 || artifactIds.length > 0) && <fieldset disabled={busy}><legend>연결할 시각화</legend>{project.artifacts.map(artifact => <label key={artifact.id} className="tracking-checkbox"><input type="checkbox" checked={artifactIds.includes(artifact.id)} onChange={e => setArtifactIds(values => e.target.checked ? [...values, artifact.id] : values.filter(id => id !== artifact.id))} /><span>{artifact.title} · {dateLabel(artifact.createdAt)}</span></label>)}{artifactIds.filter(id => !project.artifacts.some(artifact => artifact.id === id)).map(id => <label key={id} className="tracking-checkbox"><input type="checkbox" checked onChange={() => setArtifactIds(values => values.filter(value => value !== id))} /><span>삭제된 시각화 · {id} · 연결을 해제한 뒤 저장하세요.</span></label>)}</fieldset>}
    <label>결과 체크포인트<select value={resultCheckpointId} onChange={e => setResultCheckpointId(e.target.value)} disabled={busy}><option value="">완료 시 현재 구현을 자동 보관</option>{checkpoints.filter(item => item.available).map(item => <option key={item.id} value={item.id}>{item.title} · {item.hash.slice(0, 8)}</option>)}</select></label>
    <label>시도 상태<select value={status} onChange={e => setStatus(e.target.value as WorkAttempt["status"])} disabled={busy}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {status !== "in_progress" && <p className="tracking-hint">종료한 시도는 기록을 보존하기 위해 수정할 수 없습니다. 이후 작업은 새 시도로 이어갑니다. JOB의 완료 여부는 별도로 관리합니다.</p>}
    <div className="tracking-actions"><button className="tracking-primary" disabled={busy || conflict || finished || (status === "completed" && !summary.trim())}>{status === "in_progress" ? <Save size={14} /> : <Check size={14} />}{status === "in_progress" ? "기록 저장" : `${statusLabels[status]}로 기록`}</button></div>
  </form>;
}

function RestoreDialog({ preview, restoring, onClose, onRestore }: {
  preview: CheckpointPreview;
  restoring: boolean;
  onClose: () => void;
  onRestore: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="tracking-restore-backdrop" onClick={e => { if (e.target === e.currentTarget && !restoring) onClose(); }}>
    <section ref={dialog} className="tracking-restore-dialog" role="dialog" aria-modal="true" aria-labelledby="tracking-restore-title" onKeyDown={e => {
      if (e.key === "Escape" && !restoring) { e.preventDefault(); onClose(); }
      if (e.key === "Tab") {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []);
        if (!controls.length) { e.preventDefault(); return; }
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }}>
      <div className="tracking-heading"><h2 id="tracking-restore-title">이 체크포인트로 복원</h2><button ref={closeButton} disabled={restoring} aria-label="복원 미리보기 닫기" onClick={onClose}><X size={17} /></button></div>
      <h3>{preview.checkpoint.title}</h3><small>{dateLabel(preview.checkpoint.createdAt)} · <code>{preview.checkpoint.hash.slice(0, 8)}</code></small>
      <p>그래프와 구현 코드 전체를 이 시점으로 되돌립니다. 연결된 터미널을 종료한 뒤 화면을 새로고침합니다.</p>
      <p className="tracking-hint">복원 전에 현재 구현을 안전 체크포인트로 보관합니다.{preview.current.dirty ? " 커밋하지 않은 변경도 포함됩니다." : ""} JOB·시도 기록·시각화와 채택한 결과는 유지됩니다.</p>
      <h3>변경 파일 · {preview.files.length}개</h3><pre className="tracking-patch">{preview.stats || "현재 구현과 파일 내용이 같습니다."}</pre>{preview.files.length > 0 && <ul>{preview.files.map(file => <li key={file}><code>{file}</code></li>)}</ul>}
      {preview.blockedReason && <p className="tracking-error" role="alert">{preview.blockedReason}</p>}
      <footer><button disabled={restoring} onClick={onClose}>취소</button><button className="tracking-primary" disabled={restoring || !!preview.blockedReason} onClick={onRestore}>{restoring ? <LoaderCircle className="tracking-spin" size={15} /> : <History size={15} />}{restoring ? "보관 후 복원 중…" : "현재 구현 보관 후 복원"}</button></footer>
    </section>
  </div>;
}
