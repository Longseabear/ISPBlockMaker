import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Only shells started by this application inherit these launchers.
export function agentShellEnvironment(workspace, env){
 let bin=path.resolve(workspace);
 for(const part of ['.isp','tools','agent-bin']){
  bin=path.join(bin,part);
  if(fs.existsSync(bin)&&fs.lstatSync(bin).isSymbolicLink())throw Error('Agent launcher directory must not be linked');
  fs.mkdirSync(bin,{recursive:true});
 }
 for(const agent of ['claude','codex']){
  const file=path.join(bin,agent+(process.platform==='win32'?'.cmd':''));
  if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Agent launcher must not be linked');
  const content=process.platform==='win32'?`@echo off\r\n"%ISP_NODE%" "%ISP_AGENT_LAUNCHER%" ${agent} %*\r\n`:`#!/bin/sh\nexec "$ISP_NODE" "$ISP_AGENT_LAUNCHER" ${agent} "$@"\n`;
  if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==content)fs.writeFileSync(file,content,{mode:0o700});
 }
 const original=env.ISP_AGENT_ORIGINAL_PATH||env.PATH||env.Path||'';
 const result={...env,ISP_AGENT_ORIGINAL_PATH:original,ISP_NODE:process.execPath,ISP_AGENT_LAUNCHER:fileURLToPath(new URL('../scripts/agent-shell.mjs',import.meta.url)),PATH:bin+path.delimiter+original};
 delete result.Path;
 return result;
}
