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
    project.revision,
    refresh,
    api,
  ]);
  return (
    <section className="code-workspace">
      <nav className="code-node-list" aria-label="구현 코드 노드 목록">
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
            </span>
          </button>
        ))}
      </nav>
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
              {source.entrySymbol} · L{source.startLine} ↗
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
