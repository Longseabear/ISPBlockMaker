import {PortNames} from './PortNames';
import {HarnessPanel,HarnessStepEditor,HarnessStatus,harnessStatus} from './Harness';
import {DiagramTabs} from './DiagramTabs';
import {Runs} from './Runs';
import {Interaction} from './Interaction';
import {McpServers} from './McpServers';
import {WorkspaceSearch} from './WorkspaceSearch';
import {AppUpdate} from './AppUpdate';
import {ProjectSkills} from './ProjectSkills';
import {ReportShare} from './ReportShare';
import {BundleOpen} from "./BundleOpen";
import {BundleShare} from "./BundleShare";
import { Viewer } from "./Viewer";
import { terminalClipboardHandler } from "./terminal-clipboard";
import { Documents } from "./Documents";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  type Edge as FlowEdge,
  type Node,
  type NodeProps,
  type Connection,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  ArrowDownToLine,
  ArrowRight,
  Box,
  Braces,
  BookOpen,
  Plug,
  Search,
  Check,
  ChevronDown,
  Circle,
  Code2,
  FileImage,
  FlaskConical,
  GitBranch,
  Image,
  Info,
  Layers3,
  MessageSquarePlus,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  Play,
  Plus,
  RotateCcw,
  Save,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type { Api, Artifact, Block, Project, Presentation } from "./types";
import { JobsBoard } from "./JobsBoard";
import { CodeView } from "./CodeView";
import { WorkspacePicker } from "./WorkspacePicker";
import { VersionControl } from "./VersionControl";
import "@xyflow/react/dist/style.css";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import "./sidebar.css";

type FlowNode = Node<
  { block: Block; highlighted?: boolean; onRequests: (id: string) => void; onDescription: (id: string) => void },
  "block"
>;
function BlockDocuments({id,api,revision}:{id:string;api:Api;revision:number}){
 const [documents,setDocuments]=useState<{name:string;path:string}[]>([]),[opened,setOpened]=useState<{name:string;content:string}|null>(null),[error,setError]=useState('');
 useEffect(()=>{setOpened(null);setDocuments([]);},[id]);
 useEffect(()=>{let live=true;const refresh=()=>{void api<{documents:{name:string;path:string}[]}>('/blocks/'+id+'/documents').then(v=>{if(live){setDocuments(v.documents);setError('');}}).catch(e=>{if(live)setError(String(e));});};refresh();const timer=setInterval(refresh,8000);return()=>{live=false;clearInterval(timer);};},[id,revision,api]);
 if(!documents.length&&!error)return null;
 return <section><h2>추가 문서</h2>{error&&<p role="alert">{error}</p>}<div>{documents.map(d=><button key={d.path} onClick={()=>{void api<{name:string;content:string}>('/blocks/'+id+'/documents?path='+encodeURIComponent(d.path)).then(setOpened).catch(e=>setError(String(e)));}}>{d.name}</button>)}</div>{opened&&<article><h3>{opened.name} <button onClick={()=>setOpened(null)}>닫기</button></h3><div className="reader-prose">{opened.content}</div></article>}</section>;
}

function BlockNode({ data, selected }: NodeProps<FlowNode>) {
  const [execution,setExecution]=useState<{status:string;visit:number}|null>(null);
  useEffect(()=>{const receive=(e:Event)=>{const run=(e as CustomEvent).detail;const attempt=run?.diagramId===data.block.diagramId?run.attempts.filter((a:any)=>a.stepId===data.block.id).at(-1):null;setExecution(attempt?{status:run.staleSteps?.includes(data.block.id)?'stale':attempt.status,visit:attempt.visit}:null);};window.addEventListener('isp-harness-state',receive);return()=>window.removeEventListener('isp-harness-state',receive);},[data.block.id,data.block.diagramId]);
  const b = data.block;
  return (
    <div
      className={`block-node ${selected ? "selected" : ""} ${data.highlighted ? "agent-highlight" : ""} ${execution?.status==='running'?'harness-active':''}`}
    >
      <div className="node-top">
        <span
          className={`node-icon ${b.id === "flat-detection" ? "mint" : ""}`}
        >
          <Box size={17} />
        </span>
        <span>{b.name}</span>
        <button
          className="nodrag nopan node-request-button"
          onDoubleClick={e=>{e.preventDefault();e.stopPropagation();}}
          title={`${b.name} 요청사항 열기`}
          aria-label={`${b.name} 요청사항 열기`}
          onClick={(e) => {
            e.stopPropagation();
            data.onRequests(b.id);
          }}
        >
          <MessageSquarePlus size={16} />
        </button>
        <span className={`node-dot ${b.status}`} />
      </div>
      <button className="nodrag nopan node-description" onDoubleClick={e=>{e.preventDefault();e.stopPropagation();}} aria-label={`${b.name} 설명 열기`} onClick={e=>{e.stopPropagation();data.onDescription(b.id);}}>{b.description || "블록 설명 작성하기"}<span>설명 보기 →</span></button>
      {!!b.jobs?.filter((j) => j.status !== "done").length && (
        <div className="request-badge">
          JOB · {b.jobs.filter((j) => j.status !== "done").length} 남음
        </div>
      )}
      {!!b.userRequests?.filter((r) => r.status === "pending").length && (
        <div className="request-badge">
          User requests ·{" "}
          {b.userRequests.filter((r) => r.status === "pending").length}
        </div>
      )}
      {execution&&<div className={`harness-state ${execution.status}`}>{harnessStatus[execution.status]||execution.status} · {execution.visit}회</div>}
      <div className="node-ports">
        <div>
          {b.inputs.map((p) => (
            <div key={p.id} className="port-row">
              <Handle
                id={p.id}
                type="target"
                position={Position.Left}
                className={p.type}
              />
              <span>{p.name}</span>
            </div>
          ))}
        </div>
        <div>
          {b.outputs.map((p) => (
            <div key={p.id} className="port-row right">
              <span>{p.name}</span>
              <Handle
                id={p.id}
                type="source"
                position={Position.Right}
                className={p.type}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="node-bottom">
        <span>{b.harnessStep?({agent:"에이전트",run:"Run 검증",manual:"사용자 확인"}[b.harnessStep.kind]):b.status === "implemented" ? "IMPLEMENTED" : "DRAFT"}</span>
        <span>{b.harnessStep?(b.harnessStep.phase||b.id):Object.keys(b.parameters).length+" params"}</span>
      </div>
    </div>
  );
}
const nodeTypes = { block: BlockNode };

const emptyContract = {
  inputs: "",
  outputs: "",
  notes: "",
  dataFormat: "",
  boundaries: "",
  numerics: "",
  steps: "",
  validation: "",
  acceptance: "",
};

type EditControls = {save:()=>Promise<boolean>;discard:()=>void};
function Inspector({
  project,
  block,
  revision,
  api,
  notify,
  onDirty,
  controls,
  artifacts,
  onResult,
  requestFocus,
  descriptionFocus,
  global = false,
  reading = false,
  onBack,
  visible = false,
  onViewportResize,
  detailSize,
  setDetailSize,
}: {
  detailSize: number;
  setDetailSize: React.Dispatch<React.SetStateAction<number>>;
  onViewportResize?: () => void;
  visible?: boolean;
  reading?: boolean;
  onBack?: () => void;
  controls: React.RefObject<EditControls | null>;
  global?: boolean;
  requestFocus?: number;
  descriptionFocus?: number;
  artifacts: Artifact[];
  onResult: (id: string) => void;
  block: Block;
  project: Project;
  revision: number;
  api: Api;
  notify: (s: string) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const detailRef=useRef<HTMLElement>(null);
  const resizing=useRef(false);
  useEffect(()=>{
    if(!reading || !visible)return;
    const flow=detailRef.current?.parentElement?.querySelector('.flow-wrap');
    if(!flow)return;
    let frame=0;
    const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>onViewportResize?.());});observer.observe(flow);
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape' && !document.querySelector('dialog[open]'))onBack?.();};
    window.addEventListener('keydown',escape);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('keydown',escape);};
  },[reading,visible,block.id]);
  const [draft, setDraft] = useState(block);
  const [params, setParams] = useState(
    JSON.stringify(block.parameters, null, 2),
  );
  const [ports, setPorts] = useState(
    JSON.stringify({ inputs: block.inputs, outputs: block.outputs }, null, 2),
  );
  const [baseRevision, setBaseRevision] = useState(revision);
  const [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("spec");
  const [editing, setEditing] = useState(false);
  useEffect(()=>{if(descriptionFocus && !dirty)setEditing(false);},[descriptionFocus]);
  useEffect(()=>{if(descriptionFocus)setTab("spec");},[descriptionFocus]);
  const [newRequest, setNewRequest] = useState("");
  const requestInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (requestFocus) {setTab("requests");setEditing(true);}
  }, [requestFocus]);
  useEffect(() => {
    if (tab === "requests" && requestFocus) requestInput.current?.focus();
  }, [tab, requestFocus]);
  useEffect(() => {
    if (!dirty) {
      undoStack.current=[];
      setNewRequest("");
      setDraft(block);
      setParams(JSON.stringify(block.parameters, null, 2));
      setPorts(
        JSON.stringify(
          { inputs: block.inputs, outputs: block.outputs },
          null,
          2,
        ),
      );
      setBaseRevision(revision);
    }
  }, [block, revision, dirty]);
  const undoStack = useRef<{draft:Block;params:string;ports:string;newRequest:string}[]>([]);
  const saveLock = useRef(false);
  function discard() {undoStack.current=[];setDirty(false);onDirty(false);}
  function undo() {const previous=undoStack.current.pop();if(!previous)return;setDraft(previous.draft);setParams(previous.params);setPorts(previous.ports);setNewRequest(previous.newRequest);const remains=undoStack.current.length>0;setDirty(remains);onDirty(remains);}
  useEffect(()=>{if(block.harnessStep && tab!=="requests" && tab!=="results")return;controls.current={save,discard};const keyboard=(e:KeyboardEvent)=>{
    if (!(e.ctrlKey||e.metaKey)||e.altKey||e.isComposing) return;
    const target=e.target as HTMLElement;
    if(target.closest('.xterm,[data-unsaved-dialog]'))return;
    if(e.key.toLowerCase()==='s'){e.preventDefault();if(dirty&&!saving)void save();}
    if(e.key.toLowerCase()==='z'&&!e.shiftKey&&!target.closest('input,textarea,[contenteditable=true]')){e.preventDefault();if(!saving)undo();}
  };window.addEventListener('keydown',keyboard);return()=>{controls.current=null;window.removeEventListener('keydown',keyboard);};});
  function mark() {
    undoStack.current.push({draft:structuredClone(draft),params,ports,newRequest});
    if(undoStack.current.length>100)undoStack.current.shift();
    setDirty(true);
    onDirty(true);
  }
  function edit(key: keyof Block, value: string | number) {
    mark();
    setDraft((current) => ({ ...current, [key]: value }));
  }
  async function save() {
    if(saveLock.current)return false;
    if(!dirty)return true;
    saveLock.current=true;
    setSaving(true);
    try {
      const portData = JSON.parse(ports);
      await api(
        global ? "/global" : `/blocks/${block.id}`,
        {
          revision: baseRevision,
          patch: {
            ...(global ? {overview: {description: draft.description, detail: draft.detail || "", entryPoint: draft.implementation, agentNotes: draft.principle}} : {}),
            name: draft.name,
            description: draft.description,
            detail: draft.detail || "",
            userRequests: [
              ...(draft.userRequests || []),
              ...(newRequest.trim()
                ? [
                    {
                      id: crypto.randomUUID(),
                      text: newRequest.trim(),
                      status: "pending",
                      createdAt: new Date().toISOString(),
                      resolution: "",
                    },
                  ]
                : []),
            ],
            principle: draft.principle,
            implementation: draft.implementation,
            implementationSymbol: draft.implementationSymbol || "",
            implementationLine: draft.implementationLine || 0,
            agentContract: draft.agentContract || emptyContract,
            status: draft.status,
            parameters: JSON.parse(params),
            inputs: portData.inputs,
            outputs: portData.outputs,
          },
        },
        "PATCH",
      );
      setDirty(false);
      onDirty(false);
      undoStack.current=[];
      notify(global ? "전체 그래프 정보를 저장했습니다." : "블록을 저장했습니다.");
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    } finally {
      saveLock.current=false;
      setSaving(false);
    }
  }
  async function deleteJob(id: string) {
    if (dirty) return notify("작성 중인 요청을 먼저 저장하거나 취소하세요.");
    setSaving(true);
    try {
      await api(
        global ? `/global/jobs/${id}` : `/blocks/${block.id}/jobs/${id}`,
        { revision },
        "DELETE",
      );
      notify("JOB을 삭제했습니다.");
    } catch (error) {
      notify(String(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      {reading && <div className="detail-height-resizer" role="separator" aria-label="그래프와 상세 높이 조절" aria-orientation="horizontal" aria-valuemin={25} aria-valuemax={70} aria-valuenow={detailSize} tabIndex={0}
        onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();setDetailSize(value=>Math.max(25,Math.min(70,value+(event.key==='ArrowUp'?5:-5))));}}}
        onDoubleClick={()=>setDetailSize(40)}
        onPointerDown={event=>{if(event.button!==0)return;resizing.current=true;event.currentTarget.setPointerCapture(event.pointerId);}}
        onPointerMove={event=>{if(!resizing.current)return;const rect=event.currentTarget.parentElement!.getBoundingClientRect();setDetailSize(Math.max(25,Math.min(70,100*(rect.bottom-event.clientY)/rect.height)));}}
        onPointerUp={()=>{resizing.current=false;}} onPointerCancel={()=>{resizing.current=false;}} onLostPointerCapture={()=>{resizing.current=false;}}/>}
    <section ref={detailRef} tabIndex={-1} aria-label={reading ? `${block.name} block details` : undefined} className={`inspector ${reading ? "detail-page" : ""}`} style={reading ? {flexBasis:`${detailSize}%`} : undefined}>
      {reading && <div className="detail-navigation"><Box size={16}/><span><strong>{block.name}</strong>{dirty&&<small>Unsaved</small>}</span>
        <button hidden={!!block.harnessStep} onClick={()=>{setTab("spec");setEditing(v=>!v);}}>{editing && tab!=="requests" && tab!=="results" ? "Preview" : "Edit"}</button>
        {block.harnessStep&&<button aria-pressed={detailSize>=65} onClick={()=>setDetailSize(detailSize>=65?40:65)}>{detailSize>=65?"기본 크기":"크게 편집"}</button>}
        <button aria-label="Close block details" title="상세 접기 (Esc)" onClick={onBack}><X size={18}/></button>
      </div>}
      {reading && <nav className="detail-sections" aria-label="Block detail sections">
        <button disabled={dirty} aria-pressed={tab!=="requests" && tab!=="results"} onClick={()=>{setTab("spec");setEditing(false);}}>{block.harnessStep?"단계 설정":"설명"}</button>
        <button disabled={dirty} aria-pressed={tab==="requests"} onClick={()=>setTab("requests")}>Requests / JOBs <span>{(draft.userRequests||[]).filter(r=>r.status==="pending").length + (block.jobs||[]).filter(j=>j.status!=="done").length}</span></button>
        {!global && <button disabled={dirty} aria-pressed={tab==="results"} onClick={()=>setTab("results")}>Results</button>}
      </nav>}
      {block.harnessStep && tab!=="requests" && tab!=="results" ? <HarnessStepEditor block={block} project={project} api={api} controls={controls} onDirty={value=>{setDirty(value);onDirty(value);}}/> : reading && !editing && tab!=="requests" && tab!=="results" ? <article className="block-reader">
        <header><div className="reader-eyebrow">{global ? "PROJECT OVERVIEW" : "BLOCK"} · {draft.id}</div><h1>{draft.name}</h1><span className={`status ${draft.status}`}>{draft.status}</span><p className="reader-summary">{draft.description || "아직 요약이 없습니다."}</p></header>
        <section><h2>설명</h2><div className="reader-prose">{draft.detail || "아직 상세 설명이 없습니다. Edit에서 이 블록의 역할과 동작을 작성할 수 있습니다."}</div></section>

        {!global && <BlockDocuments id={block.id} api={api} revision={revision}/>}
        {!global && <section><h2>Inputs & Outputs</h2><div className="reader-ports">{([['Inputs',draft.inputs],['Outputs',draft.outputs]] as const).map(([label,ports])=><div key={label}><h3>{label}</h3>{ports.length ? ports.map(port=><div className="reader-port" key={port.id}><strong>{port.name}</strong><code>{port.type}</code></div>) : <p className="reader-muted">등록된 포트 없음</p>}</div>)}</div></section>}
        {!!Object.keys(draft.parameters).length && <section><h2>Parameters</h2><dl className="reader-parameters">{Object.entries(draft.parameters).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></section>}
        {draft.implementation && <section><h2>Implementation</h2><code className="reader-path">{draft.implementation}{draft.implementationSymbol ? ` · ${draft.implementationSymbol}` : ''}</code></section>}
        {(draft.principle || Object.values(draft.agentContract || {}).some(Boolean)) && <details className="reader-contract"><summary>에이전트 설명 · 상세 계약</summary>{draft.principle && <p className="reader-prose">{draft.principle}</p>}{Object.entries(draft.agentContract || {}).filter(([,value])=>value).map(([key,value])=><section key={key}><h3>{key}</h3><div className="reader-prose">{value}</div></section>)}</details>}

      </article> : <>

      <div className="panel-title" hidden={reading}>
        <span>
          <Box size={15} /> {global ? "GRAPH OVERVIEW" : "BLOCK INSPECTOR"}
        </span>
        <span className="subtle">{dirty ? "Unsaved" : "Saved"}</span>
      </div>
      <div className="inspector-heading" hidden={reading}>
        <span className="eyebrow">{block.id}</span>
        <h2>{block.name}</h2>
        <span className={`status ${block.status}`}>
          <Circle size={7} fill="currentColor" />
          {block.status}
        </span>
      </div>
      <div className="tabs" hidden={reading && (tab==="requests" || tab==="results")}>
        <button
          className={tab === "requests" ? "active" : ""}
          onClick={() => setTab("requests")}
        >
          User requests (
          {
            (draft.userRequests || []).filter((r) => r.status === "pending")
              .length
          }
          )
        </button>
        <button
          className={tab === "spec" ? "active" : ""}
          onClick={() => setTab("spec")}
        >
          사용자 설명
        </button>
        <button
          style={global ? {display: "none"} : undefined}
          className={tab === "ports" ? "active" : ""}
          onClick={() => setTab("ports")}
        >
          Shared I/O
        </button>
        <button
          className={tab === "agent" ? "active" : ""}
          onClick={() => setTab("agent")}
        >
          에이전트 설명
        </button>
        <button
          style={global ? {display: "none"} : undefined}
          className={tab === "results" ? "active" : ""}
          onClick={() => setTab("results")}
        >
          Results
        </button>
      </div>
      <div className="inspector-form">
        {tab === "requests" ? (
          <div className="request-list">
            <p className="hint">
              원하는 내용을 평문으로 남기세요. 에이전트가 요청을 JOB으로 나누고
              하나씩 처리합니다.
            </p>
            <label hidden={reading}>
              요청사항
              <textarea
                ref={requestInput}
                rows={5}
                value={newRequest}
                placeholder="예: threshold 조절을 추가하고, 경계 처리를 확인한 다음 전후 결과도 보여줘."
                onChange={(e) => {
                  mark();
                  setNewRequest(e.target.value);
                }}
              />
            </label>
            <h3 className="jobs-heading">
              JOBs ·{" "}
              {(block.jobs || []).filter((j) => j.status !== "done").length}{" "}
              남음
            </h3>
            {!(block.jobs || []).length && (
              <p className="hint">
                아직 JOB이 없습니다. 저장한 요청을 에이전트가 분해하면 여기에
                표시됩니다.
              </p>
            )}
            {(block.jobs || []).map((job) => (
              <article className={`job-card ${job.status}`} key={job.id}>
                <div className="job-heading">
                  <strong>{job.title}</strong>
                  <button
                    className="icon-button"
                    aria-label={`${job.title} JOB 삭제`}
                    title="JOB 삭제"
                    disabled={saving || dirty}
                    onClick={() => deleteJob(job.id)}
                  >
                    <X size={15} />
                  </button>
                </div>
                <small className="job-status">
                  {job.status === "pending"
                    ? "대기"
                    : job.status === "in_progress"
                      ? "진행 중"
                      : "✓ 완료"}
                </small>
                {job.description && <p>{job.description}</p>}
                {job.resolution && (
                  <div className="request-resolution">
                    <strong>처리 내역</strong>
                    <p>{job.resolution}</p>
                  </div>
                )}
                <details>
                  <summary>{job.sourceRequestId || job.sourceRequestIds?.length ? "요청 원문" : "직접 등록된 JOB"}</summary>
                  <p>
                    {block.userRequests?.filter(
                      (r) => r.id === job.sourceRequestId || job.sourceRequestIds?.includes(r.id),
                    ).map(r=>r.text).join("\n\n") || (job.sourceRequestId || job.sourceRequestIds?.length ? "원문이 삭제되었습니다." : "메모 변환 없이 직접 등록된 작업입니다.")}
                  </p>
                </details>
                {!!job.sourceJobs?.length&&<details><summary>분할·병합 이력 ({job.sourceJobs.length})</summary>{job.sourceJobs.map(source=><div key={source.id}><strong>{source.title}</strong><small> · {source.id}</small><p style={{whiteSpace:'pre-wrap'}}>{source.description}</p>{source.resolution&&<p>{source.resolution}</p>}</div>)}</details>}
              </article>
            ))}
            <h3 className="jobs-heading">저장된 요청</h3>
            {!(draft.userRequests || []).length && (
              <p className="hint">아직 요청 메모가 없습니다.</p>
            )}
            {(draft.userRequests || []).map((memo, index) => (
              <article className={`request-memo ${memo.status}`} key={memo.id}>
                <div className="request-meta">
                  <strong>
                    {memo.status === "pending"
                      ? "JOB 변환 대기"
                      : memo.jobIds?.length
                        ? "JOB으로 변환됨"
                        : "처리 완료"}
                  </strong>
                  <small>{new Date(memo.createdAt).toLocaleString()}</small>
                </div>
                <label>
                  요청 {index + 1}
                  <textarea
                    rows={4}
                    value={memo.text}
                    readOnly={memo.status === "consumed"}
                    placeholder="예: threshold를 조절할 수 있게 하고 전후 결과를 비교해줘"
                    onChange={(e) => {
                      mark();
                      setDraft((current) => ({
                        ...current,
                        userRequests: current.userRequests?.map((r) =>
                          r.id === memo.id ? { ...r, text: e.target.value } : r,
                        ),
                      }));
                    }}
                  />
                </label>
                {memo.status === "consumed" && (
                  <div className="request-resolution">
                    <strong>처리 내역</strong>
                    <p>{memo.resolution}</p>
                    <small>
                      {memo.consumedAt &&
                        new Date(memo.consumedAt).toLocaleString()}
                    </small>
                  </div>
                )}
                <div className="request-actions">
                  {memo.status === "consumed" && !memo.jobIds?.length ? (
                    <button
                      onClick={() => {
                        mark();
                        setDraft((current) => ({
                          ...current,
                          userRequests: current.userRequests?.map((r) =>
                            r.id === memo.id
                              ? {
                                  ...r,
                                  status: "pending",
                                  consumedAt: undefined,
                                  resolution: "",
                                }
                              : r,
                          ),
                        }));
                      }}
                    >
                      다시 미처리로
                    </button>
                  ) : memo.status === "pending" ? (
                    <button
                      onClick={() => {
                        mark();
                        setDraft((current) => ({
                          ...current,
                          userRequests: current.userRequests?.filter(
                            (r) => r.id !== memo.id,
                          ),
                        }));
                      }}
                    >
                      메모 삭제
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
            <p className="hint">
              작성 후 Save changes로 저장하세요. 터미널에서 “Block 메모한 거
              전부 구현해줘”라고 요청할 수 있습니다.
            </p>
          </div>
        ) : global && tab === "agent" ? (
          <>
            <p className="hint">이 프로젝트를 이해하고 작업하는 에이전트를 위한 설명입니다. 전체 그래프 context에 전달되며 코드와 함께 버전 관리됩니다.</p>
            <label>프로젝트 에이전트 설명<textarea rows={18} maxLength={30000} value={draft.principle} onChange={e=>edit("principle",e.target.value)} placeholder="프로젝트의 목적, 전체 입출력, 코드 진입점과 구조, 중요한 제약, 검증 방법, 미해결 사항 등을 자유롭게 기록하세요. 영어·수식·의사 코드 등 에이전트가 정확히 이해하기 좋은 형식도 가능합니다." /></label>
          </>
        ) : global ? (
          <>
            <p className="hint">전체 파이프라인의 목적과 실행 방법을 기록합니다. 코드와 함께 Git으로 관리되며 에이전트 context에도 전달됩니다.</p>
            <label>Graph Description · 목적 / 요약<textarea rows={3} maxLength={12000} value={draft.description} onChange={e=>edit("description",e.target.value)} placeholder="무엇을 입력받아 어떤 결과를 만드는 그래프인가요?" /></label>
            <label>Graph Detail · 흐름 / 중요 사항<textarea rows={8} maxLength={30000} value={draft.detail || ""} onChange={e=>edit("detail",e.target.value)} placeholder="전체 처리 흐름, 주요 설계 결정, 제약과 주의사항" /></label>
            <label>Entry point · 진입점 / 실행 방법<textarea rows={5} maxLength={12000} value={draft.implementation} onChange={e=>edit("implementation",e.target.value)} placeholder="workspace 상대 경로, 함수 또는 클래스, 실행 명령, 필요한 입력" /></label>

          </>
        ) : tab === "spec" ? (
          <>
            <label>
              Block name
              <input
                value={draft.name}
                onChange={(e) => edit("name", e.target.value)}
              />
            </label>
            <label>
              Node Description · 카드 요약
              <textarea
                rows={3}
                value={draft.description}
                onChange={(e) => edit("description", e.target.value)}
              />
            </label>
            <p className="hint">그래프 카드에 표시할 역할만 1–2문장으로 적으세요. 자세한 설명은 아래에 작성합니다.</p>
            <label>
              Node Detail · 사용자 상세 설명
              <textarea rows={10} value={draft.detail || ""} onChange={e=>edit("detail",e.target.value)} placeholder="동작 설명, 사용 예, 파라미터의 의미, 해석 방법과 주의사항"/>
            </label>
            <label>
              Status
              <select
                value={draft.status}
                onChange={(e) => edit("status", e.target.value)}
              >
                <option value="draft">Draft</option>
                <option value="implemented">Implemented</option>
              </select>
            </label>
          </>
        ) : tab === "ports" ? (
          <>
            <p className="hint">
              사람과 에이전트가 함께 사용하는 원본 명세입니다.
            </p>
            <label>
              Parameters · JSON
              <textarea
                className="mono"
                rows={8}
                value={params}
                onChange={(e) => {
                  mark();
                  setParams(e.target.value);
                }}
              />
            </label>
            <PortNames value={ports} onChange={value=>{mark();setPorts(value);}}/>
            <label>
              Input / output ports · JSON
              <textarea
                className="mono"
                rows={15}
                value={ports}
                onChange={(e) => {
                  mark();
                  setPorts(e.target.value);
                }}
              />
            </label>
            <p className="hint">
              type: image / mask / signal. 연결된 포트는 간선을 먼저 삭제한 뒤
              변경하세요.
            </p>
          </>
        ) : tab === "agent" ? (
          <>
            <p className="hint">
              에이전트 전용 구현 지식입니다. 영어·수식·의사코드 등 정확한 구현과 검증에 유리한 언어와 구조를 사용합니다. 사용자용 설명은 Node Detail에 작성하세요. 빈 항목은 미정입니다.
            </p>
            {([['inputs','Input 설명','입력별 의미, 생성 주체, shape·단위·범위, 전제조건과 예시'],['outputs','Output 설명','출력별 의미, 입력과의 관계, shape·단위·범위, 해석 방법과 예시']] as const).map(([key,label,placeholder])=><label key={key}>{label}<textarea rows={5} value={draft.agentContract?.[key] || ""} placeholder={placeholder} onChange={e=>{mark();setDraft(current=>({...current,agentContract:{...emptyContract,...current.agentContract,[key]:e.target.value}}));}}/></label>)}
            <p className="hint">포트 ID로 대상을 구분해 자유롭게 설명하세요. 실제 포트·연결·파라미터는 Shared I/O가 기준입니다.</p>
            <label>
              Agent algorithm · 구현 원리
              <textarea
                rows={6}
                value={draft.principle}
                onChange={(e) => edit("principle", e.target.value)}
              />
            </label>
            <label>
              Implementation <span className="subtle">workspace relative</span>
              <input
                className="mono"
                value={draft.implementation}
                onChange={(e) => edit("implementation", e.target.value)}
                placeholder="blocks/filter.cpp 또는 blocks/filter.py"
              />
            </label>

            <label>
              Entry symbol · 시작 함수 / 클래스
              <input
                value={draft.implementationSymbol || ""}
                onChange={(e) => edit("implementationSymbol", e.target.value)}
                placeholder="예: flat_detection 또는 Denoiser.process"
              />
            </label>
            <label>
              Start line · 코드 시작 행 (심볼보다 우선)
              <input type="number" min={1} max={10000000} step={1}
                value={draft.implementationLine || ""}
                onChange={e => edit("implementationLine", e.target.value ? Math.max(1, Math.min(10000000, Math.trunc(Number(e.target.value) || 1))) : 0)}
                placeholder="예: 100 · 비워 두면 시작 심볼 검색" />
            </label>
            {(
              [
                [
                  "dataFormat",
                  "Data format / shape",
                  "예: float32, H × W, [0, 1], grayscale",
                ],
                [
                  "boundaries",
                  "Boundary handling",
                  "예: 가장자리 clamp, 작은 영상 처리 규칙",
                ],
                [
                  "numerics",
                  "Precision / rounding",
                  "예: 부동소수점, saturation, 반올림 규칙",
                ],
                [
                  "steps",
                  "Implementation steps",
                  "처리 순서, 수정할 함수, 의사코드",
                ],
                [
                  "validation",
                  "Validation commands",
                  "실행할 명령과 테스트 데이터 경로",
                ],
                ["acceptance", "Acceptance criteria", "완료 조건과 허용 오차"],
                ["notes", "자유 메모 · Agent notes", "분류되지 않는 구현 지식, 설계 의도, 대안과 트레이드오프, 미해결 질문, 주의사항. 자유 형식으로 작성하세요."],
              ] as const
            ).map(([key, label, placeholder]) => (
              <label key={key}>
                {label}
                <textarea
                  rows={key === "notes" ? 8 : 3}
                  value={(draft.agentContract || emptyContract)[key] || ""}
                  placeholder={placeholder}
                  onChange={(e) => {
                    mark();
                    setDraft((current) => ({
                      ...current,
                      agentContract: {
                        ...emptyContract,
                        ...current.agentContract,
                        [key]: e.target.value,
                      },
                    }));
                  }}
                />
              </label>
            ))}
          </>
        ) : (
          <div className="block-results">
            <p className="hint">이 블록에 등록된 실행 결과입니다.</p>
            {artifacts
              .filter((a) => a.blockId === block.id)
              .reverse()
              .map((a) => (
                <button key={a.id} onClick={() => onResult(a.id)}>
                  <FileImage size={15} />
                  <span>
                    {a.title}
                    <small>
                      revision {a.revision} ·{" "}
                      {new Date(a.createdAt).toLocaleString()}
                    </small>
                  </span>
                </button>
              ))}
            {!artifacts.some((a) => a.blockId === block.id) && (
              <p>아직 등록된 결과물이 없습니다.</p>
            )}
          </div>
        )}
      </div>
      <div className="inspector-footer" hidden={reading}><button title="마지막 편집 되돌리기 (Ctrl+Z)" disabled={!dirty||saving||!undoStack.current.length} onClick={undo}>되돌리기</button>
        <button
          className="icon-button"
          title="변경 취소 / 최신 상태 불러오기"
          onClick={() => {
            setDirty(false);
            onDirty(false);
          }}
          disabled={!dirty}
        >
          <RotateCcw size={15} />
        </button>
        <button className="primary" disabled={!dirty || saving} onClick={save}>
          <Save size={14} />
          {saving ? "Saving…" : tab==="requests" ? (newRequest.trim() ? "요청 등록 / 변경 저장" : "요청 변경 저장") : "Save changes"}
        </button>
      </div>
      </>}
      {reading && !block.harnessStep && <div className="detail-request-compose"><textarea aria-label="블록 요청 입력" rows={2} value={newRequest} placeholder="이 블록에 요청 남기기…" onChange={event=>{mark();setNewRequest(event.target.value);}}/><button className="primary" disabled={saving || !dirty} onClick={save}>{saving ? "저장 중…" : newRequest.trim() ? "요청 등록" : "변경 저장"}</button></div>}
    </section>
    </>
  );
}

type TerminalSession = {sessionId: string; agent: string; blockId: string};

function TerminalPanel(props: {
  launch?: TerminalSession | null;
  token: string; block: Block; api: Api; onState: (state: Project) => void;
  onPresent: (presentation: Presentation) => void; notify: (s: string) => void;
}) {
  const [tabs, setTabs] = useState<TerminalSession[]>([]);
  const [selectedTab, setSelectedTab] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [closing, setClosing] = useState('');
  const callbacks = useRef(props);
  callbacks.current = props;
  // Keep graph/agent updates alive even after the last terminal tab is closed.
  const noTabs = tabs.length === 0;
  useEffect(() => {
    if (!noTabs) return;
    let disposed = false;
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    function connect() {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${props.token}`);
      socket.onmessage = event => {
        if (disposed) return;
        const message = JSON.parse(event.data);
        if (message.type === 'state') callbacks.current.onState(message.state);
        if (message.type === 'present') { callbacks.current.onState(message.state); callbacks.current.onPresent(message.presentation); }
        if (message.type === 'workspace-changed') { disposed = true; callbacks.current.notify('작업 폴더 또는 구현 버전이 변경되었습니다. 페이지를 새로고침하세요.'); }
      };
      socket.onclose = () => { if (!disposed) timer = setTimeout(connect, 2000); };
    }
    connect();
    return () => { disposed = true; clearTimeout(timer); socket.close(); };
  }, [noTabs, props.token]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    props.api<TerminalSession[]>('/terminals').then(sessions => {
      if (cancelled) return;
      const restored = sessions.length ? sessions : [{sessionId: crypto.randomUUID(), agent: 'shell', blockId: props.block.id}];
      setTabs(restored);
      setLoaded(true);
      let saved = '';
      try { saved = localStorage.getItem('isp-terminal-active:' + props.token) || ''; } catch {}
      setSelectedTab(restored.some(s => s.sessionId === saved) ? saved : restored[0].sessionId);
    }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [props.token, props.api, retry]);
  useEffect(() => { try { if(selectedTab) localStorage.setItem('isp-terminal-active:' + props.token, selectedTab); } catch {} }, [selectedTab, props.token]);
  useEffect(()=>{if(!props.launch||!loaded)return;const session=props.launch;setTabs(t=>t.some(x=>x.sessionId===session.sessionId)?t:[...t,session]);setSelectedTab(session.sessionId);},[props.launch,loaded]);
  async function closeTab(id: string) {
    setClosing(id);
    try {
      await props.api('/terminals/' + id, undefined, 'DELETE');
      const remaining = tabs.filter(t => t.sessionId !== id);
      setTabs(remaining);
      if(selectedTab === id) setSelectedTab(remaining[0]?.sessionId || '');
      try { localStorage.removeItem('isp-terminal:' + props.token + ':' + id); } catch {}
    } catch(e) { props.notify(String(e)); }
    finally { setClosing(''); }
  }
  return <section className="terminal-pane terminal-panel">
    <div className="terminal-tabs" role="tablist" aria-label="터미널 세션">
      {tabs.map((tab, i) => <div className="terminal-tab" key={tab.sessionId}>
        <button role="tab" id={'tab-' + tab.sessionId} aria-controls={'pane-' + tab.sessionId} aria-selected={selectedTab === tab.sessionId}
          onClick={() => setSelectedTab(tab.sessionId)} title={tab.blockId}>{tab.agent === 'shell' ? 'Shell' : tab.agent} {i + 1}</button>
        <button aria-label={`터미널 ${i + 1} 종료 및 닫기`} title="프로세스 종료 및 탭 닫기" disabled={!!closing}
          onClick={() => closeTab(tab.sessionId)}><X size={12}/></button>
      </div>)}
      <button aria-label="새 터미널" title="새 터미널 (최대 8개)" disabled={!loaded || tabs.length >= 8 || !!error || !!closing}
        onClick={() => { const tab = {sessionId: crypto.randomUUID(), agent: 'shell', blockId: props.block.id}; setTabs(current => [...current, tab]); setSelectedTab(tab.sessionId); }}><Plus size={14}/> 터미널</button>
    </div>
    {error && <div role="alert">{error} <button onClick={() => setRetry(n => n + 1)}>다시 연결</button></div>}
    {tabs.map((tab, i) => <div key={tab.sessionId} id={'pane-' + tab.sessionId} role="tabpanel" aria-labelledby={'tab-' + tab.sessionId}
      className="terminal-tab-content" hidden={selectedTab !== tab.sessionId}>
      <TerminalPane {...props} session={tab} visible={selectedTab === tab.sessionId} eventLeader={i === 0}
        onAgent={agent => setTabs(current => current.map(t => t.sessionId === tab.sessionId ? {...t, agent} : t))}/>
    </div>)}
  </section>;
}

function TerminalPane({
  session,
  visible,
  eventLeader,
  onAgent,
  token,
  block,
  onState,
  onPresent,
  notify,
}: {
  session: TerminalSession;
  visible: boolean;
  eventLeader: boolean;
  onAgent: (agent: string) => void;
  token: string;
  block: Block;
  onState: (state: Project) => void;
  onPresent: (presentation: Presentation) => void;
  notify: (s: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    term = useRef<XTerminal | null>(null),
    socket = useRef<WebSocket | null>(null),
    fit = useRef<FitAddon | null>(null);
  const [online, setOnline] = useState(false),
    [running, setRunning] = useState(false),
    [starting, setStarting] = useState(false);
  const [agent, setAgent] = useState("shell"),
    [pinned, setPinned] = useState("");
  const stateCallback = useRef(onState);
  stateCallback.current = onState;
  const presentationCallback = useRef(onPresent);
  presentationCallback.current = onPresent;
  const notifyCallback = useRef(notify);
  notifyCallback.current = notify;
  const active = useRef<{
    sessionId: string;
    agent: string;
    blockId: string;
  } | null>(null);
  const runningRef = useRef(false);
  const autoStarted = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const leaderRef = useRef(eventLeader);
  leaderRef.current = eventLeader;
  const agentCallback = useRef(onAgent);
  agentCallback.current = onAgent;
  useEffect(() => { if (visible) { fit.current?.fit(); term.current?.focus(); } }, [visible]);
  useEffect(() => {
    const storageKey = 'isp-terminal:' + token + ':' + session.sessionId;
    active.current = session;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && /^[0-9a-f-]{36}$/i.test(saved.sessionId) && ['shell','codex','claude'].includes(saved.agent) && typeof saved.blockId === 'string') active.current = saved;
    } catch {}
    const remember = () => { try { if(active.current) localStorage.setItem(storageKey,JSON.stringify(active.current)); else localStorage.removeItem(storageKey); } catch {} };
    runningRef.current = false;
    const terminal = new XTerminal({
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 12,
      cursorBlink: true,
      scrollback: 3000,
      theme: {
        background: "#101419",
        foreground: "#c6ced8",
        cursor: "#77d9b8",
        selectionBackground: "#344c55",
      },
    });
    const fitter = new FitAddon();
    terminal.loadAddon(fitter);
    terminal.open(host.current!);
    terminal.attachCustomKeyEventHandler(terminalClipboardHandler({
      selection: () => terminal.getSelection(),
      copySelection: () => document.execCommand("copy"),
      selectAll: () => terminal.selectAll(),
      writeText: async text => {
        if(!navigator.clipboard?.writeText)throw new Error("Clipboard API unavailable");
        await navigator.clipboard.writeText(text);
      },
      readText: async () => {
        if (!navigator.clipboard?.readText) throw new Error("Clipboard API unavailable");
        return navigator.clipboard.readText();
      },
      paste: text => terminal.paste(text),
      ready: () => runningRef.current && socket.current?.readyState === WebSocket.OPEN,
      error: message => notifyCallback.current(message),
    }));
    fitter.fit();
    term.current = terminal;
    fit.current = fitter;
    terminal.writeln(
      "\x1b[38;2;112;212;179mISP BLOCK MAKER\x1b[0m  /  local terminal",
    );
    terminal.writeln("Windows 터미널은 cmd로 실행됩니다. PowerShell에서 명령이 실패하면 cmd /d 를 입력한 뒤 다시 실행하세요.");
    terminal.writeln(
      "Read context: isp context   ·   Generate a visualization: isp demo\r\n",
    );
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    function send(message: unknown) {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify(message));
    }
    function connect() {
      if (disposed) return;
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?token=${token}`,
      );
      socket.current = ws;
      ws.onopen = () => {
        setOnline(true);
        if (!autoStarted.current) {
          autoStarted.current = true;
          active.current ||= {
            sessionId: crypto.randomUUID(),
            agent: "shell",
            blockId: block.id,
          };
          setStarting(true);
        }
        if (active.current) {
          remember();
          runningRef.current = false;
          setStarting(true);
          send({ type: "start", ...active.current });
        }
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (disposed) return;
        if (message.type === "detached") {
          active.current = null;
          runningRef.current = false;
          setRunning(false); setStarting(false);
          terminal.writeln('\r\n[다른 탭에 터미널이 연결되었습니다. Reconnect로 다시 연결하세요.]');
          return;
        }
        if (message.type === "workspace-changed") {
          if (message.bundleRestore?.backupPath) {
            sessionStorage.setItem("isp-last-bundle-backup", JSON.stringify(message.bundleRestore));
          }
          active.current = null; remember(); runningRef.current = false;
          disposed = true;
          setOnline(false);
          setRunning(false);
          terminal.writeln(
            "\r\n작업 폴더 또는 구현 버전이 변경되었습니다. 작성 중인 내용을 보관한 후 페이지를 새로고침하세요.",
          );
          return;
        }
        if (message.type === "state" && leaderRef.current) stateCallback.current(message.state);
        if (message.type === "present" && leaderRef.current) {
          stateCallback.current(message.state);
          presentationCallback.current(message.presentation);
        }
        if (message.type === "output") terminal.write(message.data);
        if (message.type === "started") {
          runningRef.current = false;
          terminal.reset();
          if(message.cols && message.rows) terminal.resize(message.cols,message.rows);
          setAgent(message.agent);
          agentCallback.current(message.agent);
          setPinned(message.blockId);
          remember();
          terminal.write(message.buffer || '', () => {
            if(disposed || socket.current !== ws || ws.readyState !== WebSocket.OPEN || !active.current) return;
            setStarting(false); setRunning(true); runningRef.current = true;
            if (visibleRef.current) fitter.fit();
            send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
            if (visibleRef.current) terminal.focus();
          });
        }
        if (message.type === "exit") {
          terminal.writeln(`\r\n[Session ended · exit ${message.exitCode}]`);
          setRunning(false);
          setStarting(false);
          runningRef.current = false;
          active.current = null;
          remember();
        }
        if (message.type === "error") {
          setStarting(false);
          if (!runningRef.current) { active.current = null; remember(); }
          notifyCallback.current(message.error);
        }
      };
      ws.onclose = () => {
        setOnline(false);
        runningRef.current = false;
        if (!disposed) timer = setTimeout(connect, 2000);
      };
    }
    connect();
    const input = terminal.onData((data) => {
      if (active.current && runningRef.current) send({ type: "input", data });
    });
    const resize = new ResizeObserver(() => {
      if (!visibleRef.current || !host.current?.clientWidth || !host.current?.clientHeight) return;
      fitter.fit();
      if (runningRef.current)
        send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
    });
    resize.observe(host.current!);
    return () => {
      disposed = true;
      clearTimeout(timer);
      resize.disconnect();
      input.dispose();
      socket.current?.close();
      terminal.dispose();
    };
  }, [token]);
  function start(nextAgent = agent) {
    if (!online || starting) return;
    active.current = {
      sessionId: session.sessionId,
      agent: nextAgent,
      blockId: block.id,
    };
    try { localStorage.setItem('isp-terminal:' + token + ':' + session.sessionId,JSON.stringify(active.current)); } catch {}
    runningRef.current = false;
    setStarting(true);
    term.current?.reset();
    socket.current?.send(JSON.stringify({ type: "start", ...active.current }));
  }
  return (
    <section className="terminal-pane">
      <div className="terminal-bar">
        <span className="terminal-title">
          <Terminal size={15} /> TERMINAL{" "}
          <span className={`connection-dot ${online ? "online" : ""}`} />
        </span>
        <span className="terminal-context">
          {running ? `Pinned · ${pinned}` : `Next session · ${block.id}`}
        </span>
        <div className="terminal-actions">
          <select
            aria-label="Terminal agent"
            value={agent}
            onChange={(e) => {
              setAgent(e.target.value);
              start(e.target.value);
            }}
            disabled={running || starting}
          >
            <option value="shell">cmd / Shell</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
          </select>
          {running ? (
            <button
              onClick={() =>
                socket.current?.send(JSON.stringify({ type: "stop" }))
              }
              disabled={!online}
            >
              <Square size={12} /> Stop
            </button>
          ) : (
            <button onClick={() => start()} disabled={!online || starting}>
              <Play size={12} />
              {starting ? "Connecting…" : "Reconnect"}
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => term.current?.clear()}
            title="Clear terminal"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="terminal-host" ref={host} />
    </section>
  );
}

function ArtifactInformation({ artifact, revision, relatedArtifacts, onDelete }: {
  artifact: Artifact;
  revision: number;
  relatedArtifacts: Artifact[];
  onDelete: (artifacts: Artifact[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as globalThis.Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="artifact-info" ref={container} onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as globalThis.Node)) setOpen(false);
    }}>
      <button
        ref={trigger}
        className="artifact-info-trigger"
        title="시각화 정보 및 삭제"
        aria-label="시각화 정보 및 삭제"
        aria-expanded={open}
        aria-controls="artifact-info-popover"
        onClick={() => setOpen(current => !current)}
      ><Info size={16} /></button>
      <section id="artifact-info-popover" className="artifact-info-popover" aria-label="시각화 정보" hidden={!open}>
        <strong>{artifact.title}</strong>
        <dl>
          <dt>블록</dt><dd>{artifact.blockId || "전체"}</dd>
          <dt>버전</dt><dd>r{artifact.revision} · {artifact.revision < revision ? "earlier version" : "current"}</dd>
          <dt>생성 시각</dt><dd>{new Date(artifact.createdAt).toLocaleString()}</dd>
          {artifact.updatedAt&&<><dt>수정 시각</dt><dd>{new Date(artifact.updatedAt).toLocaleString()}</dd></>}
          <dt>형식</dt><dd>{artifact.kind.toUpperCase()}</dd>
        </dl>
        <div className="artifact-info-actions">
          <button onClick={() => { setOpen(false); onDelete([artifact]); }}><Trash2 size={14} /> 이 결과 삭제</button>
          {relatedArtifacts.length > 1 && <button onClick={() => { setOpen(false); onDelete(relatedArtifacts); }}>같은 실행 결과 삭제 ({relatedArtifacts.length})</button>}
        </div>
      </section>
    </div>
  );
}

function App() {
  const [boardMenu,setBoardMenu]=useState<{id:string;x:number;y:number}|null>(null);
  const flowRef = useRef<ReactFlowInstance<FlowNode> | null>(null);
  const boardViewportBeforeDetails=useRef<{diagram:string;viewport:{x:number;y:number;zoom:number}}|null>(null);
  const [detailSize,setDetailSize]=useState(()=>{try{const saved=Number(localStorage.getItem('isp-detail-height'));return saved>=25&&saved<=70?saved:40;}catch{return 40;}});
  useEffect(()=>{try{localStorage.setItem('isp-detail-height',String(detailSize));}catch{}},[detailSize]);
  const [deleteCandidates,setDeleteCandidates]=useState<Artifact[]>([]);
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [deleteError,setDeleteError]=useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspacePicker, setWorkspacePicker] = useState(false);
  const [sidebarWidth,setSidebarWidth]=useState(()=>{try{const n=Number(localStorage.getItem('isp-sidebar-width'));return Number.isFinite(n)&&n>0?Math.max(150,Math.min(420,n)):200;}catch{return 200;}});
  const sidebarDrag=useRef<{x:number;width:number}|null>(null);
  useEffect(()=>{try{localStorage.setItem('isp-sidebar-width',String(sidebarWidth));}catch{}},[sidebarWidth]);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [descriptionTarget,setDescriptionTarget]=useState<{id:string;nonce:number}|null>(null);
  const [requestTarget, setRequestTarget] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [highlightedEdges, setHighlightedEdges] = useState<string[]>([]);
  const [pendingPresentation, setPendingPresentation] =
    useState<Presentation | null>(null);
  const [appliedPresentation, setAppliedPresentation] =
    useState<Presentation | null>(null);
  const [project, setProject] = useState<Project | null>(null),
    [token, setToken] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    const name = project?.name?.trim() || workspacePath.split(/[\\/]/).filter(Boolean).at(-1);
    document.title = name ? `${name} · ISP Block Maker` : "ISP Block Maker";
  }, [project?.name, workspacePath]);
  const [selected, setSelected] = useState(""),
    [nodes, setNodes] = useState<FlowNode[]>([]);
  const [flowEdges, setFlowEdges] = useState<FlowEdge[]>([]);
  const [panelSizes, setPanelSizes] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("isp-panel-sizes") || "{}");
      return {
        inspector: Math.max(270, Math.min(520, Number(saved.inspector) || 390)),
        terminal: Math.max(170, Math.min(500, Number(saved.terminal) || 238)),
      };
    } catch {
      return { inspector: 390, terminal: 238 };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("isp-panel-sizes", JSON.stringify(panelSizes));
    } catch {}
  }, [panelSizes]);
  const [view, setView] = useState("graph"),
    [artifactId, setArtifactId] = useState(""),
    [demoBusy, setDemoBusy] = useState(false);
  const [workMode,setWorkMode]=useState<'interaction'|'terminal'>('interaction');
  const [workPanelOpen,setWorkPanelOpen]=useState(()=>{try{return localStorage.getItem('isp-work-panel-open')!=='false';}catch{return true;}});
  const [workPanelWidth,setWorkPanelWidth]=useState(()=>{try{return Math.max(30,Math.min(70,Number(localStorage.getItem('isp-work-panel-width'))||50));}catch{return 50;}});
  const [workPanelExpanded,setWorkPanelExpanded]=useState(false);
  const panelDrag=useRef(false);
  useEffect(()=>{try{localStorage.setItem('isp-work-panel-open',String(workPanelOpen));localStorage.setItem('isp-work-panel-width',String(workPanelWidth));}catch{}},[workPanelOpen,workPanelWidth]);
  function changeWorkMode(mode:'interaction'|'terminal'){setWorkMode(mode);setFocus('');setVisualizationExpanded(false);setWorkPanelExpanded(false);if(mode==='terminal')setLayout(l=>({...l,terminal:true}));}
  const compactPreview = workMode==='terminal'&&(view === "artifacts" || view === "viewer");
  const [runTerminal,setRunTerminal]=useState<TerminalSession|null>(null);
  const [mcpVisited,setMcpVisited]=useState(false);
  const [searchVisited,setSearchVisited]=useState(false);
  useEffect(()=>{if(view==='search')setSearchVisited(true);},[view]);
  useEffect(()=>{if(view==="mcp")setMcpVisited(true);},[view]);
  const [skillsVisited,setSkillsVisited]=useState(false);
  useEffect(()=>{if(view==="skills")setSkillsVisited(true);},[view]);
  const [viewerVisited, setViewerVisited] = useState(false);
  useEffect(() => { if (view === "viewer") setViewerVisited(true); }, [view]);
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    try { return localStorage.getItem("isp-sidebar-pinned") === "true"; } catch { return false; }
  });
  const [sidebarPeeking, setSidebarPeeking] = useState(false);
  const sidebarSlot = useRef<HTMLDivElement>(null);
  const sidebarPinButton = useRef<HTMLButtonElement>(null);
  const sidebarPointerInside = useRef(false), sidebarKeyboardInside = useRef(false), suppressSidebarFocus = useRef(false);
  const sidebarOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearSidebarTimers() {
    if (sidebarOpenTimer.current !== null) clearTimeout(sidebarOpenTimer.current);
    if (sidebarCloseTimer.current !== null) clearTimeout(sidebarCloseTimer.current);
    sidebarOpenTimer.current = null; sidebarCloseTimer.current = null;
  }
  function closeSidebarSoon(skipEditingControl = false) {
    clearSidebarTimers();
    sidebarCloseTimer.current = setTimeout(() => {
      sidebarCloseTimer.current = null;
      const active = document.activeElement;
      if (sidebarPointerInside.current || sidebarKeyboardInside.current) return;
      const nativeSelectOpen = active instanceof HTMLSelectElement && (!CSS.supports('selector(select:open)') || active.matches(':open'));
      const editingControl = !skipEditingControl && active instanceof HTMLElement && sidebarSlot.current?.contains(active) && (nativeSelectOpen || active.matches('input,textarea,[contenteditable="true"]'));
      if (editingControl) closeSidebarSoon();
      else setSidebarPeeking(false);
    }, 250);
  }
  function toggleSidebarPin() {
    clearSidebarTimers(); sidebarKeyboardInside.current = false;
    setSidebarPeeking(false); setSidebarPinned(current => !current);
  }
  useEffect(() => {
    try { localStorage.setItem("isp-sidebar-pinned", String(sidebarPinned)); } catch {}
    clearSidebarTimers();
  }, [sidebarPinned]);
  useEffect(() => () => clearSidebarTimers(), []);
  useEffect(() => {
    clearSidebarTimers();
    if (sidebarPointerInside.current && !sidebarPinned) {
      sidebarOpenTimer.current = setTimeout(() => { sidebarOpenTimer.current = null; setSidebarPeeking(true); }, 200);
    } else if (!sidebarKeyboardInside.current) closeSidebarSoon(true);
  }, [view]);
  const sidebarExpanded = sidebarPinned || sidebarPeeking;
  const [layout, setLayout] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("isp-layout-v1") || "null");
      if (
        saved &&
        typeof saved.inspector === "boolean" &&
        typeof saved.terminal === "boolean"
      )
        return { inspector: saved.inspector, terminal: true };
    } catch {}
    return { inspector: false, terminal: true };
  });
  useEffect(()=>{
    if(workMode==='interaction' && view==='graph' && layout.inspector && workPanelOpen)return;
    const saved=boardViewportBeforeDetails.current;
    if(!saved)return;
    boardViewportBeforeDetails.current=null;
    const frame=requestAnimationFrame(()=>{if(project?.selectedDiagramId===saved.diagram)void flowRef.current?.setViewport(saved.viewport);});
    return()=>cancelAnimationFrame(frame);
  },[workMode,view,layout.inspector,workPanelOpen,project?.selectedDiagramId]);
  const [focus, setFocus] = useState<"" | "editor" | "inspector" | "terminal">(
    "",
  );
  const [visualizationExpanded, setVisualizationExpanded] = useState(false);
  useEffect(() => { setVisualizationExpanded(false); }, [view]);
  useEffect(() => {
    clearSidebarTimers(); sidebarPointerInside.current = false; sidebarKeyboardInside.current = false;
    setSidebarPeeking(false);
  }, [visualizationExpanded]);
  useEffect(() => {
    try {
      localStorage.setItem("isp-layout-v1", JSON.stringify(layout));
    } catch {}
  }, [layout]);
  function switchView(next: string) {
    if(next==='interaction'){changeWorkMode('interaction');return;}
    setWorkPanelOpen(true);
    setView(next);
    if(next === "graph" && workMode === "interaction")setLayout(current=>({...current,inspector:false}));
    setFocus("");
    if (["artifacts", "code", "jobs", "gpu", "documents", "viewer", "skills", "mcp", "search", "references"].includes(next))
      setLayout((current) => ({ ...current, inspector: false }));
  }
  const [message, setMessage] = useState(""),
    [showContext, setShowContext] = useState(false),
    [contextText, setContextText] = useState("");
  const [dirty, setDirty] = useState(false),
    [pending, setPending] = useState(false);
  const dirtyRef=useRef(false), deferredProject=useRef<Project|null>(null);
  const editControls=useRef<EditControls|null>(null);
  const [leaveTarget,setLeaveTarget]=useState<HTMLElement|null>(null),[leaveBusy,setLeaveBusy]=useState(false),[leaveError,setLeaveError]=useState('');
  useEffect(()=>{
    const navigation=(e:MouseEvent)=>{
      if(!dirty)return;
      const target=e.target as HTMLElement;
      if(target.closest('[data-unsaved-dialog],.artifact-info-trigger'))return;
      const destination=target.closest('.diagram-tabs button,.workspace-sidebar > button,.work-panel-tabs button,.project-name,.version-badge,.react-flow__node,.react-flow__panel button,.artifact-toolbar button,.work-board button') as HTMLElement|null;
      if(!destination)return;
      if(!globalOpen && destination.matches('.react-flow__node') && destination.dataset.id===selected)return;
      e.preventDefault();e.stopPropagation();setLeaveError('');setLeaveTarget(destination);
    };
    const unload=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};
    document.addEventListener('click',navigation,true);window.addEventListener('beforeunload',unload);
    return()=>{document.removeEventListener('click',navigation,true);window.removeEventListener('beforeunload',unload);};
  },[dirty,globalOpen,selected]);
  async function resolveLeave(saveFirst:boolean){
    if(leaveBusy)return;setLeaveBusy(true);setLeaveError('');
    const destination=leaveTarget;
    try{if(!editControls.current)throw new Error('편집기를 찾지 못했습니다. 계속 편집을 선택하세요.');
      if(saveFirst){if(!await editControls.current.save()){setLeaveError('저장하지 못했습니다. 입력 또는 충돌 메시지를 확인하세요.');return;}}
      else editControls.current.discard();
      setLeaveTarget(null);
      setTimeout(()=>{if(destination?.isConnected)destination.click();},0);
    }catch(e){setLeaveError(String(e));}finally{setLeaveBusy(false);}
  }

  const rootRef = useRef<HTMLDivElement>(null),
    projectRef = useRef<Project | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((text: string) => {
    setMessage(text.replace(/^Error: /, ""));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(""), 7000);
  }, []);
  const accept = useCallback((state: Project) => {
    if(dirtyRef.current){if(!deferredProject.current||state.revision>=deferredProject.current.revision)deferredProject.current=state;return;}
    if (projectRef.current && state.revision < projectRef.current.revision)
      return;
    if(projectRef.current?.selectedDiagramId!==state.selectedDiagramId){
      setSelected(state.selectedBlockId);
      setGlobalOpen(false);
      setHighlighted([]);setHighlightedEdges([]);
      setLayout(current=>({...current,inspector:false}));
    }
    projectRef.current = state;
    setProject(state);
  }, []);
  useEffect(()=>{if(!dirty&&deferredProject.current){const state=deferredProject.current;deferredProject.current=null;accept(state);}},[dirty,accept]);
  useEffect(() => {
    fetch("/api/bootstrap")
      .then((r) => {
        if (!r.ok) throw new Error("서버에 연결하지 못했습니다.");
        return r.json();
      })
      .then((data) => {
        setToken(data.token);
        setWorkspacePath(data.workspace);
        accept(data.state);
        setSelected(data.state.selectedBlockId);
      })
      .catch((e) => setError(String(e)));
  }, [accept]);
  useEffect(()=>{
    let refreshing=false,disposed=false;
    const recover=async()=>{
      if(refreshing)return;refreshing=true;
      try{const response=await fetch('/api/bootstrap');if(!response.ok)return;const data=await response.json();
        if(disposed)return;
        if(data.workspace!==workspacePath){setError('서버의 작업 폴더가 변경되었습니다. 입력 내용을 보존한 뒤 새로고침하세요.');return;}
        setToken(data.token);accept(data.state);
      }catch{/* The stream retries when the server is available. */}finally{refreshing=false;}
    };
    window.addEventListener('isp-session-expired',recover);
    return()=>{disposed=true;window.removeEventListener('isp-session-expired',recover);};
  },[workspacePath,accept]);
  const api: Api = useCallback(
    async <T,>(
      endpoint: string,
      body?: unknown,
      method?: string,
    ): Promise<T> => {
      const response = await fetch(`/api${endpoint}`, {
        method: method || (body ? "POST" : "GET"),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if(response.status===401)window.dispatchEvent(new Event('isp-session-expired'));
      if (!response.ok) {
        if (!response.headers.get("content-type")?.includes("json"))
          throw new Error(`서버가 API ${endpoint}를 처리하지 못했습니다 (HTTP ${response.status}). 화면과 서버 버전이 다를 수 있습니다. 터미널 작업을 저장한 뒤 앱 서버를 재시작하세요.`);
        throw new Error((await response.json()).error || response.statusText);
      }
      const result = response.headers.get("content-type")?.includes("json")
        ? await response.json()
        : await response.text();
      if (Array.isArray(result.blocks) && Array.isArray(result.edges) && typeof result.revision === "number") accept(result);
      return result;
    },
    [token, accept],
  );
  const [viewerRequestId,setViewerRequestId] = useState("");
  const [viewerCommandId,setViewerCommandId] = useState("");
  function present(result: Presentation) {
    if (dirty) {
      setPendingPresentation(result);
      notify(
        "에이전트 결과가 도착했습니다. 편집을 저장하거나 취소한 뒤 ‘결과 보기’를 누르세요.",
      );
      return;
    }
    setPendingPresentation(null);
    setGlobalOpen(false);
    setFocus("");
    setWorkPanelOpen(true);
    setView(result.view);
    setHighlighted(result.blockIds);
    setHighlightedEdges(result.edgeIds || []);
    if (result.view === "viewer") {
      setViewerRequestId(result.requestId || "");
      setViewerCommandId(result.commandId ? `${result.commandId}|${Date.now()}` : "");
      setLayout(current=>({...current,inspector:false}));
    } else if (result.view === "artifacts") {
      setArtifactId(result.artifactId || "");
      if (project?.artifacts.find(a => a.id === result.artifactId)?.metadata?.documentType === "sdd") setView("documents");
      setLayout((current) => ({ ...current, inspector: false }));
    } else if (result.blockIds.length) {
      void api("/selection",{blockId:result.blockIds[0]}).then(()=>{setSelected(result.blockIds[0]);setLayout(current=>({...current,inspector:result.blockIds.length===1}));}).catch(e=>notify(String(e)));
      setSelected(result.blockIds[0]);
      setLayout((current) => ({
        ...current,
        inspector: result.blockIds.length === 1,
      }));
    }
    setAppliedPresentation(result);
    if (result.message) notify(result.message);
  }
  useEffect(() => {
    if (!appliedPresentation || view !== "graph") return;
    const timer = setTimeout(() => {
      void flowRef.current?.fitView({
        nodes: appliedPresentation.blockIds.length
          ? appliedPresentation.blockIds.map((id) => ({ id }))
          : undefined,
        padding: 0.3,
        maxZoom: 1.1,
        duration: 250,
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [appliedPresentation, view]);
  useEffect(() => {
    if (!project) return;
    if (!project.blocks.some((b) => b.id === selected)) {
      setSelected(project.selectedBlockId);
      setDirty(false);
    }
    setFlowEdges((current) =>
      project.edges.filter(e=>project.blocks.some(b=>b.id===e.source&&(b.diagramId||"main")===(project.selectedDiagramId||"main"))).map((e) => ({
        ...e,
        type: "smoothstep",
        className: highlightedEdges.includes(e.id)
          ? "agent-edge-highlight"
          : "",
        selected: current.find((c) => c.id === e.id)?.selected,
        animated: e.sourceHandle === "mask",
        style: {
          stroke: e.sourceHandle === "mask" ? "#68cbae" : "#576b80",
          strokeWidth: 1.5,
        },
      })),
    );
    setNodes(current =>
      project.blocks.filter(b=>(b.diagramId||"main")===(project.selectedDiagramId||"main")).map((block) => ({
        ...current.find(node=>node.id===block.id),
        id: block.id,
        type: "block",
        deletable: false,
        data: {
          block,
          highlighted: highlighted.includes(block.id),
          onDescription: (id: string) => {
            if(dirty && (globalOpen || id!==selected))return notify("현재 편집을 저장하거나 취소하세요.");
            selectBlock(id);setFocus("");setDescriptionTarget({id,nonce:Date.now()});
          },
          onRequests: (id: string) => {
            if (dirty && (globalOpen || id !== selected))
              return notify(
                "현재 블록의 변경을 저장하거나 취소한 뒤 이동하세요.",
              );
            selectBlock(id);
            setFocus("");
            setView("graph");
            setRequestTarget((current) => ({
              id,
              nonce: (current?.nonce || 0) + 1,
            }));
          },
        },
        position: block.position,
        selected: block.id === selected,
      })),
    );
  }, [project, selected, highlighted, highlightedEdges, dirty, globalOpen]);
  async function mutate(transform: (p: Project) => Project) {
    if (!projectRef.current || pending) return;
    setPending(true);
    try {
      await api("/project", transform(projectRef.current), "PUT");
    } catch (error) {
      notify(String(error));
      accept(await api<Project>("/project"));
    } finally {
      setPending(false);
    }
  }
  function selectBlock(id: string) {
    setHighlighted([]);
    setHighlightedEdges([]);
    if (dirty && (globalOpen || id !== selected))
      return notify("현재 블록의 변경을 저장하거나 취소한 뒤 이동하세요.");
    setSelected(id);
    setGlobalOpen(false);
    setLayout((current) => ({ ...current, inspector: true }));
    api("/selection", { blockId: id }).catch((e) => notify(String(e)));
  }
  function addBlock() {
    if(!project)return;
    if (dirty) return notify("현재 블록의 변경을 먼저 저장하세요.");
    const id = `block-${crypto.randomUUID().slice(0, 8)}`;
    const harnessDiagram=project.diagrams.find(d=>d.id===project.selectedDiagramId)?.kind==='harness';
    const existing=project.blocks.filter(b=>b.diagramId===project.selectedDiagramId).length;
    const block: Block = {
      id,
      diagramId: project.selectedDiagramId||"main",
      name: harnessDiagram?'New step':'New block',
      ...(harnessDiagram?{harnessStep:{kind:'manual' as const,prompt:'',skills:[],recipeId:'',parameters:{},timeoutSeconds:1800}}:{}),
      description: "블록의 역할을 설명하세요.",
      principle: "",
      implementation: "",
      status: "draft",
      inputs: harnessDiagram?[{id:"in",name:"Start",type:"signal"}]:[{ id: "image", name: "Image", type: "image" }],
      outputs: harnessDiagram?[{id:"pass",name:"Pass",type:"signal"},{id:"fail",name:"Fail",type:"signal"}]:[{ id: "image", name: "Image", type: "image" }],
      parameters: {},
      position: { x: 80+(existing%3)*380, y: 80+Math.floor(existing/3)*340 },
    };
    mutate((p) => ({ ...p, blocks: [...p.blocks, block] }));
  }
  async function runDemo() {
    setDemoBusy(true);
    try {
      const artifact = await api<Artifact>("/demo", {});
      setArtifactId(artifact.id);
      switchView("artifacts");
      notify("실제 계산 결과를 시각화 패널에 등록했습니다.");
    } catch (error) {
      notify(String(error));
    } finally {
      setDemoBusy(false);
    }
  }
  async function downloadMermaid() {
    try {
      const source = await api<string>("/mermaid");
      const url = URL.createObjectURL(
        new Blob([source], { type: "text/plain" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "pipeline.mmd";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(String(error));
    }
  }
  function resize(event: React.PointerEvent, direction: "side" | "bottom") {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      if (direction === "side")
        rootRef.current?.style.setProperty(
          "--inspector-width",
          `${Math.max(270, Math.min(520, window.innerWidth - e.clientX))}px`,
        );
      else
        rootRef.current?.style.setProperty(
          "--terminal-height",
          `${Math.max(170, Math.min(window.innerHeight * 0.65, window.innerHeight - e.clientY - 27))}px`,
        );
    };
    const up = () => {
      setPanelSizes((current) => ({
        inspector:
          parseFloat(
            rootRef.current?.style.getPropertyValue("--inspector-width") || "",
          ) || current.inspector,
        terminal:
          parseFloat(
            rootRef.current?.style.getPropertyValue("--terminal-height") || "",
          ) || current.terminal,
      }));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  if (!project)
    return (
      <div className="loading">
        <Layers3 size={32} />
        <h1>ISP Block Maker</h1>
        <p>{error || "Connecting to local workspace…"}</p>
        {error && <button onClick={() => location.reload()}>Retry</button>}
      </div>
    );
  const block =
    project.blocks.find((b) => b.id === selected) || project.blocks[0];
  const inspectorBlock: Block = globalOpen
    ? {
        ...block,
        id: "global",
        name: "프로젝트 공통 설명 · 글로벌 JOB",
        description: project.overview?.description || "",
        detail: project.overview?.detail || "",
        implementation: project.overview?.entryPoint || "",
        principle: project.overview?.agentNotes || "",
        ...project.globalWork,
        userRequests: project.globalWork?.userRequests || [],
        jobs: project.globalWork?.jobs || [],
      }
    : block;
  const artifact =
    project.artifacts.find((a) => a.id === artifactId) ||
    project.artifacts.at(-1);
  const onConnect = (connection: Connection) => {
    if (!connection.sourceHandle || !connection.targetHandle) return;
    mutate((p) => ({
      ...p,
      edges: [
        ...p.edges,
        {
          id: `edge-${crypto.randomUUID()}`,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle!,
          targetHandle: connection.targetHandle!,
        },
      ],
    }));
  };
  return (
    <div
      className={`app ${workMode === "interaction" ? "interaction-mode" : "terminal-mode"} ${!workPanelOpen ? "work-panel-hidden" : ""} ${workPanelExpanded ? "work-panel-expanded" : ""} ${compactPreview ? "compact-preview-view" : ""} ${sidebarPinned ? "sidebar-pinned" : "sidebar-floating"} ${!sidebarExpanded ? "sidebar-collapsed" : "sidebar-expanded"} ${!layout.inspector || (!selected&&!globalOpen) ? "hide-inspector" : ""} ${!layout.terminal ? "hide-terminal" : ""} ${focus ? `focus-${focus}` : ""} ${view === "artifacts" && (workMode === "interaction" ? workPanelExpanded : visualizationExpanded) ? "visualization-expanded" : ""}`}
      ref={rootRef}
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--work-panel-width": `${workPanelWidth}%`,
          "--inspector-width": `${panelSizes.inspector}px`,
          "--terminal-height": `${panelSizes.terminal}px`,
        } as React.CSSProperties
      }
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Layers3 size={21} />
          </span>
          <strong>
            ISP<span>Block Maker</span>
          </strong>
          <span className="version">LOCAL / 0.1</span>
        </div>
        <button
          className="project-name workspace-switch"
          title={workspacePath}
          aria-label="작업 폴더 선택"
          onClick={() => {
            if (dirty)
              return notify(
                "작성 중인 변경을 저장하거나 취소한 뒤 폴더를 전환하세요.",
              );
            setWorkspacePicker(true);
          }}
        >
          <span className="breadcrumb">Workspace</span>
          <span>/</span>
          <span>{project.name}</span>
          <ChevronDown size={13} />
        </button>
        <div className="top-actions">
          <div className="work-mode-switch" role="group" aria-label="작업 모드"><button aria-label="Interaction mode" aria-pressed={workMode==='interaction'} onClick={()=>changeWorkMode('interaction')}>Interaction</button><button aria-label="Terminal mode" aria-pressed={workMode==='terminal'} onClick={()=>changeWorkMode('terminal')}>Terminal</button></div>
          {workMode==='interaction'&&pendingPresentation&&<button onClick={()=>present(pendingPresentation)}>결과 보기</button>}
          <details className="project-actions-menu" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}>
            <summary>프로젝트 메뉴 <ChevronDown size={13}/></summary>
            <div className="project-actions-popover">
              <AppUpdate api={api}/>
              <BundleOpen api={api} token={token} current={workspacePath} dirty={dirty || pending} />
              <details className="project-help-menu"><summary>도움말 · 예제</summary>
          <button className="run-example-button" title="Run example" aria-label="Run example" onClick={runDemo} disabled={demoBusy}>
            <FlaskConical size={15} />
            <span>{demoBusy ? "Running…" : "Run example"}</span>
          </button>
              </details>
            </div>
          </details>
          <BundleShare api={api} token={token} dirty={dirty || pending} />
          <VersionControl api={api} revision={project.revision} dirty={dirty} />
          <HarnessStatus api={api} disabled={dirty||pending} onShow={()=>{switchView("graph");setWorkPanelOpen(true);}}/>
          <span className="saved">
            <Check size={13} />{" "}
            {pending ? "Saving…" : `Saved · r${project.revision}`}
          </span>

        </div>
      </header>
      <div className="work-area">
        {workspacePicker && (
          <WorkspacePicker
            api={api}
            current={workspacePath}
            onClose={() => setWorkspacePicker(false)}
          />
        )}
        {!!deleteCandidates.length&&<div className="workspace-picker-backdrop" data-unsaved-dialog="true"><section className="leave-dialog" role="dialog" aria-modal="true" aria-label="시각화 삭제"><h2>시각화 {deleteCandidates.length}개를 삭제할까요?</h2><ul>{deleteCandidates.map(a=><li key={a.id}>{a.title}</li>)}</ul><p>등록된 HTML·이미지 파일과 내장 데이터, 메타데이터를 영구 삭제합니다.</p><p>구현 코드, 원본 입력, 생성 스크립트·작업 폴더의 출력 원본, JOB·활동 기록은 유지합니다.</p>{deleteError&&<p role="alert">{deleteError}</p>}<div className="work-controls"><button autoFocus disabled={deleteBusy} onClick={()=>setDeleteCandidates([])}>취소</button><button disabled={deleteBusy} onClick={async()=>{setDeleteBusy(true);setDeleteError("");try{const result=await api<{cleanupPending:string[]}>("/artifacts",{ids:deleteCandidates.map(a=>a.id)},"DELETE");setDeleteCandidates([]);setArtifactId("");if(result.cleanupPending.length)notify("목록은 삭제됐지만 일부 파일 정리가 실패했습니다: "+result.cleanupPending.join(", "));}catch(e){setDeleteError(String(e));}finally{setDeleteBusy(false);}}}>{deleteBusy?"삭제 중…":"영구 삭제"}</button></div></section></div>}
        {leaveTarget&&<div className="workspace-picker-backdrop" data-unsaved-dialog="true"><section className="leave-dialog" role="dialog" aria-modal="true" aria-label="저장하지 않은 변경" onKeyDown={e=>{if(e.key==='Escape'&&!leaveBusy)setLeaveTarget(null);}}><h2>변경사항을 저장할까요?</h2><p>선택한 화면으로 이동하기 전에 현재 편집을 처리하세요.</p>{leaveError&&<p role="alert">{leaveError}</p>}<div className="work-controls"><button autoFocus disabled={leaveBusy} onClick={()=>setLeaveTarget(null)}>계속 편집</button><button disabled={leaveBusy} onClick={()=>void resolveLeave(false)}>변경 버리고 이동</button><button className="primary" disabled={leaveBusy} onClick={()=>void resolveLeave(true)}>{leaveBusy?'처리 중…':'저장 후 이동'}</button></div></section></div>}
        <div className="sidebar-slot" ref={sidebarSlot}
          onPointerEnter={event => {
            if (event.pointerType === "touch") return;
            sidebarPointerInside.current = true; clearSidebarTimers();
            if (!sidebarPinned) sidebarOpenTimer.current = setTimeout(() => { sidebarOpenTimer.current = null; setSidebarPeeking(true); }, 200);
          }}
          onPointerLeave={() => { sidebarPointerInside.current = false; closeSidebarSoon(); }}
          onPointerDownCapture={() => { sidebarKeyboardInside.current = false; }}
          onFocusCapture={event => {
            if (suppressSidebarFocus.current) return;
            if (sidebarKeyboardInside.current || (event.target as HTMLElement).matches(':focus-visible')) {
              sidebarKeyboardInside.current = true; clearSidebarTimers(); setSidebarPeeking(true);
            }
          }}
          onBlurCapture={event => {
            if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as globalThis.Node)) return;
            sidebarKeyboardInside.current = false; if (!sidebarPointerInside.current) closeSidebarSoon();
          }}
          onChangeCapture={event => {
            if (event.target instanceof HTMLSelectElement && !sidebarPointerInside.current && !sidebarKeyboardInside.current) closeSidebarSoon(true);
          }}
          onKeyDown={event => {
            if (event.key !== "Escape" || sidebarPinned) return;
            event.preventDefault(); event.stopPropagation(); clearSidebarTimers();
            sidebarKeyboardInside.current = false; setSidebarPeeking(false);
            suppressSidebarFocus.current = true; sidebarPinButton.current?.focus(); suppressSidebarFocus.current = false;
          }}
        >
        <nav id="workspace-sidebar" className="rail workspace-sidebar" aria-label="Workspace controls">
          <div className="sidebar-toggle">
            <button ref={sidebarPinButton}
              title={sidebarPinned ? "사이드바 고정 해제" : "사이드바 고정 · 펼친 상태 유지"}
              aria-label="사이드바 고정"
              aria-pressed={sidebarPinned}
              aria-expanded={sidebarExpanded}
              aria-controls="workspace-sidebar"
              onClick={toggleSidebarPin}
            >
              {sidebarPinned ? <PinOff size={18} /> : <Pin size={18} />}
              <span>{sidebarPinned ? "고정 해제" : "사이드바 고정"}</span>
            </button>
          </div>
          <button
            className={view === "graph" ? "active" : ""}
            title="Block graph"
            aria-label="Block graph"
            aria-current={view === "graph" ? "page" : undefined}
            onClick={() => switchView("graph")}
          >
            <GitBranch size={18} />
            <span>Block graph</span>
            <small>{project.blocks.length}</small>
          </button>
          <button
            className={view === "code" ? "active" : ""}
            title="Node implementations"
            aria-label="Node implementations"
            aria-current={view === "code" ? "page" : undefined}
            onClick={() => switchView("code")}
          >
            <Code2 size={18} />
            <span>Node implementations</span>
          </button>
          <button
            className={view === "artifacts" ? "active" : ""}
            title="Visualizations"
            aria-label="Visualizations"
            aria-current={view === "artifacts" ? "page" : undefined}
            onClick={() => switchView("artifacts")}
          >
            <Image size={18} />
            <span>Visualizations</span>
            <small>{project.artifacts.length}</small>
            {project.artifacts.length > 0 && <i />}
          </button>
          <button className={view === "viewer" ? "active" : ""} title="Image Viewer" aria-label="Image Viewer" aria-current={view === "viewer" ? "page" : undefined} onClick={() => switchView("viewer")}><FileImage size={18}/><span>Image Viewer</span></button>
          <button className={view === "skills" ? "active" : ""} title="Project Skills" aria-label="Project Skills" aria-current={view === "skills" ? "page" : undefined} onClick={() => switchView("skills")}><BookOpen size={18}/><span>Project Skills</span></button>
          <button aria-label="Runs" className={view==="runs"?"active":""} onClick={()=>switchView("runs")}><Play size={18}/><span>Runs</span></button>
          <button className={view === "mcp" ? "active" : ""} title="MCP Servers" aria-label="MCP Servers" aria-current={view === "mcp" ? "page" : undefined} onClick={() => switchView("mcp")}><Plug size={18}/><span>MCP Servers</span></button>
          <button className={view === "search" ? "active" : ""} title="Workspace Search" aria-label="Workspace Search" aria-current={view === "search" ? "page" : undefined} onClick={() => switchView("search")}><Search size={18}/><span>Search</span></button>
          <button className={view === "jobs" ? "active job-nav" : "job-nav"} title="JOB Queue" aria-label="JOB Queue" aria-current={view === "jobs" ? "page" : undefined} onClick={() => switchView("jobs")}><Check size={18}/><span>JOB Queue</span><small>{[...(project.globalWork?.jobs || []), ...project.blocks.flatMap(b => b.jobs || [])].filter(j => j.status !== "done").length}</small></button>
          <button className={view === "documents" ? "active" : ""} title="Documentation" aria-label="Documentation" aria-current={view === "documents" ? "page" : undefined} onClick={() => switchView("documents")}><FileImage size={18}/><span>Documentation</span></button>
          <div className="graph-toolbar">
            <div>
              <span className="eyebrow">IMAGE SIGNAL PROCESSING</span>
              <h1>{project.name}</h1>
            </div>
            {view === "graph" && <div className="graph-actions">
              <button onClick={downloadMermaid} title="Export Mermaid">
                <ArrowDownToLine size={15} />
                <span>Mermaid</span>
              </button>
            </div>}
          </div>
          {workMode === "terminal" && <div className="layout-toolbar">
            <div>
              <button
                aria-pressed={layout.inspector}
                onClick={() => {
                  setFocus("");
                  setLayout((current) => ({
                    ...current,
                    inspector: !current.inspector,
                  }));
                }}
              >
                상세 {layout.inspector ? "접기" : "열기"}
              </button>
              <button
                aria-pressed={layout.terminal}
                onClick={() => {
                  setFocus("");
                  setLayout((current) => ({
                    ...current,
                    terminal: !current.terminal,
                  }));
                }}
              >
                터미널 {layout.terminal ? "접기" : "열기"}
              </button>
            </div>
          </div>}
          <div className="rail-bottom">
            {pendingPresentation && (
              <button title="결과 보기" aria-label="결과 보기" onClick={() => present(pendingPresentation)}>
                <ArrowRight size={18} /><span>결과 보기</span>
              </button>
            )}

          </div>
        </nav>
        </div>
        <div className="sidebar-resizer" role="separator" aria-label="왼쪽 사이드바 너비 조절" aria-orientation="vertical" aria-valuemin={150} aria-valuemax={420} aria-valuenow={sidebarWidth} tabIndex={0} onDoubleClick={()=>setSidebarWidth(200)} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setSidebarWidth(w=>Math.max(150,Math.min(420,w+(e.key==='ArrowRight'?20:-20))));}}} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();sidebarDrag.current={x:e.clientX,width:e.currentTarget.previousElementSibling!.getBoundingClientRect().width};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(sidebarDrag.current)setSidebarWidth(Math.max(150,Math.min(420,sidebarDrag.current.width+e.clientX-sidebarDrag.current.x)));}} onPointerUp={()=>{sidebarDrag.current=null;}} onPointerCancel={()=>{sidebarDrag.current=null;}} onLostPointerCapture={()=>{sidebarDrag.current=null;}}/>

        <main className="main-area">
          <section className="interaction-dock" aria-label="고정 채팅">
            <Interaction api={api} token={token} project={project} workspace={workspacePath} blockId={selected} onArtifact={id=>{setArtifactId(id);switchView('artifacts');}} panelOpen={workPanelOpen} onTogglePanel={()=>setWorkPanelOpen(v=>!v)}/>
          </section>
          <div className="work-panel-resizer" role="separator" aria-label="채팅과 작업 패널 너비 조절" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={workPanelWidth} tabIndex={0}
            onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setWorkPanelWidth(v=>Math.max(30,Math.min(70,v+(e.key==='ArrowRight'?5:-5))));}}}
            onDoubleClick={()=>setWorkPanelWidth(50)} onPointerDown={e=>{if(e.button!==0)return;panelDrag.current=true;e.currentTarget.setPointerCapture(e.pointerId);}}
            onPointerMove={e=>{if(!panelDrag.current)return;const rect=e.currentTarget.parentElement!.getBoundingClientRect();setWorkPanelWidth(Math.max(30,Math.min(70,100*(e.clientX-rect.left)/rect.width)));}}
            onPointerUp={()=>{panelDrag.current=false;}} onPointerCancel={()=>{panelDrag.current=false;}} onLostPointerCapture={()=>{panelDrag.current=false;}}/>
          <section className={`work-panel ${workMode === "interaction" && view === "graph" && layout.inspector && (selected || globalOpen) ? "show-block-detail" : ""}`} aria-label="작업 패널">
          <header className="work-panel-header"><nav className="work-panel-tabs" aria-label="작업 패널 보기">{[['graph','Board'],['artifacts','Report'],['code','Code'],['viewer','Image'],['runs','Runs']].map(([id,label])=><button key={id} aria-pressed={view===id} onClick={()=>switchView(id)}>{label}</button>)}{!['graph','artifacts','code','viewer','runs'].includes(view)&&<span>{({skills:'Project Skills',mcp:'MCP Servers',search:'Search',jobs:'JOB Queue',documents:'Documentation'} as Record<string,string>)[view]}</span>}</nav>
            {view==='graph'&&<button disabled={!selected} aria-pressed={layout.inspector} onClick={()=>setLayout(l=>({...l,inspector:!l.inspector}))}>블록 상세</button>}
            <button aria-label={workPanelExpanded?'작업 패널 크기 복원':'작업 패널 최대화'} onClick={()=>setWorkPanelExpanded(v=>!v)}>{workPanelExpanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
            <button aria-label="작업 패널 숨기기" onClick={()=>{setWorkPanelOpen(false);setWorkPanelExpanded(false);}}><X size={16}/></button>
          </header>
          <div className="editor">
            <div className="editor-main">
              {(viewerVisited || view === "viewer") && <div style={{display:view === "viewer" ? "contents" : "none"}}>
                <Viewer api={api} token={token} requestId={viewerRequestId} commandId={viewerCommandId} visible={view==="viewer"} expanded={focus==="editor"} onExpand={()=>setFocus(current=>current==="editor"?"":"editor")}/>
              </div>}
              {(skillsVisited||view==="skills")&&<div style={{display:view==="skills"?"contents":"none"}}><ProjectSkills api={api} token={token}/></div>}
              {(mcpVisited||view==="mcp")&&<div style={{display:view==="mcp"?"contents":"none"}}><McpServers api={api}/></div>}
              {(searchVisited||view==="search")&&<div style={{display:view==="search"?"contents":"none"}}><WorkspaceSearch api={api} project={project}/></div>}
              {view==="runs"?<Runs api={api} onRun={session=>{setRunTerminal(session);changeWorkMode("terminal");}}/>: view === "viewer" || view === "skills" || view === "mcp" || view === "search" ? null : view === "documents" ? (
                <Documents key={artifactId} project={project} api={api} selectedId={artifactId} />
              ) : view === "jobs" ? (
                <JobsBoard project={project} api={api} onArtifact={id=>{setArtifactId(id);switchView("artifacts");}} onOpen={id => {
                  if (dirty) return notify("현재 편집을 저장하거나 취소하세요.");
                  switchView("graph");
                  if (id) { selectBlock(id); setRequestTarget({id, nonce: Date.now()}); }
                  else {setGlobalOpen(true);setLayout(current => ({...current, inspector:true}));}
                }}/>
              ) : view === "code" ? (
                <CodeView project={project} initialId={selected} api={api} />
              ) : view === "graph" ? (
                <div className="graph-area">
                  <DiagramTabs project={project} api={api} disabled={dirty||pending}/>
                  <HarnessPanel project={project} api={api} disabled={dirty||pending}/>
                  {boardMenu&&<div className="board-menu-scrim" onClick={()=>setBoardMenu(null)} onContextMenu={e=>{e.preventDefault();setBoardMenu(null);}}><div role="menu" className="board-context-menu" style={{left:boardMenu.x,top:boardMenu.y}} onClick={e=>e.stopPropagation()}><small>{boardMenu.id}</small><button role="menuitem" disabled={dirty||pending} onClick={()=>{selectBlock(boardMenu.id);setBoardMenu(null);}}>설명 / 포트 편집</button><button role="menuitem" disabled={dirty||pending} onClick={()=>{selectBlock(boardMenu.id);setRequestTarget({id:boardMenu.id,nonce:Date.now()});setBoardMenu(null);}}>요청 남기기</button><button role="menuitem" disabled={dirty||pending} onClick={()=>{addBlock();setBoardMenu(null);}}>블록 추가</button><button role="menuitem" disabled={dirty||pending} onClick={()=>{const id=boardMenu.id;setBoardMenu(null);if(window.confirm('블록과 연결을 삭제할까요? '+id))mutate(p=>({...p,blocks:p.blocks.filter(b=>b.id!==id),edges:p.edges.filter(e=>e.source!==id&&e.target!==id)}));}}>블록 삭제…</button><button role="menuitem" onClick={()=>setBoardMenu(null)}>닫기</button></div></div>}
                  <div className="flow-wrap">
                    <ReactFlow<FlowNode>
                      key={project.selectedDiagramId}
                      onInit={(instance) => {
                        flowRef.current = instance;
                      }}
                      nodes={nodes}
                      edges={flowEdges}
                      onEdgesChange={(changes) =>
                        setFlowEdges((current) =>
                          applyEdgeChanges(changes, current),
                        )
                      }
                      nodeTypes={nodeTypes}
                      onNodesChange={(changes: NodeChange<FlowNode>[]) =>
                        setNodes((current) =>
                          applyNodeChanges(
                            changes.filter((c) => c.type !== "select"),
                            current,
                          ),
                        )
                      }
                      onNodeClick={(_, node) => {setBoardMenu(null);selectBlock(node.id);}}
                      onPaneClick={()=>setBoardMenu(null)}
                      onNodeContextMenu={(event,node)=>{event.preventDefault();setBoardMenu({id:node.id,x:Math.min(event.clientX,window.innerWidth-230),y:Math.min(event.clientY,window.innerHeight-250)});}}
                      onNodeDragStop={(_, node) =>
                        mutate((p) => ({
                          ...p,
                          blocks: p.blocks.map((b) =>
                            b.id === node.id
                              ? { ...b, position: node.position }
                              : b,
                          ),
                        }))
                      }
                      onConnect={onConnect}
                      onEdgesDelete={(edges) =>
                        mutate((p) => ({
                          ...p,
                          edges: p.edges.filter(
                            (e) =>
                              !edges.some((deleted) => deleted.id === e.id),
                          ),
                        }))
                      }
                      nodesDraggable={!pending}
                      nodesConnectable={!pending}
                      fitView
                      fitViewOptions={{ padding: 0.18 }}
                      minZoom={0.3}
                      maxZoom={1.8}
                      colorMode="dark"
                      deleteKeyCode={["Backspace", "Delete"]}
                    >
                      <Panel position="top-right"><button className="board-add-float nodrag nopan" disabled={dirty||pending} onClick={addBlock} aria-label="블록 추가" title="현재 다이어그램에 블록 추가">＋</button></Panel>
                      <Background gap={20} size={1} color="#30383f" />
                      <Controls showInteractive={false} />
                      <Panel
                        position="top-left"
                        className="global-request-float"
                      >
                        <button
                          className="nodrag nopan"
                          title="프로젝트 공통 설명 및 글로벌 JOB"
                          aria-label="프로젝트 공통 설명 및 글로벌 JOB"
                          aria-pressed={globalOpen && layout.inspector}
                          onClick={() => {
                            if (dirty && !globalOpen)
                              return notify(
                                "작성 중인 변경을 저장하거나 취소하세요.",
                              );
                            setGlobalOpen(true);
                            setFocus("");
                            setLayout((current) => ({
                              ...current,
                              inspector: true,
                            }));
                          }}
                        >
                          <MessageSquarePlus size={21} />
                          <span className="global-request-count">
                            {(project.globalWork?.userRequests.filter(
                              (r) => r.status === "pending",
                            ).length || 0) +
                              (project.globalWork?.jobs.filter(
                                (j) => j.status !== "done",
                              ).length || 0)}
                          </span>
                        </button>
                      </Panel>
                    </ReactFlow>
                  </div>
                  <div className="graph-footer">
                    <button onClick={() => switchView("code")} title="선택한 블록의 구현 코드 보기"><Code2 size={14}/> 코드 보기</button>
                    <span>
                      <i className="legend-image" /> Image{" "}
                      <i className="legend-mask" /> Mask
                    </span>
                    <span>
                      Drag ports to connect · Select an edge + Delete to
                      disconnect
                    </span>
                    <button
                      disabled={project.blocks.length <= 1 || !selected || pending || dirty}
                      onClick={() =>
                        mutate((p) => ({
                          ...p,
                          blocks: p.blocks.filter((b) => b.id !== selected),
                          edges: p.edges.filter(
                            (e) =>
                              e.source !== selected && e.target !== selected,
                          ),
                        }))
                      }
                    >
                      <Trash2 size={12} /> Delete selected block
                    </button>
                  </div>
                </div>
              ) : (
                <div className="artifact-area">
                  <button
                    className="visualization-expand-float"
                    title={(workMode==="interaction"?workPanelExpanded:visualizationExpanded) ? "이전 배치로 돌아가기" : "시각화 넓게 보기"}
                    aria-label={(workMode==="interaction"?workPanelExpanded:visualizationExpanded) ? "이전 배치로 돌아가기" : "시각화 넓게 보기"}
                    aria-pressed={workMode==="interaction"?workPanelExpanded:visualizationExpanded}
                    onClick={() => workMode==='interaction'?setWorkPanelExpanded(v=>!v):setVisualizationExpanded(current => !current)}
                  >
                    {(workMode==="interaction"?workPanelExpanded:visualizationExpanded) ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                  </button>
                  <div className="artifact-toolbar">
                    {artifact ? <>
                      <select
                        aria-label="Select visualization"
                        value={artifact.id}
                        onChange={(e) => setArtifactId(e.target.value)}
                      >
                        {[...project.artifacts].reverse().map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.title} · r{a.revision}
                          </option>
                        ))}
                      </select>
                      <ArtifactInformation
                        key={artifact.id}
                        artifact={artifact}
                        revision={project.revision}
                        relatedArtifacts={artifact.runId ? project.artifacts.filter(a => a.runId === artifact.runId) : [artifact]}
                        onDelete={artifacts => { setDeleteError(""); setDeleteCandidates(artifacts); }}
                      />
                    </> : <h1>Visualizations</h1>}
                    <ReportShare api={api} artifact={artifact}/>
                  </div>
                  {artifact ? (
                    <>
                      <div className={`artifact-preview ${artifact.kind==='html'?'artifact-html':''}`}>
                        {artifact.kind === "html" ? (
                          <iframe
                            key={artifact.id}
                            title={artifact.title}
                            src={`/artifacts/${encodeURIComponent(artifact.file)}`}
                            sandbox="allow-scripts"
                          />
                        ) : (
                          <img
                            alt={artifact.title}
                            src={`/artifacts/${encodeURIComponent(artifact.file)}`}
                          />
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="empty-artifacts">
                      <div className="empty-icon">
                        <Image size={31} />
                      </div>
                      <h2>A space for your experiments</h2>
                      <p>
                        에이전트가 만든 이미지와 HTML을 여기서 확인합니다.
                        <br />첫 예제로 flat mask와 denoise 결과를 비교해
                        보세요.
                      </p>
                      <button
                        className="primary"
                        onClick={runDemo}
                        disabled={demoBusy}
                      >
                        <FlaskConical size={15} />
                        {demoBusy ? "Running…" : "Run denoise example"}
                        <ArrowRight size={14} />
                      </button>
                      <code>
                        isp artifact result.html --block ID --revision N
                      </code>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div
              className="splitter side"
              onPointerDown={(e) => resize(e, "side")}
            />
            <Inspector
            detailSize={detailSize} setDetailSize={setDetailSize}
            onViewportResize={()=>{
              const flow=flowRef.current;if(!flow)return;
              const diagram=project.selectedDiagramId;
              if(boardViewportBeforeDetails.current?.diagram!==diagram)boardViewportBeforeDetails.current={diagram,viewport:flow.getViewport()};
              void flow.fitView({padding:0.15,minZoom:0.05,maxZoom:boardViewportBeforeDetails.current.viewport.zoom,duration:0});
            }}
            reading={workMode === "interaction"}
            visible={workMode === "interaction" && view === "graph" && layout.inspector && workPanelOpen}
            onBack={()=>setLayout(current=>({...current,inspector:false}))}
              key={globalOpen ? "global-requests" : block.id}
              descriptionFocus={!globalOpen && descriptionTarget?.id===block.id?descriptionTarget.nonce:undefined}
              global={globalOpen}
              requestFocus={
                globalOpen
                  ? undefined
                  : requestTarget?.id === block.id
                    ? requestTarget.nonce
                    : undefined
              }
              project={project}
              block={inspectorBlock}
              revision={project.revision}
              api={api}
              notify={notify}
              controls={editControls}
              onDirty={value=>{dirtyRef.current=value;setDirty(value);}}
              artifacts={project.artifacts}
              onResult={(id) => {
                setArtifactId(id);
                switchView("artifacts");
              }}
            />
          </div>
          </section>
          <div
            className="splitter bottom"
            onPointerDown={(e) => resize(e, "bottom")}
          />
          <TerminalPanel launch={runTerminal}
            key={token}
            api={api}
            token={token}
            block={block}
            onState={accept}
            onPresent={result=>present(result)}
            notify={notify}
          />
        </main>
      </div>
      <footer className="statusbar">

        <button
          onClick={async () => {
            try {
              const context = await api(selected?`/context?blockId=${selected}`:"/context");
              setContextText(JSON.stringify(context, null, 2));
              setShowContext(true);
            } catch (e) {
              notify(String(e));
            }
          }}
        >
          <Braces size={12} /> Agent context · {selected||project.diagrams.find(d=>d.id===project.selectedDiagramId)?.name}
        </button>
        <span>
          {project.blocks.filter(b=>(b.diagramId||"main")===project.selectedDiagramId).length} blocks{" "}
          <span className="status-divider">/</span> {flowEdges.length}{" "}
          connections
        </span>
      </footer>
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button className="icon-button" onClick={() => setMessage("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {showContext && (
        <div className="modal-backdrop" onClick={() => setShowContext(false)}>
          <section
            className="context-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Agent context"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-title">
              <span>
                <Code2 size={16} /> Agent context
              </span>
              <button
                className="icon-button"
                onClick={() => setShowContext(false)}
              >
                <X size={17} />
              </button>
            </div>
            <p>에이전트가 HTTP API에서 읽는 현재 블록 정보입니다.</p>
            <pre>{contextText}</pre>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
