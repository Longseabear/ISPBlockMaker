import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';

// Run with the distributed node.exe and an isolated package directory (outside
// this checkout), so missing modules cannot resolve through development installs.
const app=fs.realpathSync(process.argv[2]||'.');
assert.equal(fs.realpathSync(process.execPath).toLowerCase(),path.join(app,'node.exe').toLowerCase(),'Use the packaged node.exe');
const {Client}=await import(pathToFileURL(path.join(app,'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')));
const {StreamableHTTPClientTransport}=await import(pathToFileURL(path.join(app,'node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js')));
const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-package-smoke-'));
const child=spawn(process.execPath,[path.join(app,'server/index.mjs')],{cwd:app,env:{...process.env,PORT:String(port),ISP_WORKSPACE:workspace,ISP_STATE_HOME:path.join(workspace,'state'),ISP_NO_DISCOVERY:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
let diagnostics='',client,token,instance,hub;
child.stdout.on('data',chunk=>diagnostics+=chunk);child.stderr.on('data',chunk=>diagnostics+=chunk);
const origin=`http://127.0.0.1:${port}`;
try{
 const deadline=Date.now()+20000;let health;
 while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Packaged server exited: '+diagnostics);try{health=await fetch(origin+'/health').then(r=>r.json());break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(health,'Packaged server startup timed out: '+diagnostics);instance=health.instance;
 const boot=await fetch(origin+'/api/bootstrap').then(r=>r.json());token=boot.token;
 client=new Client({name:'package-verification',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
 const tools=await client.listTools();for(const name of ['search_workspace','register_report','launch_run','edit_graph','control_viewer'])assert.ok(tools.tools.some(t=>t.name===name),`Missing ${name}`);
 const searched=await client.callTool({name:'search_workspace',arguments:{query:boot.state.blocks[0].name}});assert.ok(!searched.isError,JSON.stringify(searched));assert.ok(searched.structuredContent.total>0);
 const info=await fetch(origin+'/api/workspace-info',{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json());assert.ok(fs.existsSync(path.join(info.dataDir,'search','index.sqlite')),'SQLite search database was not created');
 const sharing=await fetch(origin+'/api/mcp/sharing',{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json());assert.equal(sharing.enabled,false);
 assert.equal(health.agentApi,1);
 const {createHub}=await import(pathToFileURL(path.join(app,'server/hub.mjs')));
 const hubState=path.join(workspace,'hub-state');fs.mkdirSync(hubState);
 const workspaceId='ba76e167-94ea-49ae-b46a-3cac3a7f1153';
 fs.writeFileSync(path.join(hubState,'hub-projects.json'),JSON.stringify([{id:workspaceId,path:workspace}]));
 hub=await createHub({stateRoot:hubState,frameworkRoot:app,port:0});
 const settings=await fetch(hub.url+'/api/agent-settings',{method:'POST',headers:{Authorization:`Bearer ${hub.token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'enable',workspace_ids:[workspaceId]})}).then(r=>r.json());
 assert.ok(settings.token);
 const sessions=await fetch(hub.url+`/api/agent/v1/workspaces/${workspaceId}/sessions`,{headers:{Authorization:`Bearer ${settings.token}`}});assert.equal(sessions.status,200);assert.ok(Array.isArray((await sessions.json()).sessions));
 assert.ok(fs.existsSync(path.join(app,'docs/personal-agent-api.md')));
 console.log(JSON.stringify({verified:true,node:process.version,tools:tools.tools.length,searchMatches:searched.structuredContent.total,sharingDefault:'disabled',centralAgentApi:'verified',package:app}));
}finally{
 await hub?.close();
 await client?.close();
 if(child.exitCode===null){const exited=once(child,'exit');if(token&&instance)await fetch(origin+'/api/shutdown',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({instance})}).catch(()=>child.kill());else child.kill();await exited;}
 fs.rmSync(workspace,{recursive:true,force:true,maxRetries:10});
}
