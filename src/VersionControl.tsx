import { useCallback, useEffect, useRef, useState } from "react";
import { GitBranch, Tag, RotateCcw, X } from "lucide-react";
import type { Api } from "./types";
type Commit = {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  date: string;
};
type Target = { kind: "branch" | "commit" | "tag"; ref: string };
type GitStatus = {
  available: boolean;
  reason?: string;
  repo?: string;
  branch?: string | null;
  head?: Commit | null;
  detached?: boolean;
  dirty?: boolean;
  changeCount?: number;
  changes?: { status: string; path: string }[];
  branches?: { name: string; hash: string }[];
  commits?: Commit[];
  tags?: {name:string;hash:string;subject:string;date:string}[];
  headTags?: string[];
};
type Preview = {
  target: Target;
  commit: Commit;
  currentHash: string;
  hash?: string;
  snapshot: string;
  blockedReason: string | null;
  detached: boolean;
  fileCount: number;
  files: string[];
  stats: string;
  graphChanges: {
    added: { id: string; name: string }[];
    removed: { id: string; name: string }[];
    modified: { id: string; name: string }[];
    edgesBefore: number | null;
    edgesAfter: number;
  };
};
export function VersionControl({
  api,
  revision,
  dirty,
}: {
  api: Api;
  revision: number;
  dirty: boolean;
}) {
  const [status, setStatus] = useState<GitStatus | null>(null),
    [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null),
    [target, setTarget] = useState<Target | null>(null),
    [refInput, setRefInput] = useState("");
  const [loading, setLoading] = useState(false),
    [switching, setSwitching] = useState(false);
  const [category,setCategory]=useState<Target["kind"]>("tag");
  const requestId = useRef(0),
    statusId = useRef(0);
  const refresh = useCallback(
    async (history = false) => {
      const id = ++statusId.current;
      try {
        const value = await api<GitStatus>(
          `/versions${history ? "?history=1" : ""}`,
        );
        if (id === statusId.current) {
          setStatus(value);
          setError("");
        }
      } catch (e) {
        if (id === statusId.current) setError(String(e));
      }
    },
    [api],
  );
  useEffect(() => {
    void refresh(open);
  }, [refresh, revision, open]);
  useEffect(() => {
    const update = () => {
      if (!open) void refresh(false);
    };
    window.addEventListener("focus", update);
    const timer = setInterval(() => {
      if (!open && document.visibilityState === "visible") update();
    }, 15000);
    return () => {
      window.removeEventListener("focus", update);
      clearInterval(timer);
    };
  }, [refresh, open]);
  async function choose(value: Target) {
    const id = ++requestId.current;
    setTarget(value);
    setLoading(true);
    setPreview(null);
    setError("");
    try {
      const result = await api<Preview>(
        `/versions/preview?kind=${value.kind}&ref=${encodeURIComponent(value.ref)}`,
      );
      if (id === requestId.current) setPreview(result);
    } catch (e) {
      if (id === requestId.current) setError(String(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }
  async function apply() {
    if (!preview || dirty) return;
    setSwitching(true);
    setError("");
    try {
      await api("/versions/switch", {
        target: preview.target,
        hash: preview.commit.hash,
        snapshot: preview.snapshot,
        stopTerminals: true,
      });
      location.reload();
    } catch (e) {
      setError(String(e));
      setPreview(null);
      setSwitching(false);
    }
  }
  const label = !status
    ? "Git 확인 중"
    : !status.available
      ? "Git 없음"
      : !status.head
        ? `${status.branch || "Git"} · 커밋 없음`
        : `${status.headTags?.length ? status.headTags.join(", ") : status.branch || "Detached"} · ${status.head.shortHash}${status.dirty ? " *" : ""}`;
  const commit = preview?.commit || status?.head;
  return (
    <>
      <button
        className="version-badge"
        aria-label="구현 버전 선택"
        title={`${label}${status?.head ? "\n" + status.head.subject : ""}`}
        onClick={() => {
          ++requestId.current;
          setPreview(null);
          setTarget(null);
          setLoading(false);
          setCategory("tag");
          setOpen(true);
        }}
      >
        {status?.headTags?.length ? <Tag size={15}/> : <GitBranch size={15} />}
        <span>{label}</span>
      </button>
      {open && (
        <div className="workspace-picker-backdrop">
          <section
            className="version-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="구현 버전 관리"
          >
            <header>
              <div>
                <h2>구현 버전</h2>
                <small>{status?.repo || "현재 작업 폴더의 Git 저장소"}</small>
              </div>
              <button
                disabled={switching}
                aria-label="버전 관리 닫기"
                onClick={() => {
                  requestId.current++;
                  setLoading(false);
                  setOpen(false);
                }}
              >
                <X size={18} />
              </button>
            </header>
            <div className="version-current">
              <strong>현재 적용: {label}</strong>
              <button
                disabled={switching}
                aria-label="버전 목록 새로고침"
                onClick={() => {
                  setPreview(null);
                  setTarget(null);
                  requestId.current++;
                  setLoading(false);
                  void refresh(true);
                }}
              >
                <RotateCcw size={15} />
              </button>
            </div>
            {error && (
              <p role="alert" className="version-error">
                {error}
              </p>
            )}
            {status && !status.available ? (
              <p>{status.reason}</p>
            ) : status && !status.head ? (
              <p className="version-empty">
                아직 첫 커밋이 없습니다. graph.json과 구현 코드를 함께 커밋하면
                이곳에서 버전을 선택할 수 있습니다.
              </p>
            ) : (
              <div className="version-columns">
                <nav aria-label="Git 버전 목록">
                  <div className="version-tabs" role="tablist" aria-label="버전 분류">
                    {([['tag','태그'],['branch','브랜치'],['commit','커밋']] as const).map(([kind,label])=><button key={kind} role="tab" aria-selected={category===kind} disabled={switching} onClick={()=>{requestId.current++;setCategory(kind);setTarget(null);setPreview(null);setLoading(false);setError('');}}>{label}</button>)}
                  </div>
                  {category==='tag'&&<>
                    <h3>태그 · 완성된 결과물</h3>
                    <p className="hint">완성본으로 이름 붙인 버전을 선택하세요.</p>
                    {!status?.tags?.length&&<p className="version-empty">아직 태그가 없습니다. 완성된 커밋에 Git 태그를 붙이면 여기에 표시됩니다. 중간 작업은 커밋 탭에서 확인하세요.</p>}
                    {status?.tags?.map(t=><button key={t.name} disabled={switching} className={target?.kind==='tag'&&target.ref===t.name?'active':''} onClick={()=>choose({kind:'tag',ref:t.name})}><strong><Tag size={13}/> {t.name}{status.headTags?.includes(t.name)?' · 현재 커밋':''}</strong><small>{t.subject}</small><small>{t.hash.slice(0,8)} · {new Date(t.date).toLocaleDateString()}</small></button>)}
                  </>}
                  {category==='branch'&&<><h3>로컬 브랜치 · 작업 흐름</h3>
                  {status?.branches?.map((b) => (
                    <button
                      disabled={switching}
                      className={
                        target?.kind === "branch" && target.ref === b.name
                          ? "active"
                          : ""
                      }
                      key={b.name}
                      onClick={() => choose({ kind: "branch", ref: b.name })}
                    >
                      {b.name}
                      <small>{b.hash.slice(0, 8)}</small>
                    </button>
                  ))}
                  </>}
                  {category==='commit'&&<>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void choose({ kind: "commit", ref: refInput.trim() });
                    }}
                  >
                    <label>
                      커밋 hash
                      <input
                        value={refInput}
                        onChange={(e) => setRefInput(e.target.value)}
                        disabled={switching}
                      />
                    </label>
                    <button disabled={!refInput.trim() || switching}>
                      미리보기
                    </button>
                  </form>
                  <h3>커밋 · 중간 결과물 (최근 50개)</h3>
                  {status?.commits?.map((c) => (
                    <button
                      disabled={switching}
                      className={
                        target?.kind === "commit" && target.ref === c.hash
                          ? "active"
                          : ""
                      }
                      key={c.hash}
                      onClick={() => choose({ kind: "commit", ref: c.hash })}
                    >
                      <strong>{c.subject}</strong>
                      <small>
                        {c.shortHash} · {new Date(c.date).toLocaleDateString()}
                      </small>
                    </button>
                  ))}
                  </>}
                </nav>
                <article>
                  {loading ? (
                    <p>변경 내용 확인 중…</p>
                  ) : (
                    <>
                      <h3>{preview ? `선택한 ${preview.target.kind==='tag'?'태그':'버전'} · ${preview.target.ref}` : "현재 구현"}</h3>
                      {commit && (
                        <>
                          <h2>{commit.subject}</h2>
                          <code className="commit-hash">{commit.hash}</code>
                          <small>
                            {new Date(commit.date).toLocaleString()}
                          </small>
                          {commit.body && (
                            <p className="commit-body">{commit.body}</p>
                          )}
                        </>
                      )}
                      {preview ? (
                        <>
                          <p>
                            현재 커밋 {preview.currentHash.slice(0, 8)} 대비
                          </p>
                          <div className="graph-change-counts">
                            블록 추가 {preview.graphChanges.added.length} · 수정{" "}
                            {preview.graphChanges.modified.length} · 삭제{" "}
                            {preview.graphChanges.removed.length}
                            <br />
                            간선 {preview.graphChanges.edgesBefore ??
                              "?"} → {preview.graphChanges.edgesAfter}
                          </div>
                          {(["added", "modified", "removed"] as const).map(
                            (key) =>
                              preview.graphChanges[key].length > 0 && (
                                <p key={key}>
                                  <strong>
                                    {
                                      {
                                        added: "추가",
                                        modified: "수정",
                                        removed: "삭제",
                                      }[key]
                                    }
                                    :
                                  </strong>{" "}
                                  {preview.graphChanges[key]
                                    .map((b) => `${b.name} (${b.id})`)
                                    .join(", ")}
                                </p>
                              ),
                          )}
                          <h3>변경 파일 · {preview.fileCount}</h3>
                          <pre className="version-stats">
                            {preview.stats ||
                              "현재 커밋과 파일 내용이 같습니다."}
                          </pre>
                          {preview.blockedReason && (
                            <p className="version-error">
                              {preview.blockedReason}
                            </p>
                          )}
                          <p className="hint">
                            {preview.detached
                              ? "태그·커밋을 선택하면 해당 시점의 구현을 엽니다(Detached HEAD). 개발을 이어가려면 이 지점에서 작업 브랜치를 만드세요."
                              : "선택한 로컬 브랜치로 전환합니다."}{" "}
                            적용 전까지 현재 구현은 바뀌지 않습니다.
                          </p>
                        </>
                      ) : (
                        <p className="hint">
                          왼쪽에서 태그·브랜치·커밋을 선택하면 변경 요약을 볼 수
                          있습니다.
                        </p>
                      )}
                    </>
                  )}
                </article>
              </div>
            )}
            {status?.dirty && (
              <details className="version-dirty" open={!status.head}>
                <summary>
                  미커밋 변경 {status.changeCount}개 · 적용 전 정리 필요
                </summary>
                <ul>
                  {status.changes?.map((c, i) => (
                    <li key={i}>
                      <code>{c.status}</code> {c.path}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <footer>
              <p className="hint">
                적용하면 연결된 터미널을 종료하고 그래프·코드를 함께 전환합니다.
                로컬 요청·JOB·시각화 기록은 유지됩니다.
                {dirty ? " 먼저 작성 중인 편집을 저장하거나 취소하세요." : ""}
              </p>
              <button
                className="primary"
                disabled={
                  !preview ||
                  !!preview.blockedReason ||
                  loading ||
                  switching ||
                  dirty
                }
                onClick={apply}
              >
                {switching ? "전환 중…" : "선택한 버전 적용"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
