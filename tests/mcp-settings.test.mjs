import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {readMcpSettings,saveMcpSettings,agentMcpConfig,prepareMcpLaunch,resolveAgent,mcpServerSchema} from '../server/mcp-settings.mjs';
import {planBundle} from '../server/bundles.mjs';
const server=(name='tools')=>({name,enabled:true,agents:['codex','claude'],transport:'stdio',command:'node',args:['folder with spaces/server.mjs','a"b','& echo INJECTION','한글'],env:{TOKEN:'test-only'},url:'',headers:{}});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isp-mcp-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('MCP CRUD preserves multiple servers, isolates workspaces, and rejects stale edits and invalid inputs',t=>{
 const dir=fixture(t),other=fixture(t);assert.deepEqual(readMcpSettings(dir),{revision:0,servers:[]});
 const saved=saveMcpSettings(dir,{revision:0,servers:[server(),{...server('remote'),transport:'http',url:'https://example.com/mcp',headers:{Authorization:'Bearer test-only'},agents:['claude']}]});
 assert.deepEqual(readMcpSettings(dir),saved);assert.equal(readMcpSettings(other).servers.length,0);
 assert.throws(()=>saveMcpSettings(dir,{revision:0,servers:[]}),/변경/);
 assert.throws(()=>saveMcpSettings(dir,{revision:1,servers:[server(),server()]}),/중복/);
 assert.throws(()=>mcpServerSchema.parse({...server(),transport:'http',url:'file:///secret'}));
 assert.throws(()=>mcpServerSchema.parse({...server(),name:'x.y'}));
 assert.throws(()=>mcpServerSchema.parse({...server(),headers:{Authorization:'value\r\nInjected: yes'}}));
 const disabled=saveMcpSettings(dir,{revision:1,servers:saved.servers.map(s=>({...s,enabled:false}))});assert.deepEqual(agentMcpConfig(disabled.servers,'codex'),{});
 assert.equal(saveMcpSettings(dir,{revision:2,servers:[]}).servers.length,0);
});
test('MCP adapters retain arguments, select target agents and use actual client field names',()=>{
 const servers=[server(),{...server('http'),transport:'http',url:'https://example.com/mcp',headers:{Authorization:'Bearer test'},agents:['codex']},{...server('disabled'),enabled:false}];
 const codex=agentMcpConfig(servers,'codex'),claude=agentMcpConfig(servers,'claude');
 assert.deepEqual(codex.tools.args,servers[0].args);assert.deepEqual(codex.http,{url:'https://example.com/mcp',http_headers:{Authorization:'Bearer test'}});
 assert.equal(claude.tools.type,'stdio');assert.equal(claude.http,undefined);assert.equal(codex.disabled,undefined);
});
test('launch uses argv, private per-session Claude files, and cleans up only owned files',t=>{
 const dir=fixture(t),bin=path.join(dir,'bin');fs.mkdirSync(bin);const win=process.platform==='win32';
 for(const name of ['codex','claude'])fs.copyFileSync(process.execPath,path.join(bin,name+(win?'.exe':'')));
 const env={...process.env,PATH:bin};saveMcpSettings(dir,{revision:0,servers:[server()]});
 const c=prepareMcpLaunch(dir,'codex',crypto.randomUUID(),env);assert.equal(c.launch.command,path.join(bin,'codex'+(win?'.exe':'')));assert.equal(c.launch.args[0],'-c');assert.match(c.launch.args[1],/^mcp_servers.tools=/);assert.ok(c.launch.args[1].includes('& echo INJECTION'));
 const a=prepareMcpLaunch(dir,'claude',crypto.randomUUID(),env),b=prepareMcpLaunch(dir,'claude',crypto.randomUUID(),env);assert.equal(a.launch.args[0],'--mcp-config');const file=a.launch.args[1];assert.deepEqual(JSON.parse(fs.readFileSync(file)).mcpServers.tools.args,server().args);a.cleanup();assert.equal(fs.existsSync(file),false);assert.ok(fs.existsSync(b.launch.args[1]));b.cleanup();
 assert.throws(()=>resolveAgent('codex',{PATH:path.join(dir,'missing')}),/찾을 수/);
});
test('settings reject linked state and stay out of project bundles',async t=>{
 const dir=fixture(t),outside=fixture(t);fs.mkdirSync(path.join(dir,'project'));fs.writeFileSync(path.join(dir,'project/graph.json'),JSON.stringify({name:'MCP',blocks:[{id:'input',name:'Input',description:'',principle:'',implementation:'',status:'draft',position:{x:0,y:0},inputs:[],outputs:[],parameters:{}}],edges:[]}));fs.mkdirSync(path.join(dir,'.isp'));fs.writeFileSync(path.join(dir,'.isp/workspace.json'),JSON.stringify({version:1,sourceRoot:'project'}));
 saveMcpSettings(dir,{revision:0,servers:[server()]});const plan=await planBundle(dir);assert.ok(!plan.files.some(f=>f.path.includes('mcp-settings')));
 const linked=fixture(t);fs.symlinkSync(outside,path.join(linked,'.isp'),process.platform==='win32'?'junction':'dir');assert.throws(()=>saveMcpSettings(linked,{revision:0,servers:[server()]}),/Linked/);
});
