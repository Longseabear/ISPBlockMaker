import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {agentShellEnvironment} from '../server/agent-shell.mjs';

test('shell commands attach workspace MCP, preserve arguments and exit codes without global settings', {skip:process.platform!=='win32'},t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-agent-shell-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true,maxRetries:5}));
 const workspace=path.join(temp,'workspace with spaces'),realBin=path.join(temp,'real bin');
 fs.mkdirSync(workspace,{recursive:true});
 for(const [agent,entry] of [['claude','@anthropic-ai/claude-code/cli.js'],['codex','@openai/codex/bin/codex.js']]){
  const target=path.join(realBin,'node_modules',entry);fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,`const fs=require('fs');const args=process.argv.slice(2);const i=args.indexOf('--mcp-config');fs.writeFileSync(process.env.TEST_RESULT,JSON.stringify({args,config:i>=0?JSON.parse(fs.readFileSync(args[i+1],'utf8')):null,file:i>=0?args[i+1]:null}));process.exitCode=7;`);
 }
 const env=agentShellEnvironment(workspace,{...process.env,PATH:realBin,ISP_WORKSPACE:workspace,ISP_API_URL:'http://127.0.0.1:4321',ISP_API_TOKEN:'fixture-token',ISP_MCP_AGENT_TOKEN:'must-not-inherit',TEST_RESULT:path.join(temp,'result.json')});
 const again=agentShellEnvironment(workspace,env);assert.equal(again.PATH,env.PATH);
 for(const agent of ['claude','codex']){
  const result=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`${agent} --model "model space" --resume`],{cwd:workspace,env,encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true});
  assert.equal(result.status,7,result.stderr);
  const record=JSON.parse(fs.readFileSync(env.TEST_RESULT,'utf8'));
  assert.deepEqual(record.args.slice(-3),['--model','model space','--resume']);
  if(agent==='claude'){
   assert.equal(record.config.mcpServers['isp-workspace'].headers.Authorization,'Bearer fixture-token');
   assert.equal(fs.existsSync(record.file),false);
  }else{
   assert.equal(record.args[0],'-c');assert.match(record.args[1],/mcp_servers\.isp-workspace=/);
   assert.ok(record.args[1].includes('fixture-token'));assert.ok(!record.args[1].includes('must-not-inherit'));
  }
 }
 const outside=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','claude'],{cwd:temp,env,encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true});
 assert.equal(outside.status,1);assert.match(outside.stderr,/inside its ISP workspace/);
 assert.equal(fs.existsSync(path.join(workspace,'.mcp.json')),false);
});
