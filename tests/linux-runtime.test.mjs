import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {claudeRuntime} from '../server/claude-interaction.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const until=async predicate=>{for(let i=0;i<200;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out');};

test('Linux CLI starts browser server, MCP PTY executes, Recipe launches and SIGTERM exits',{skip:process.platform!=='linux',timeout:60000},async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-linux-test-'));
 let child,client;
 try {
  const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const workspace=path.join(temp,'workspace with spaces'),origin=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,[path.join(root,'scripts/workspace-cli.mjs'),workspace],{cwd:temp,env:{...process.env,PORT:String(port),ISP_STATE_HOME:path.join(temp,'state'),ISP_NO_DISCOVERY:'1',SHELL:'/bin/bash'},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  await until(()=>{if(child.exitCode!==null)throw Error(log);return log.includes(origin);});
  assert.match(log,/Startup checks passed/);
  assert.match(await fetch(origin).then(r=>r.text()),/<html/);
  const boot=await fetch(origin+'/api/bootstrap').then(r=>r.json());
  client=new Client({name:'linux-test',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+boot.token}}}));
  const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent;};
  assert.equal((await call('get_workspace_info')).workspace,workspace);
  const session_id=crypto.randomUUID(),terminal=await call('create_shared_terminal',{session_id,title:'Linux smoke'});
  const sent=await call('submit_shared_terminal_command',{session_id,request_id:crypto.randomUUID(),control_version:terminal.controlVersion,command:"printf '%s%s\\n' LINUX_Executed_ OK"});
  await until(async()=> (await call('read_shared_terminal',{session_id,cursor:sent.outputCursorBeforeWrite})).output.includes('LINUX_Executed_OK'));
  await call('stop_shared_terminal',{session_id,control_version:terminal.controlVersion});
  const request=async(route,body)=>{const r=await fetch(origin+route,{method:'POST',headers:{Authorization:'Bearer '+boot.token,'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;};
  const recipe={version:1,id:'linux-smoke',title:'Linux smoke',executable:process.execPath,args:['-e',"require('fs').writeFileSync('linux-result.txt','executed')"],expectedOutputs:['linux-result.txt']};
  const saved=await request('/api/recipes',{recipe,expectedHash:null});
  await request('/api/recipes/linux-smoke/launch',{expectedHash:saved.hash});
  await until(()=>fs.existsSync(path.join(workspace,'project/linux-result.txt')));
  assert.equal(fs.readFileSync(path.join(workspace,'project/linux-result.txt'),'utf8'),'executed');
  const longRecipe={version:1,id:'linux-stop',title:'Linux stop',executable:process.execPath,args:['-e',"require('fs').writeFileSync('recipe-pid.txt',String(process.pid));setInterval(()=>{},1000)"]};
  const longSaved=await request('/api/recipes',{recipe:longRecipe,expectedHash:null});
  const running=await request('/api/recipes/linux-stop/launch',{expectedHash:longSaved.hash});
  const pidFile=path.join(workspace,'project/recipe-pid.txt');await until(()=>fs.existsSync(pidFile));
  const pid=Number(fs.readFileSync(pidFile,'utf8'));
  assert.equal((await fetch(origin+'/api/terminals/'+running.sessionId,{method:'DELETE',headers:{Authorization:'Bearer '+boot.token}})).status,200);
  await until(()=>{try{process.kill(pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}});
  await client.close();client=null;
  const exited=once(child,'exit');child.kill('SIGTERM');
  const [code]=await exited;assert.equal(code,0,log);
 } finally {
  await client?.close();
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
  fs.rmSync(temp,{recursive:true,force:true});
 }
});

test('Linux Claude runtime accepts an installed executable and rejects a non-executable file',{skip:process.platform!=='linux'},()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-linux-claude-'));
 try {
  const file=path.join(temp,'claude');fs.writeFileSync(file,'#!/bin/sh\necho "2.1.306 (Claude Code)"\n',{mode:0o755});
  assert.equal(claudeRuntime({...process.env,ISP_CLAUDE_PATH:file}).file,file);
  fs.chmodSync(file,0o644);assert.throws(()=>claudeRuntime({...process.env,ISP_CLAUDE_PATH:file}),/EACCES/);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
