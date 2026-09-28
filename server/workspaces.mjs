import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createStore } from "./store.mjs";
import { installWorkspaceSkills } from "./skills.mjs";
import { ensureProjectLayout, normalizeWorkspaceFolder } from "./project-layout.mjs";

function checkGeneratedPath(workspace, relative) {
  let file = workspace;
  for (const part of relative.split("/")) {
    file = path.join(file, part);
    try {
      if (fs.lstatSync(file).isSymbolicLink())
        throw new Error(`Workspace setup cannot write through a linked path: ${relative}`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function openWorkspace(folder, root) {
  const workspace = normalizeWorkspaceFolder(folder);
  if (!fs.statSync(workspace).isDirectory())
    throw new Error("폴더를 선택하세요.");
  if ([root, path.join(root, "workspace"), path.join(root, "templates")].some(p => path.resolve(p) === workspace))
    throw new Error("프레임워크 또는 workspace 컨테이너 대신 프로젝트 폴더를 선택하세요.");
  for (const relative of ["AGENTS.md", "CLAUDE.md", ".isp/project.json", ".isp/artifacts", ".isp/tools/isp.mjs", ".isp/tools/isp.cmd", ".isp/tools/client.mjs", "project/graph.json", "project/AGENTS.md", "project/CLAUDE.md", "project/.gitignore", "project/isp.mjs"])
    checkGeneratedPath(workspace, relative);
  const dataDir = path.join(workspace, ".isp");
  const sourceRoot = ensureProjectLayout(workspace);
  const graphFile = path.join(sourceRoot, "graph.json");
  if (
    !fs.existsSync(graphFile) &&
    !fs.existsSync(path.join(dataDir, "project.json"))
  ) {
    fs.writeFileSync(
      graphFile,
      JSON.stringify(
        {
          name: path.basename(workspace),
          blocks: [
            {
              id: "input",
              name: "Input",
              description: "",
              principle: "",
              implementation: "",
              status: "draft",
              inputs: [],
              outputs: [],
              parameters: {},
              position: { x: 100, y: 100 },
            },
          ],
          edges: [],
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
  }
  const skills = installWorkspaceSkills(workspace, root);
  if (skills.pending.length)
    console.warn("Local skill edits preserved; updated templates are in .isp/skill-updates/: " + skills.pending.join(", "));
  const store = createStore(dataDir, graphFile);
  const artifactDir = path.join(dataDir, "artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  const cli = path.join(dataDir, "tools", "isp.mjs");
  {
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    const bridgeModule = JSON.stringify(pathToFileURL(path.join(root, "scripts/isp.mjs")).href);
    const bridgeSetup = `import fs from 'node:fs';\nimport path from 'node:path';\nconst workspace = ${JSON.stringify(workspace)};\nconst relative = path.relative(workspace, fs.realpathSync(process.cwd()));\nif (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Run this bridge inside its workspace');\nif (!process.env.ISP_API_TOKEN) { const c = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dataDir, "connection.json"))}, 'utf8')); process.env.ISP_API_URL = c.url; process.env.ISP_API_TOKEN = c.token; }\n`;
    fs.writeFileSync(
      cli,
      bridgeSetup + `const {main} = await import(${bridgeModule});\nawait main().catch(e=>{console.error(e.message);process.exitCode=1;});\n`,
    );
    fs.writeFileSync(path.join(dataDir, "tools", "client.mjs"), bridgeSetup +
      `const bridge = await import(${bridgeModule});\nexport const {connection, localConnection, request, registerArtifact} = bridge;\n`);
    fs.writeFileSync(
      path.join(dataDir, "tools", "isp.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0isp.mjs" %*\r\n`,
    );
    const legacySourceCli = path.join(sourceRoot, "isp.mjs");
    if (fs.existsSync(legacySourceCli)) {
      const original = fs.readFileSync(legacySourceCli, "utf8");
      if (/^\s*await import\((["'])\.\/\.isp\/tools\/isp\.mjs\1\);?\s*$/.test(original))
        fs.writeFileSync(legacySourceCli, 'await import("../.isp/tools/isp.mjs");\n');
    }
    const guidance =
      "\n<!-- ISP Block Maker workspace -->\nFor ISP graph and implementation work, read `.agents/skills/isp-block-maker/SKILL.md`. Use `node .isp/tools/isp.mjs` from this folder, or the absolute ISP_CLI path in terminals. project/graph.json and implementation code are versioned in project/.git; .isp/ contains local state and work tracking. Run source commands and Git inside project/; input data and workspace tools remain in this folder.\n";
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const file = path.join(workspace, name);
      if (
        !fs.existsSync(file) ||
        !fs
          .readFileSync(file, "utf8")
          .includes("<!-- ISP Block Maker workspace -->")
      )
        fs.appendFileSync(file, guidance);
      else {
        const old = fs.readFileSync(file, "utf8");
        const updated = old.replace("graph.json is versioned with implementation code; .isp/ contains local state.",
          "project/graph.json and implementation code are versioned in project/.git; .isp/ contains local state and work tracking. Run source commands and Git inside project/; input data and workspace tools remain in this folder.");
        if (updated !== old) fs.writeFileSync(file, updated);
      }
    }
    // Existing repositories may track project-level guidance. Preserve its text and
    // redirect agents to the single maintained skill set in the workspace parent.
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const file = path.join(sourceRoot, name);
      const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (!old.includes("<!-- ISP Block Maker source layout -->"))
        fs.appendFileSync(file, "\n<!-- ISP Block Maker source layout -->\nThis is the versioned source folder. The workspace is its parent. Read `../.agents/skills/isp-block-maker/SKILL.md` and the workspace `../AGENTS.md` for current ISP instructions; any copied skill files here are historical. Run `node ../.isp/tools/isp.mjs` or the absolute ISP_CLI. `graph.json` and implementation paths are relative to this source folder. Workspace data, artifacts, JOBs, attempts and tools are in the parent folder; do not copy them into this repository.\n");
    }
    const ignore = path.join(sourceRoot, ".gitignore");
    const text = fs.existsSync(ignore) ? fs.readFileSync(ignore, "utf8") : "";
    const missing = [".isp/", "/tmp/", "artifacts/generated/", "__pycache__/", "*.py[cod]"].filter(
      (line) => !text.split(/\r?\n/).includes(line),
    );
    if (missing.length)
      fs.appendFileSync(ignore, "\n" + missing.join("\n") + "\n");
  }
  return { workspace, sourceRoot, dataDir, artifactDir, store, cli };
}
