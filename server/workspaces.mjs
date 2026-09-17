import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createStore } from "./store.mjs";

export function openWorkspace(folder, root) {
  const workspace = fs.realpathSync(folder);
  if (!fs.statSync(workspace).isDirectory())
    throw new Error("폴더를 선택하세요.");
  if ([root, path.join(root, "workspace"), path.join(root, "templates")].some(p => path.resolve(p) === workspace))
    throw new Error("프레임워크 또는 workspace 컨테이너 대신 프로젝트 폴더를 선택하세요.");
  const dataDir = path.join(workspace, ".isp");
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
  const cli = path.join(dataDir, "tools", "isp.mjs");
  {
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(
      cli,
      `import fs from 'node:fs';\nimport path from 'node:path';\nconst workspace = ${JSON.stringify(workspace)};\nconst relative = path.relative(workspace, fs.realpathSync(process.cwd()));\nif (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Run this CLI inside its workspace');\nif (!process.env.ISP_API_TOKEN) { const c = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dataDir, "connection.json"))}, 'utf8')); process.env.ISP_API_URL = c.url; process.env.ISP_API_TOKEN = c.token; }\nconst {main} = await import(${JSON.stringify(pathToFileURL(path.join(root, "scripts/isp.mjs")).href)});\nawait main().catch(e=>{console.error(e.message);process.exitCode=1;});\n`,
    );
    fs.writeFileSync(
      path.join(dataDir, "tools", "isp.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0isp.mjs" %*\r\n`,
    );
    const skill = path.join(
      workspace,
      ".agents/skills/isp-block-maker/SKILL.md",
    );
    if (!fs.existsSync(skill)) {
      fs.mkdirSync(path.dirname(skill), { recursive: true });
      const template = fs.readFileSync(
        path.join(root, "templates/project/.agents/skills/isp-block-maker/SKILL.md"),
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
    const viewerGuide=path.join(path.dirname(skill),"viewer.md");
    if(!fs.existsSync(viewerGuide))fs.copyFileSync(path.join(root,"templates/project/.agents/skills/isp-block-maker/viewer.md"),viewerGuide);
    if(!fs.readFileSync(viewerGuide,"utf8").includes("## Crop batch description")){const guide=fs.readFileSync(path.join(root,"templates/project/.agents/skills/isp-block-maker/viewer.md"),"utf8");fs.appendFileSync(viewerGuide,"\n\n## Crop batch description"+guide.split("## Crop batch description")[1]);}
    if(!fs.readFileSync(viewerGuide,"utf8").includes("## Multi-region crop items")){const guide=fs.readFileSync(path.join(root,"templates/project/.agents/skills/isp-block-maker/viewer.md"),"utf8");fs.appendFileSync(viewerGuide,"\n\n## Multi-region crop items"+guide.split("## Multi-region crop items")[1]);}
    const viewerGuideText=fs.readFileSync(viewerGuide,"utf8");
    if(viewerGuideText.includes("Shift-drag to pan"))fs.writeFileSync(viewerGuide,viewerGuideText.replaceAll("Shift-drag to pan","right/middle-drag to pan"));
    if(!fs.readFileSync(skill,"utf8").includes("viewer.md"))fs.appendFileSync(skill,"\n\n## Image Viewer and user-selected crops\nWhen image analysis needs a user-selected region, read `viewer.md` beside this skill. Request and present an ROI, then read the submitted crop and metadata.\n");
    const sddGuide = path.join(path.dirname(skill), "sdd.md");
    if (!fs.existsSync(sddGuide)) fs.copyFileSync(path.join(root, "templates/project/.agents/skills/isp-block-maker/sdd.md"), sddGuide);
    if (!fs.readFileSync(skill, "utf8").includes("sdd.md"))
      fs.appendFileSync(skill, "\n\n## SDD documentation\nFor Documentation / SDD requests, read `sdd.md` beside this skill. Generate self-contained HTML in Overview → Flow → block details order and register with `isp document`.\n");
    const loopGuide = path.join(path.dirname(skill), "experiment-loop.md");
    if (!fs.existsSync(loopGuide)) fs.copyFileSync(path.join(root, "templates/project/.agents/skills/isp-block-maker/experiment-loop.md"), loopGuide);
    if (!fs.readFileSync(skill, "utf8").includes("experiment-loop.md"))
      fs.appendFileSync(skill, "\n\n## Repeatable experiment loop\nFor iteration or remaining JOB requests, read `experiment-loop.md` beside this skill. Do not start an indefinite scheduler.\n");
    const temporaryGuide = path.join(path.dirname(skill), "temporary-files.md");
    if (!fs.existsSync(temporaryGuide)) fs.copyFileSync(path.join(root,"templates/project/.agents/skills/isp-block-maker/temporary-files.md"),temporaryGuide);
    const graphGuide = path.join(path.dirname(skill), "graph-overview.md");
    if (!fs.existsSync(graphGuide)) fs.copyFileSync(path.join(root,"templates/project/.agents/skills/isp-block-maker/graph-overview.md"),graphGuide);
    let skillText=fs.readFileSync(skill,"utf8");
    if(!skillText.includes("graph-overview.md"))skillText+="\n\n## Whole-graph context\nRead `graph-overview.md` and `isp graph-info` before pipeline work. Keep the graph purpose, entry points, constraints and freeform agent notes synchronized with implementation.\n";
    skillText=skillText.replace("Store the temporary JSON in ignored `.isp/` so it does not dirty implementation history.","Store the temporary JSON in `tmp/<task-or-job-id>/` so it does not dirty implementation history.");
    if(!skillText.includes("temporary-files.md"))skillText+="\n\n## Intermediate work products\nCreate intermediate outputs in workspace-root `tmp/<task-or-job-id>/`. Read `temporary-files.md` for final-output promotion, sharing and cleanup rules. Keep final implementations and registered results outside `tmp/`.\n";
    if(!skillText.includes('## Explicit JOB registration')){
      const template=fs.readFileSync(path.join(root,'templates/project/.agents/skills/isp-block-maker/SKILL.md'),'utf8');
      skillText+='\n\n## Explicit JOB registration'+template.split('## Explicit JOB registration')[1];
    }
    if(!skillText.includes('## Split and merge existing JOBs')){
      const template=fs.readFileSync(path.join(root,'templates/project/.agents/skills/isp-block-maker/SKILL.md'),'utf8');
      skillText+='\n\n## Split and merge existing JOBs'+template.split('## Split and merge existing JOBs')[1];
    }
    if(fs.readFileSync(skill,"utf8")!==skillText)fs.writeFileSync(skill,skillText);
    const claudeSkill = path.join(
      workspace,
      ".claude/skills/isp-block-maker/SKILL.md",
    );
    if (!fs.existsSync(claudeSkill)) {
      fs.mkdirSync(path.dirname(claudeSkill), { recursive: true });
      fs.copyFileSync(
        path.join(root, "templates/project/.claude/skills/isp-block-maker/SKILL.md"),
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
    const missing = [".isp/", "/tmp/", "artifacts/generated/", "__pycache__/", "*.py[cod]"].filter(
      (line) => !text.split(/\r?\n/).includes(line),
    );
    if (missing.length)
      fs.appendFileSync(ignore, "\n" + missing.join("\n") + "\n");
  }
  return { workspace, dataDir, artifactDir, store, cli };
}
