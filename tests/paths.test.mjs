import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {serverPaths} from "../server/paths.mjs";
import {openWorkspace} from "../server/workspaces.mjs";
import {fileURLToPath} from "node:url";

test("explicit workspaces isolate writable server state and retain local edits on repeated initialization",()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"isp-setup-"));
  try {
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
    const a=path.join(temp,"작업 A"), b=path.join(temp,"B");
    fs.mkdirSync(a);fs.mkdirSync(b);
    const env={ISP_STATE_HOME:path.join(temp,"state"),ISP_WORKSPACE:a};
    const first=serverPaths(root,env), second=serverPaths(root,{...env,ISP_WORKSPACE:b});
    assert.notEqual(first.runtime,second.runtime);
    assert.equal(first.initialFolder,fs.realpathSync(a));
    assert.ok(first.runtime.startsWith(env.ISP_STATE_HOME+path.sep));
    fs.writeFileSync(path.join(a,"AGENTS.md"),"My original instructions\n");
    openWorkspace(a,root);
    const skill=path.join(a,".agents/skills/isp-block-maker/SKILL.md");
    fs.appendFileSync(skill,"\nCustom rule\n");
    const content=fs.readFileSync(skill,"utf8");
    const graph=fs.readFileSync(path.join(a,"graph.json"),"utf8");
    openWorkspace(a,root);
    assert.equal(fs.readFileSync(skill,"utf8"),content);
    assert.equal(fs.readFileSync(path.join(a,"graph.json"),"utf8"),graph);
    assert.match(fs.readFileSync(path.join(a,"AGENTS.md"),"utf8"),/^My original instructions/);
    assert.match(fs.readFileSync(path.join(a,".isp/tools/isp.cmd"),"utf8"),/node\.exe|\/node/);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
