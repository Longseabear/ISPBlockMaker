import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Interaction} from '../server/interaction.mjs';
import {McpAgents} from '../server/mcp-agents.mjs';
import {effectiveMcpServers} from '../server/mcp-settings.mjs';
test('Codex chat configs receive distinct connection credentials without storing them in chat state',async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-agent-id-')),agents=new McpAgents();
 const m=new Interaction({workspace,env:{ISP_API_URL:'http://127.0.0.1:4310',ISP_API_TOKEN:'master-token',ISP_WORKSPACE:workspace},agentIdentity:(id,label)=>agents.issue(label,id),releaseAgent:id=>agents.revoke(id)});
 t.after(async()=>{await m.close();fs.rmSync(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 m.connect=async()=>{m.account={type:'test'};};const configs=[];m.rpc=async(method,params)=>{if(method==='thread/start'){configs.push(params.config);return {thread:{id:crypto.randomUUID()}};}return {turn:{id:crypto.randomUUID()}};};
 await m.sendNow({text:'A',provider:'codex'});await m.sendNow({text:'B',provider:'codex'});
 const tokens=configs.map(c=>c.mcp_servers['isp-workspace'].http_headers.Authorization);assert.notEqual(tokens[0],tokens[1]);assert.ok(tokens.every(t=>!t.includes('master-token')));
 await m.flushSaves();const saved=fs.readFileSync(m.file,'utf8');assert.ok(tokens.every(t=>!saved.includes(t.slice(7))));
 const one=agents.authenticate(tokens[0].slice(7));assert.ok(one);await m.disconnect();assert.equal(agents.authenticate(tokens[0].slice(7)),null);
});
test('Claude and terminal adapters prefer issued connection credentials over shared API token',()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-agent-mcp-'));
 try{const servers=effectiveMcpServers(workspace,{ISP_WORKSPACE:workspace,ISP_API_URL:'http://127.0.0.1:4310',ISP_API_TOKEN:'master',ISP_MCP_AGENT_TOKEN:'connection'});assert.equal(servers.at(-1).headers.Authorization,'Bearer connection');}finally{fs.rmSync(workspace,{recursive:true,force:true});}
});
