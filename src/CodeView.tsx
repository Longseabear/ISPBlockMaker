import { useEffect, useMemo, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-python";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-verilog";
import { Code2, RotateCcw } from "lucide-react";
import type { Api, Project } from "./types";

type Source = {
  blockId: string;
  path: string;
  language: string;
  content: string;
  modifiedAt: string;
  startLine: number;
  entryFound: boolean;
  entrySymbol: string;
  explicitLine?: boolean;
};
function highlightLines(source: Source) {
  const language = (
    {
      Python: "python",
      JavaScript: "javascript",
      TypeScript: "typescript",
      JSX: "jsx",
      TSX: "tsx",
      C: "c",
      "C++": "cpp",
      "C/C++": "cpp",
      CUDA: "cpp",
      OpenCL: "c",
      Verilog: "verilog",
      SystemVerilog: "verilog",
    } as Record<string, string>
  )[source.language];
  const grammar = Prism.languages[language];
  const lines: { text: string; classes: string }[][] = [[]];
  function visit(
    value: string | Prism.Token | (string | Prism.Token)[],
    classes = "",
  ) {
    if (typeof value === "string") {
      value.split("\n").forEach((text, i) => {
        if (i) lines.push([]);
        if (text) lines[lines.length - 1].push({ text, classes });
      });
    } else if (Array.isArray(value))
      value.forEach((item) => visit(item, classes));
    else visit(value.content, `${classes} token ${value.type}`);
  }
  // Tokenize the complete file so multiline strings/comments retain their context.
  visit(grammar ? Prism.tokenize(source.content, grammar) : source.content);
  return lines;
}
export function CodeView({
  project,
  initialId,
  api,
}: {
  project: Project;
  initialId: string;
  api: Api;
}) {
  const [selected, setSelected] = useState(initialId);
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [listWidth, setListWidth] = useState(() => {
    try { return Math.max(140, Math.min(600, Number(localStorage.getItem('isp-code-list-width')) || 220)); }
    catch { return 220; }
  });
  const drag = useRef<{x: number; width: number} | null>(null);
  useEffect(() => { try { localStorage.setItem('isp-code-list-width', String(listWidth)); } catch {} }, [listWidth]);
  const resizeList = (width: number) => setListWidth(Math.max(140, Math.min(600, width)));
  const scroller = useRef<HTMLDivElement>(null);
  const startRow = useRef<HTMLDivElement>(null);
  function jumpToEntry() {
    const scroll = scroller.current,
      row = startRow.current;
    if (scroll && row)
      scroll.scrollTop =
        row.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top +
        scroll.scrollTop -
        34;
  }
  useEffect(() => {
    jumpToEntry();
  }, [source]);
  const lines = useMemo(() => (source ? highlightLines(source) : []), [source]);
  const block =
    project.blocks.find((b) => b.id === selected) || project.blocks[0];
  useEffect(() => {
    let active = true;
    setSource(null);
    setError("");
    api<Source>(`/blocks/${encodeURIComponent(block.id)}/source`)
      .then((value) => {
        if (active) setSource(value);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [
    block.id,
    block.implementation,
    block.implementationSymbol,
    block.implementationLine,
    project.revision,
    refresh,
    api,
  ]);
  return (
    <section className="code-workspace">
      <nav className="code-node-list" style={{flexBasis: listWidth}} aria-label="구현 코드 노드 목록">
        <h3>Node implementations</h3>
        {project.blocks.map((b) => (
          <button
            key={b.id}
            className={b.id === block.id ? "active" : ""}
            aria-pressed={b.id === block.id}
            onClick={() => setSelected(b.id)}
          >
            <Code2 size={15} />
            <span>
              {b.name}
              <small>{b.implementation || "구현 파일 미지정"}</small>
              {b.implementationSymbol && (
                <small>↳ {b.implementationSymbol}</small>
              )}
              {!!b.implementationLine && <small>↳ L{b.implementationLine}</small>}
            </span>
          </button>
        ))}
      </nav>
      <div className="code-list-resizer" role="separator" aria-label="블록 목록 너비 조절" aria-orientation="vertical"
        aria-valuemin={140} aria-valuemax={600} aria-valuenow={listWidth} tabIndex={0}
        onDoubleClick={() => resizeList(220)}
        onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); resizeList(listWidth + (e.key === 'ArrowRight' ? 20 : -20)); } }}
        onPointerDown={e => { if(e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); drag.current = {x: e.clientX, width: listWidth}; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if(drag.current) resizeList(drag.current.width + e.clientX - drag.current.x); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />
      <div className="code-file">
        <header>
          <div>
            <strong>{block.name}</strong>
            <small>
              {source?.path || block.implementation || "구현 파일 미지정"}
            </small>
          </div>
          <button
            title="코드 새로고침"
            aria-label="코드 새로고침"
            onClick={() => setRefresh((n) => n + 1)}
          >
            <RotateCcw size={16} />
          </button>
        </header>
        <div className="code-caption">
          {source?.language || "Source"} · 읽기 전용 · 현재 workspace 파일
          {source?.entryFound ? (
            <button className="entry-jump" onClick={jumpToEntry}>
              {source.explicitLine ? '지정한 시작 행' : source.entrySymbol} · L{source.startLine} ↗
            </button>
          ) : (
            source && (
              <small>
                시작 심볼을 찾지 못했습니다. Agent contract의 Entry symbol을
                지정하세요.
              </small>
            )
          )}
        </div>
        {error ? (
          <p className="code-message" role="alert">
            {error}
          </p>
        ) : !source ? (
          <p className="code-message">코드 불러오는 중…</p>
        ) : (
          <div
            className="source-scroll"
            ref={scroller}
            tabIndex={0}
            aria-label={`${block.name} 구현 코드`}
          >
            <pre>
              {lines.map((line, i) => (
                <div
                  className={`source-line ${source.entryFound && i + 1 === source.startLine ? "entry-line" : ""}`}
                  ref={i + 1 === source.startLine ? startRow : undefined}
                  key={i}
                >
                  <span className="line-number" aria-hidden="true">
                    {i + 1}
                  </span>
                  <code>
                    {line.length
                      ? line.map((part, j) => (
                          <span key={j} className={part.classes}>
                            {part.text}
                          </span>
                        ))
                      : " "}
                  </code>
                </div>
              ))}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}
