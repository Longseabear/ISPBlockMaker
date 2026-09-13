import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createStore } from "./store.mjs";

export function openWorkspace(folder, root) {
  const workspace = fs.realpathSync(folder);
  if (!fs.statSync(workspace).isDirectory())
    throw new Error("폴더를 선택하세요.");
  const isDefault = workspace === fs.realpathSync(path.join(root, "workspace"));
  const dataDir = isDefault
    ? path.join(root, ".isp")
    : path.join(workspace, ".isp");
  const graphFile = path.join(workspace, "graph.json");
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
  const store = createStore(dataDir, graphFile);
  const artifactDir = path.join(dataDir, "artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  const cli = isDefault
    ? path.join(workspace, "isp.mjs")
    : path.join(dataDir, "tools", "isp.mjs");
  if (!isDefault) {
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(
      cli,
      `import fs from 'node:fs';\nimport path from 'node:path';\nconst workspace = ${JSON.stringify(workspace)};\nconst relative = path.relative(workspace, fs.realpathSync(process.cwd()));\nif (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Run this CLI inside its workspace');\nif (!process.env.ISP_API_TOKEN) { const c = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dataDir, "connection.json"))}, 'utf8')); process.env.ISP_API_URL = c.url; process.env.ISP_API_TOKEN = c.token; }\nconst {main} = await import(${JSON.stringify(pathToFileURL(path.join(root, "scripts/isp.mjs")).href)});\nawait main().catch(e=>{console.error(e.message);process.exitCode=1;});\n`,
    );
    fs.writeFileSync(
      path.join(dataDir, "tools", "isp.cmd"),
      '@echo off\r\nnode "%~dp0isp.mjs" %*\r\n',
    );
    const skill = path.join(
      workspace,
      ".agents/skills/isp-block-maker/SKILL.md",
    );
    if (!fs.existsSync(skill)) {
      fs.mkdirSync(path.dirname(skill), { recursive: true });
      const template = fs.readFileSync(
        path.join(root, "workspace/.agents/skills/isp-block-maker/SKILL.md"),
        "utf8",
      );
      fs.writeFileSync(
        skill,
        template
          .replace("../../../isp.mjs", "../../../.isp/tools/isp.mjs")
          .replaceAll('"<absolute workspace>/isp.mjs"', '"<absolute workspace>/.isp/tools/isp.mjs"')
          .replaceAll("workspace/graph.json", "graph.json"),
      );
    }
    const claudeSkill = path.join(
      workspace,
      ".claude/skills/isp-block-maker/SKILL.md",
    );
    if (!fs.existsSync(claudeSkill)) {
      fs.mkdirSync(path.dirname(claudeSkill), { recursive: true });
      fs.copyFileSync(
        path.join(root, "workspace/.claude/skills/isp-block-maker/SKILL.md"),
        claudeSkill,
      );
    }
    const guidance =
      "\n<!-- ISP Block Maker workspace -->\nFor ISP graph and implementation work, read `.agents/skills/isp-block-maker/SKILL.md`. Use `node .isp/tools/isp.mjs` from this folder, or the absolute ISP_CLI path in terminals. graph.json is versioned with implementation code; .isp/ contains local state.\n";
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const file = path.join(workspace, name);
      if (
        !fs.existsSync(file) ||
        !fs
          .readFileSync(file, "utf8")
          .includes("<!-- ISP Block Maker workspace -->")
      )
        fs.appendFileSync(file, guidance);
    }
    const ignore = path.join(workspace, ".gitignore");
    const text = fs.existsSync(ignore) ? fs.readFileSync(ignore, "utf8") : "";
    const missing = [".isp/", "artifacts/generated/"].filter(
      (line) => !text.split(/\r?\n/).includes(line),
    );
    if (missing.length)
      fs.appendFileSync(ignore, "\n" + missing.join("\n") + "\n");
  }
  return { workspace, dataDir, artifactDir, store, cli };
}
