import fs from "node:fs/promises";
import path from "node:path";
import Prism from "prismjs";
import "prismjs/components/prism-python.js";

export function locateEntry(content, language, symbol = "", blockId = "") {
  const requested = symbol.trim() || blockId.replaceAll("-", "_");
  if (!requested) return { startLine: 1, entryFound: false, entrySymbol: "" };
  const grammar =
    language === "Python"
      ? Prism.languages.python
      : ["JavaScript", "TypeScript", "JSX", "TSX"].includes(language)
        ? Prism.languages.javascript
        : null;
  if (!grammar)
    return { startLine: 1, entryFound: false, entrySymbol: requested };
  const plain = (value) =>
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.map(plain).join("")
        : plain(value.content);
  const mask = (value) =>
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.map(mask).join("")
        : /comment|string|regex/.test(value.type)
          ? plain(value).replace(/[^\n]/g, " ")
          : mask(value.content);
  const rows = mask(Prism.tokenize(content, grammar)).split("\n");
  const entries = [],
    parents = [];
  rows.forEach((line, i) => {
    const match =
      language === "Python"
        ? /^(\s*)(?:async\s+def|def|class)\s+([A-Za-z_][\w]*)\b/.exec(line)
        : /^(\s*)(?:(?:export|default|async)\s+)*(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)\b/.exec(
            line,
          );
    if (!match) return;
    const indent = match[1].replaceAll("\t", "        ").length;
    while (parents.length && parents.at(-1).indent >= indent) parents.pop();
    const qualified = [...parents.map((p) => p.name), match[2]].join(".");
    entries.push({ name: match[2], qualified, line: i + 1 });
    if (language === "Python") parents.push({ name: match[2], indent });
  });
  const matches = entries.filter((e) =>
    requested.includes(".") ? e.qualified === requested : e.name === requested,
  );
  return {
    startLine: matches.length === 1 ? matches[0].line : 1,
    entryFound: matches.length === 1,
    entrySymbol: requested,
  };
}

export async function readImplementation(
  workspace,
  implementation,
  symbol = "",
  blockId = "",
) {
  if (!implementation?.trim())
    throw new Error("구현 파일이 지정되지 않았습니다.");
  const root = await fs.realpath(workspace);
  const file = await fs.realpath(path.resolve(root, implementation));
  const relative = path.relative(root, file);
  if (
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  )
    throw new Error("workspace 안의 구현 파일만 볼 수 있습니다.");
  const ext = path.extname(file).toLowerCase();
  const languages = {
    ".py": "Python",
    ".js": "JavaScript",
    ".mjs": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TSX",
    ".jsx": "JSX",
    ".c": "C",
    ".cpp": "C++",
    ".h": "C/C++",
    ".hpp": "C++",
    ".v": "Verilog",
    ".sv": "SystemVerilog",
    ".cl": "OpenCL",
    ".cu": "CUDA",
  };
  if (!languages[ext]) throw new Error("지원하는 소스 코드 파일이 아닙니다.");
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
    throw new Error("2MB 이하의 소스 파일만 표시할 수 있습니다.");
  const content = await fs.readFile(file, "utf8");
  if (content.includes("\0"))
    throw new Error("바이너리 파일은 표시할 수 없습니다.");
  return {
    ...locateEntry(content, languages[ext], symbol, blockId),
    path: relative.split(path.sep).join("/"),
    language: languages[ext],
    content,
    modifiedAt: stat.mtime.toISOString(),
  };
}
