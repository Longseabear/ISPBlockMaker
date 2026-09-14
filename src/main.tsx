import { Viewer } from "./Viewer";
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
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Box,
  Braces,
  Check,
  ChevronDown,
  Circle,
  Code2,
  FileImage,
  FlaskConical,
  GitBranch,
  Image,
  Layers3,
  MessageSquarePlus,
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
import { GpuSimulator } from "./GpuSimulator";
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
function BlockNode({ data, selected }: NodeProps<FlowNode>) {
  const b = data.block;
  return (
    <div
      className={`block-node ${selected ? "selected" : ""} ${data.highlighted ? "agent-highlight" : ""}`}
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
        <span>{b.status === "implemented" ? "IMPLEMENTED" : "DRAFT"}</span>
        <span>{Object.keys(b.parameters).length} params</span>
      </div>
    </div>
  );
}
const nodeTypes = { block: BlockNode };

const emptyContract = {
  dataFormat: "",
  boundaries: "",
  numerics: "",
  steps: "",
  validation: "",
  acceptance: "",
};

type EditControls = {save:()=>Promise<boolean>;discard:()=>void};
function Inspector({
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
}: {
  controls: React.RefObject<EditControls | null>;
  global?: boolean;
  requestFocus?: number;
  descriptionFocus?: number;
  artifacts: Artifact[];
  onResult: (id: string) => void;
  block: Block;
  revision: number;
  api: Api;
  notify: (s: string) => void;
  onDirty: (dirty: boolean) => void;
}) {
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
  useEffect(()=>{if(descriptionFocus)setTab("spec");},[descriptionFocus]);
  const [newRequest, setNewRequest] = useState("");
  const requestInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (requestFocus) setTab("requests");
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
  useEffect(()=>{controls.current={save,discard};const keyboard=(e:KeyboardEvent)=>{
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
  function edit(key: keyof Block, value: string) {
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
      notify("블록을 저장했습니다.");
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
    <section className="inspector">
      <div className="panel-title">
        <span>
          <Box size={15} /> {global ? "GLOBAL REQUESTS" : "BLOCK INSPECTOR"}
        </span>
        <span className="subtle">{dirty ? "Unsaved" : "Saved"}</span>
      </div>
      <div className="inspector-heading">
        <span className="eyebrow">{block.id}</span>
        <h2>{block.name}</h2>
        <span className={`status ${block.status}`}>
          <Circle size={7} fill="currentColor" />
          {block.status}
        </span>
      </div>
      <div className="tabs" style={global ? { display: "none" } : undefined}>
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
            <label>
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
                  <summary>요청 원문</summary>
                  <p>
                    {block.userRequests?.find(
                      (r) => r.id === job.sourceRequestId,
                    )?.text || "원문이 삭제되었습니다."}
                  </p>
                </details>
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
                placeholder="examples/block.py"
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
              ] as const
            ).map(([key, label, placeholder]) => (
              <label key={key}>
                {label}
                <textarea
                  rows={3}
                  value={(draft.agentContract || emptyContract)[key]}
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
      <div className="inspector-footer"><button title="마지막 편집 되돌리기 (Ctrl+Z)" disabled={!dirty||saving||!undoStack.current.length} onClick={undo}>되돌리기</button>
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
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </section>
  );
}

function TerminalPane({
  token,
  block,
  onState,
  onPresent,
  notify,
}: {
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
  useEffect(() => {
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
    fitter.fit();
    term.current = terminal;
    fit.current = fitter;
    terminal.writeln(
      "\x1b[38;2;112;212;179mISP BLOCK MAKER\x1b[0m  /  local terminal",
    );
    terminal.writeln("Connecting to your local shell automatically…");
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
          active.current = {
            sessionId: crypto.randomUUID(),
            agent: "shell",
            blockId: block.id,
          };
          setStarting(true);
        }
        if (active.current) {
          terminal.reset();
          send({ type: "start", ...active.current });
        }
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "workspace-changed") {
          disposed = true;
          setOnline(false);
          setRunning(false);
          terminal.writeln(
            "\r\n작업 폴더 또는 구현 버전이 변경되었습니다. 작성 중인 내용을 보관한 후 페이지를 새로고침하세요.",
          );
          return;
        }
        if (message.type === "state") stateCallback.current(message.state);
        if (message.type === "present") {
          stateCallback.current(message.state);
          presentationCallback.current(message.presentation);
        }
        if (message.type === "output") terminal.write(message.data);
        if (message.type === "started") {
          setStarting(false);
          setRunning(true);
          runningRef.current = true;
          setPinned(message.blockId);
          fitter.fit();
          send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
          terminal.focus();
        }
        if (message.type === "exit") {
          terminal.writeln(`\r\n[Session ended · exit ${message.exitCode}]`);
          setRunning(false);
          setStarting(false);
          runningRef.current = false;
          active.current = null;
        }
        if (message.type === "error") {
          setStarting(false);
          if (!runningRef.current) active.current = null;
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
      if (active.current) send({ type: "input", data });
    });
    const resize = new ResizeObserver(() => {
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
      sessionId: crypto.randomUUID(),
      agent: nextAgent,
      blockId: block.id,
    };
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

function App() {
  const flowRef = useRef<ReactFlowInstance<FlowNode> | null>(null);
  const [deleteCandidates,setDeleteCandidates]=useState<Artifact[]>([]);
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [deleteError,setDeleteError]=useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspacePicker, setWorkspacePicker] = useState(false);
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
  const [focus, setFocus] = useState<"" | "editor" | "inspector" | "terminal">(
    "",
  );
  useEffect(() => {
    try {
      localStorage.setItem("isp-layout-v1", JSON.stringify(layout));
    } catch {}
  }, [layout]);
  function switchView(next: string) {
    setView(next);
    setFocus("");
    if (["artifacts", "code", "jobs", "gpu", "documents", "viewer"].includes(next))
      setLayout((current) => ({ ...current, inspector: false }));
  }
  function mode(next: string) {
    switchView(next === "visualize" ? "artifacts" : "graph");
    setLayout({ inspector: false, terminal: true });
  }
  const [message, setMessage] = useState(""),
    [showContext, setShowContext] = useState(false),
    [contextText, setContextText] = useState("");
  const [dirty, setDirty] = useState(false),
    [pending, setPending] = useState(false);
  const editControls=useRef<EditControls|null>(null);
  const [leaveTarget,setLeaveTarget]=useState<HTMLElement|null>(null),[leaveBusy,setLeaveBusy]=useState(false),[leaveError,setLeaveError]=useState('');
  useEffect(()=>{
    const navigation=(e:MouseEvent)=>{
      if(!dirty)return;
      const target=e.target as HTMLElement;
      if(target.closest('[data-unsaved-dialog]'))return;
      const destination=target.closest('.workspace-sidebar > button,.layout-toolbar > div:first-child button,.project-name,.version-badge,.react-flow__node,.react-flow__panel button,.artifact-toolbar button,.work-board button') as HTMLElement|null;
      if(!destination)return;
      e.preventDefault();e.stopPropagation();setLeaveError('');setLeaveTarget(destination);
    };
    const unload=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};
    document.addEventListener('click',navigation,true);window.addEventListener('beforeunload',unload);
    return()=>{document.removeEventListener('click',navigation,true);window.removeEventListener('beforeunload',unload);};
  },[dirty]);
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
    if (projectRef.current && state.revision < projectRef.current.revision)
      return;
    projectRef.current = state;
    setProject(state);
  }, []);
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
      if (!response.ok)
        throw new Error((await response.json()).error || response.statusText);
      const result = response.headers.get("content-type")?.includes("json")
        ? await response.json()
        : await response.text();
      if (Array.isArray(result.blocks) && Array.isArray(result.edges) && typeof result.revision === "number") accept(result);
      return result;
    },
    [token, accept],
  );
  const [viewerRequestId,setViewerRequestId] = useState("");
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
    setView(result.view);
    setHighlighted(result.blockIds);
    setHighlightedEdges(result.edgeIds || []);
    if (result.view === "viewer") {
      setViewerRequestId(result.requestId || "");
      setLayout(current=>({...current,inspector:false}));
    } else if (result.view === "artifacts") {
      setArtifactId(result.artifactId || "");
      if (project?.artifacts.find(a => a.id === result.artifactId)?.metadata?.documentType === "sdd") setView("documents");
      setLayout((current) => ({ ...current, inspector: false }));
    } else if (result.blockIds.length) {
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
      setSelected(project.blocks[0].id);
      setDirty(false);
    }
    setFlowEdges((current) =>
      project.edges.map((e) => ({
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
    setNodes(
      project.blocks.map((block) => ({
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
    if (dirty) return notify("현재 블록의 변경을 먼저 저장하세요.");
    const id = `block-${crypto.randomUUID().slice(0, 8)}`;
    const block: Block = {
      id,
      name: "New block",
      description: "블록의 역할을 설명하세요.",
      principle: "",
      implementation: "",
      status: "draft",
      inputs: [{ id: "image", name: "Image", type: "image" }],
      outputs: [{ id: "image", name: "Image", type: "image" }],
      parameters: {},
      position: { x: 280, y: 320 },
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
        name: "전체 그래프 요청사항",
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
      className={`app ${!layout.inspector ? "hide-inspector" : ""} ${!layout.terminal ? "hide-terminal" : ""} ${focus ? `focus-${focus}` : ""}`}
      ref={rootRef}
      style={
        {
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
          <VersionControl api={api} revision={project.revision} dirty={dirty} />
          <span className="saved">
            <Check size={13} />{" "}
            {pending ? "Saving…" : `Saved · r${project.revision}`}
          </span>
          <button className="primary" onClick={runDemo} disabled={demoBusy}>
            <FlaskConical size={15} />
            {demoBusy ? "Running…" : "Run example"}
          </button>
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
        <nav className="rail workspace-sidebar" aria-label="Workspace controls">
          {" "}
          <div className="graph-toolbar">
            <div>
              <span className="eyebrow">IMAGE SIGNAL PROCESSING</span>
              <h1>{project.name}</h1>
            </div>
            <div className="graph-actions">
              <button onClick={downloadMermaid} title="Export Mermaid">
                <ArrowDownToLine size={15} />
                <span>Mermaid</span>
              </button>
              <button onClick={addBlock} disabled={pending}>
                <Plus size={15} /> Add block
              </button>
            </div>
          </div>
          <button
            className={view === "graph" ? "active" : ""}
            title="Block graph"
            aria-label="Block graph"
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
            onClick={() => switchView("code")}
          >
            <Code2 size={18} />
            <span>Node implementations</span>
          </button>
          <button
            className={view === "artifacts" ? "active" : ""}
            title="Visualizations"
            aria-label="Visualizations"
            onClick={() => switchView("artifacts")}
          >
            <Image size={18} />
            <span>Visualizations</span>
            <small>{project.artifacts.length}</small>
            {project.artifacts.length > 0 && <i />}
          </button>
          <button className={view === "viewer" ? "active" : ""} aria-label="Image Viewer" onClick={() => switchView("viewer")}><FileImage size={18}/><span>Image Viewer</span></button>
          <button className={view === "gpu" ? "active" : ""} aria-label="GPU simulator" onClick={() => switchView("gpu")}><FlaskConical size={18}/><span>GPU simulator</span></button>
          <button className={view === "jobs" ? "active job-nav" : "job-nav"} aria-label="JOB Queue" onClick={() => switchView("jobs")}><Check size={18}/><span>JOB Queue</span><small>{[...(project.globalWork?.jobs || []), ...project.blocks.flatMap(b => b.jobs || [])].filter(j => j.status !== "done").length}</small></button>
          <button className={view === "documents" ? "active" : ""} aria-label="Documentation" onClick={() => switchView("documents")}><FileImage size={18}/><span>Documentation</span></button>
          <div className="layout-toolbar">
            <div>
              <button onClick={() => mode("design")}>설계</button>
              <button onClick={() => mode("implement")}>구현</button>
              <button onClick={() => mode("visualize")}>시각화</button>
            </div>
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
              <select
                aria-label="패널 최대화"
                value={focus}
                onChange={(e) => setFocus(e.target.value as typeof focus)}
              >
                <option value="">분할 보기</option>
                <option value="editor">그래프 / 시각화 최대화</option>
                <option value="inspector">노드 상세 최대화</option>
                <option value="terminal">터미널 최대화</option>
              </select>
            </div>
          </div>
          <details className="agent-help">
            <summary>에이전트가 할 수 있는 일</summary>
            <p>터미널의 에이전트에게 평문으로 요청하세요.</p>
            <ul>
              <li>블록·간선 추가, 수정, 삭제 및 구현</li>
              <li>블록·전체 요청을 JOB으로 나누고 처리</li>
              <li>설명·계약 갱신, 검증 및 로컬 Git 커밋</li>
              <li>시각화·SDD 생성, 결과 열기와 변경 강조</li>
              <li>BMP·RAW를 Viewer에 올리고 CFA 크롭 요청</li>
            </ul>
            <p>예: “선택한 블록 설명을 읽고 메모를 구현한 뒤, 변경 효과를 시각화해줘.”</p>
            <small>클릭한 노드와 터미널 작업 대상은 다를 수 있습니다. “현재 선택한 블록”이라고 요청하면 선택을 읽어 대상을 바꿀 수 있습니다. 스킬 작업 규칙이며 자동 실행은 아닙니다.</small>
          </details>
          <div className="rail-bottom">
            {pendingPresentation && (
              <button onClick={() => present(pendingPresentation)}>
                결과 보기
              </button>
            )}
            <span title="Local HTTP bridge">
              <Activity size={19} />
            </span>
          </div>
        </nav>
        <main className="main-area">
          <div className="editor">
            <div className="editor-main">
              {view === "viewer" ? (
                <Viewer api={api} token={token} requestId={viewerRequestId} onExpand={()=>setFocus("editor")}/>
              ) : view === "documents" ? (
                <Documents key={artifactId} project={project} api={api} selectedId={artifactId} />
              ) : view === "jobs" ? (
                <JobsBoard project={project} api={api} onArtifact={id=>{setArtifactId(id);switchView("artifacts");}} onOpen={id => {
                  if (dirty) return notify("현재 편집을 저장하거나 취소하세요.");
                  switchView("graph");
                  if (id) { selectBlock(id); setRequestTarget({id, nonce: Date.now()}); }
                  else {setGlobalOpen(true);setLayout(current => ({...current, inspector:true}));}
                }}/>
              ) : view === "gpu" ? (
                <GpuSimulator api={api} project={project} dirty={dirty} onSaved={id=>{setArtifactId(id);switchView("artifacts");}}/>
              ) : view === "code" ? (
                <CodeView project={project} initialId={selected} api={api} />
              ) : view === "graph" ? (
                <div className="graph-area">
                  <div className="flow-wrap">
                    <ReactFlow<FlowNode>
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
                      onNodeClick={(_, node) => selectBlock(node.id)}
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
                      <Background gap={20} size={1} color="#30383f" />
                      <Controls showInteractive={false} />
                      <Panel
                        position="top-left"
                        className="global-request-float"
                      >
                        <button
                          className="nodrag nopan"
                          title="전체 그래프 요청사항"
                          aria-label="전체 그래프 요청사항"
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
                    <span>
                      <i className="legend-image" /> Image{" "}
                      <i className="legend-mask" /> Mask
                    </span>
                    <span>
                      Drag ports to connect · Select an edge + Delete to
                      disconnect
                    </span>
                    <button
                      disabled={project.blocks.length <= 1 || pending || dirty}
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
                  <div className="artifact-toolbar">
                    <div>
                      <span className="eyebrow">EXPERIMENT OUTPUTS</span>
                      <h1>Visualizations</h1>
                    </div>
                    {artifact && (
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
                    )}
                  </div>
                  {artifact ? (
                    <>
                      <div className="artifact-meta">
                        <span>
                          <Box size={12} />
                          {artifact.blockId}
                        </span>
                        <span>
                          revision {artifact.revision}
                          {artifact.revision < project.revision
                            ? " · earlier version"
                            : " · current"}
                        </span>
                        <span>
                          {new Date(artifact.createdAt).toLocaleTimeString()}
                        </span>
                        <span className="spacer" />
                        <span>{artifact.kind.toUpperCase()}</span>
                        <button onClick={()=>{setDeleteError("");setDeleteCandidates([artifact]);}}><Trash2 size={14}/> 삭제</button>
                        {artifact.runId && project.artifacts.filter(a=>a.runId===artifact.runId).length>1 && <button onClick={()=>{setDeleteError("");setDeleteCandidates(project.artifacts.filter(a=>a.runId===artifact.runId));}}>같은 실행 결과 삭제</button>}
                      </div>
                      <div className="artifact-preview">
                        {artifact.kind === "html" ? (
                          <iframe
                            key={artifact.id}
                            title={artifact.title}
                            src={`/artifacts/${artifact.file}`}
                            sandbox="allow-scripts"
                          />
                        ) : (
                          <img
                            alt={artifact.title}
                            src={`/artifacts/${artifact.file}`}
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
              key={globalOpen ? "global-requests" : block.id}
              descriptionFocus={!globalOpen && descriptionTarget?.id===block.id?descriptionTarget.nonce:undefined}
              global={globalOpen}
              requestFocus={
                globalOpen
                  ? 1
                  : requestTarget?.id === block.id
                    ? requestTarget.nonce
                    : undefined
              }
              block={inspectorBlock}
              revision={project.revision}
              api={api}
              notify={notify}
              controls={editControls}
              onDirty={setDirty}
              artifacts={project.artifacts}
              onResult={(id) => {
                setArtifactId(id);
                switchView("artifacts");
              }}
            />
          </div>
          <div
            className="splitter bottom"
            onPointerDown={(e) => resize(e, "bottom")}
          />
          <TerminalPane
            token={token}
            block={block}
            onState={accept}
            onPresent={present}
            notify={notify}
          />
        </main>
      </div>
      <footer className="statusbar">
        <span>
          <span className="connection-dot online" /> Local workspace{" "}
          <span className="status-divider">|</span> HTTP + WebSocket
        </span>
        <button
          onClick={async () => {
            try {
              const context = await api(`/context?blockId=${block.id}`);
              setContextText(JSON.stringify(context, null, 2));
              setShowContext(true);
            } catch (e) {
              notify(String(e));
            }
          }}
        >
          <Braces size={12} /> Agent context · {block.id}
        </button>
        <span>
          {project.blocks.length} blocks{" "}
          <span className="status-divider">/</span> {project.edges.length}{" "}
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
