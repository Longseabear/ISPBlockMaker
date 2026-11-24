import {WebSocket} from "ws";
import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test('external MCP uses existing configuration to create and operate isolated real terminals',{timeout:30000},async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-external-mcp-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const {origin}=await startServer(t,temp,'workspace');
 const boot=await fetch(origin+'/api/bootstrap').then(r=>r.json());
 const clients=[],transports=[];t.after(()=>Promise.all(clients.map(c=>c.close())));
 for(let i=0;i<2;i++){
  const client=new Client({name:'external-codex',version:'1'}),transport=new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+boot.token}}});
  clients.push(client);transports.push(transport);await client.connect(transport);
 }
 assert.ok(transports[0].sessionId);assert.notEqual(transports[0].sessionId,transports[1].sessionId);
 const info=await clients[0].callTool({name:'get_workspace_info',arguments:{}});assert.equal(info.structuredContent.workspace,path.join(temp,'workspace'));
 const summary={request_id:crypto.randomUUID(),title:'Private summary title',summary:'PRIVATE_PAYLOAD_NEVER_IN_DIAGNOSTICS'};
 const recorded=await clients[0].callTool({name:'record_work_summary',arguments:summary});assert.ok(!recorded.isError);
 const retried=await clients[0].callTool({name:'record_work_summary',arguments:summary});assert.equal(retried.structuredContent.id,recorded.structuredContent.id);
 const activity=await fetch(origin+'/api/activity',{headers:{Authorization:'Bearer '+boot.token}}).then(r=>r.json());assert.equal(activity.filter(e=>e.id===recorded.structuredContent.id).length,1);
 const session_id=crypto.randomUUID();
 const created=await clients[0].callTool({name:'create_shared_terminal',arguments:{session_id,title:'External shell'}});
 assert.ok(!created.isError,JSON.stringify(created));
 // The success marker is absent from the submitted line, so terminal input echo
 // cannot masquerade as command execution.
 const command=`"${process.execPath}" -e "console.log(['EXTERNAL','MCP','READY'].join('_'))"`;
 const input={session_id,request_id:crypto.randomUUID(),control_version:created.structuredContent.controlVersion,data:command+'\r'};
 const submitted=await clients[0].callTool({name:'submit_shared_terminal_command',arguments:{session_id,request_id:input.request_id,control_version:input.control_version,command}});
 assert.ok(!submitted.isError);assert.equal(submitted.structuredContent.inputAccepted,true);
 assert.equal((await clients[1].callTool({name:'write_shared_terminal',arguments:{...input,request_id:crypto.randomUUID()}})).isError,true);
 let output='';const deadline=Date.now()+5000;
 while(!output.includes('EXTERNAL_MCP_READY')&&Date.now()<deadline){
  const result=await clients[0].callTool({name:'read_shared_terminal',arguments:{session_id,cursor:submitted.structuredContent.outputCursorBeforeWrite}});assert.ok(!result.isError);output=result.structuredContent.output;
  if(!output.includes('EXTERNAL_MCP_READY'))await new Promise(r=>setTimeout(r,100));
 }
 assert.match(output,/EXTERNAL_MCP_READY/);
 const diagnostics=await clients[0].callTool({name:'get_runtime_diagnostics',arguments:{}});assert.ok(!diagnostics.isError);
 assert.ok(diagnostics.structuredContent.recent.some(r=>r.name==='record_work_summary'&&r.kind==='tool'&&r.ms>=0));
 assert.ok(!JSON.stringify(diagnostics).includes(summary.summary));assert.ok(!JSON.stringify(diagnostics).includes(boot.token));
 assert.equal((await fetch(origin+'/api/diagnostics/performance')).status,401);
 assert.ok(!(await clients[0].callTool({name:'stop_shared_terminal',arguments:{session_id,control_version:0}})).isError);
 await Promise.all(transports.map(transport=>transport.terminateSession()));
});

test('shared terminal MCP and WebSocket share a real shell without opening a view',{timeout:30000},async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-shared-api-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const {origin}=await startServer(t,temp,'workspace');
 const boot=await fetch(origin+'/api/bootstrap').then(r=>r.json()),headers={Authorization:'Bearer '+boot.token,'Content-Type':'application/json'};
 const request=async(route,body,method=body?'POST':'GET')=>{const response=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});return {status:response.status,value:await response.json()};};
 assert.equal((await fetch(origin+'/api/shared-terminals')).status,401);
 const ws=new WebSocket(origin.replace('http:','ws:')+'/ws?token='+boot.token),events=[];ws.on('message',data=>events.push(JSON.parse(data)));t.after(()=>ws.terminate());await once(ws,'open');ws.send(JSON.stringify({type:'shared-subscribe'}));
 const session_id=crypto.randomUUID();
 const client=new Client({name:'shared-terminal-test',version:'1'});t.after(()=>client.close());
 const agentCredential=(await request('/api/mcp/agents',{label:'Test agent A'})).value;
 await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+agentCredential.token}}}));
 const created=await client.callTool({name:'create_shared_terminal',arguments:{session_id,title:'Shared shell test'}});assert.equal(created.isError,undefined);
 const secondCredential=(await request('/api/mcp/agents',{label:'Test agent B'})).value;
 const agentRequest=async(credential,suffix,body)=>fetch(origin+'/api/shared-terminals/'+session_id+suffix,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential.token},body:JSON.stringify(body)});
 const forbidden=await agentRequest(secondCredential,'/input',{requestId:crypto.randomUUID(),data:'echo FORGED\r',actor:'user',controlVersion:0});assert.equal(forbidden.status,400);
 assert.equal((await agentRequest(secondCredential,'/stop',{controlVersion:0})).status,400);
 assert.equal((await agentRequest(secondCredential,'/control',{owner:'agent',agentId:secondCredential.id,controlVersion:0})).status,400);
 const request_id=crypto.randomUUID(),command='echo SHARED_TERMINAL_OK\r';
 const written=await client.callTool({name:'write_shared_terminal',arguments:{session_id,request_id,control_version:0,data:command}});assert.equal(written.isError,undefined);
 const wait=async check=>{const start=Date.now();while(!await check()){if(Date.now()-start>8000)throw Error('Shared terminal condition timed out');await new Promise(r=>setTimeout(r,40));}};
 await wait(async()=>{const r=await request('/api/shared-terminals/'+session_id+'/output');return r.value.output.includes('SHARED_TERMINAL_OK');});
 assert.equal(events.some(e=>e.type==='shared-present'),false);assert.equal(events.some(e=>e.type==='shared-output'),false);
 ws.send(JSON.stringify({type:'shared-attach',id:session_id}));await wait(()=>events.some(e=>e.type==='shared-attached'&&e.buffer.includes('SHARED_TERMINAL_OK')));
 await request('/api/shared-terminals/'+session_id+'/control',{owner:'user'});
 const denied=await client.callTool({name:'write_shared_terminal',arguments:{session_id,control_version:0,request_id:crypto.randomUUID(),data:'echo blocked\r'}});assert.equal(denied.isError,true);
 ws.send(JSON.stringify({type:'shared-input',controlVersion:1,requestId:crypto.randomUUID(),data:'echo USER_INPUT_OK\r'}));await wait(()=>events.some(e=>e.type==='shared-output'&&e.data.includes('USER_INPUT_OK')));
 assert.equal((await request('/api/shared-terminals/'+session_id+'/output')).value.userInputSequence,1);
 await client.callTool({name:'present_shared_terminal',arguments:{session_id,reason:'inspect',message:'Inspect the shared test output'}});await wait(()=>events.some(e=>e.type==='shared-present'));
 ws.send(JSON.stringify({type:'shared-detach'}));await new Promise(r=>setTimeout(r,50));
 await request('/api/shared-terminals/'+session_id+'/control',{owner:'agent'});
 const serverCommand=`"${process.execPath}" -e "const s=require('node:http').createServer((q,r)=>r.end('shared server'));s.listen(0,'127.0.0.1',()=>console.log('SERVER_PORT:'+s.address().port));"\r`;
 await client.callTool({name:'write_shared_terminal',arguments:{session_id,control_version:2,request_id:crypto.randomUUID(),data:serverCommand}});
 let serverPort;await wait(async()=>{const r=await request('/api/shared-terminals/'+session_id+'/output');serverPort=r.value.output.match(/SERVER_PORT:(\d+)/)?.[1];return !!serverPort;});
 assert.equal(await fetch('http://127.0.0.1:'+serverPort).then(r=>r.text()),'shared server');
 await request('/api/shared-terminals/'+session_id+'/stop',{});await wait(async()=>(await request('/api/shared-terminals/'+session_id+'/output')).value.status==='exited');
 await assert.rejects(fetch('http://127.0.0.1:'+serverPort,{signal:AbortSignal.timeout(1000)}));
 await request('/api/mcp/agents/'+agentCredential.id+'/revoke',{});
 assert.equal((await agentRequest(agentCredential,'/stop',{controlVersion:2})).status,401);
 assert.equal((await request('/api/shared-terminals/'+session_id+'/output')).value.output.includes('USER_INPUT_OK'),true);
});

async function startServer(t, temp, name, extraEnv={}) {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const { port } = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  const workspace = path.join(temp, name);
  fs.mkdirSync(workspace);
  const child = spawn(process.execPath, [path.join(root, "server/index.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      ISP_WORKSPACE: workspace,
      ISP_STATE_HOME: path.join(temp, "state"),
      ISP_NO_DISCOVERY: "1",
      ...extraEnv,
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Server did not start: ${diagnostics}`)), 15000);
    const onData = chunk => {
      diagnostics += chunk;
      if (diagnostics.includes(`http://127.0.0.1:${port}`)) finish();
    };
    const onExit = code => finish(new Error(`Server exited (${code}): ${diagnostics}`));
    const onError = error => finish(error);
    function finish(error) {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
      error ? reject(error) : resolve();
    }
    child.stdout.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
  return { origin: `http://127.0.0.1:${port}`, port };
}




test('MCP API protects settings and applies multiple servers to an actual PTY agent launch', {skip:process.platform!=='win32'},async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-mcp-api-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const bin=path.join(temp,'bin'),entry=path.join(bin,'node_modules/@openai/codex/bin/codex.js');fs.mkdirSync(path.dirname(entry),{recursive:true});
 fs.writeFileSync(entry,"console.log('MCP_ARGV:'+Buffer.from(JSON.stringify(process.argv.slice(2))).toString('base64'));setInterval(()=>{},1000);");
 const {origin}=await startServer(t,temp,'workspace',{PATH:bin+path.delimiter+process.env.PATH});
 const boot=await fetch(origin+'/api/bootstrap').then(r=>r.json()),headers={Authorization:'Bearer '+boot.token,'Content-Type':'application/json'};
 assert.equal((await fetch(origin+'/api/mcp')).status,401);
 const local={name:'stdio_test',enabled:true,agents:['codex'],transport:'stdio',command:'node',args:['space path/server.mjs','& echo BAD','한글'],env:{},url:'',headers:{}};
 const remote={...local,name:'http_test',transport:'http',url:'https://example.com/mcp',headers:{Authorization:'Bearer fake-test'}};
 let response=await fetch(origin+'/api/mcp',{method:'PUT',headers,body:JSON.stringify({revision:0,servers:[local,remote]})});assert.equal(response.status,200);assert.equal((await response.json()).revision,1);
 assert.equal((await fetch(origin+'/api/mcp',{method:'PUT',headers,body:JSON.stringify({revision:0,servers:[]})})).status,400);
 const socket=new WebSocket(origin.replace('http','ws')+'/ws?token='+boot.token);t.after(()=>socket.close());const messages=[];socket.on('message',data=>messages.push(JSON.parse(data)));await once(socket,'open');
 const id=crypto.randomUUID();socket.send(JSON.stringify({type:'start',sessionId:id,agent:'codex',blockId:boot.state.blocks[0].id}));
 const until=async fn=>{for(let i=0;i<240;i++){const result=fn();if(result)return result;await new Promise(r=>setTimeout(r,25));}throw Error('MCP PTY event timeout: '+JSON.stringify(messages.filter(m=>m.type==='error')));};
 await until(()=>messages.some(m=>m.type==='started'));
 const encoded=await until(()=>messages.filter(m=>m.type==='output').map(m=>m.data).join('').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').match(/MCP_ARGV:([A-Za-z0-9+/=]+)/)?.[1]);
 const args=JSON.parse(Buffer.from(encoded,'base64').toString());assert.equal(args[0],'-c');assert.match(args[1],/mcp_servers.stdio_test=/);assert.match(args[1],/& echo BAD/);assert.equal(args[2],'-c');assert.match(args[3],/mcp_servers.http_test=/);
 assert.ok(args.some(a=>a.startsWith('mcp_servers.isp-workspace=')));
 const active=await fetch(origin+'/api/mcp',{headers}).then(r=>r.json());assert.deepEqual(active.sessions[0].names,['stdio_test','http_test','isp-workspace']);assert.equal(active.sessions[0].revision,1);
 await fetch(origin+'/api/mcp',{method:'PUT',headers,body:JSON.stringify({revision:1,servers:[]})});const stale=await fetch(origin+'/api/mcp',{headers}).then(r=>r.json());assert.equal(stale.revision,2);assert.equal(stale.sessions[0].revision,1);
 socket.send(JSON.stringify({type:'stop'}));await until(()=>messages.some(m=>m.type==='exit'));
 assert.equal((await fetch(origin+'/api/mcp',{headers}).then(r=>r.json())).sessions.length,0);
});

test('built-in MCP reaches the actual authenticated workspace API without exposing local controls publicly',async t=>{
 let client;t.after(async()=>{if(client)await client.close();});
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-builtin-mcp-'));
 const {origin}=await startServer(t,temp,'workspace');
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true,maxRetries:10}));
 const boot=await fetch(origin+'/api/bootstrap').then(r=>r.json());
 const auth={Authorization:`Bearer ${boot.token}`};
 const capabilities=await fetch(origin+'/api/mcp',{headers:auth}).then(r=>r.json());assert.equal(capabilities.builtin.name,'isp-workspace');assert.equal(capabilities.builtin.available,true);
 assert.equal((await fetch(origin+'/api/personal-agent',{headers:auth})).status,410);
 assert.equal((await fetch(origin+'/api/agent/v1/workspaces/current',{headers:auth})).status,410);
 const currentWorkspace=await fetch(origin+'/api/internal/agent/v1/workspaces/current',{headers:auth}).then(r=>r.json());assert.ok(currentWorkspace.workspace.id);
 assert.equal((await fetch(origin+'/api/internal/agent/v1/workspaces/current')).status,401);
 const personalSessions=await fetch(origin+`/api/internal/agent/v1/workspaces/${currentWorkspace.workspace.id}/sessions`,{headers:auth}).then(r=>r.json());assert.deepEqual(personalSessions.sessions,[]);
 const missing=await fetch(origin+'/api/not-a-real-endpoint',{headers:auth});assert.equal(missing.status,404);assert.match(missing.headers.get('content-type'),/json/);assert.match((await missing.json()).error,/Unknown API/);
 assert.equal((await fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 client=new Client({name:'integration-test',version:'1'});
 await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${boot.token}`}}}));
 const diagrams=await client.callTool({name:'list_diagrams',arguments:{}});assert.equal(diagrams.isError,undefined);assert.ok(diagrams.structuredContent.diagrams.length);
 const graph=await client.callTool({name:'get_diagram',arguments:{diagram_id:diagrams.structuredContent.diagrams[0].id}});assert.equal(graph.isError,undefined);
 const display=await client.callTool({name:'present_board',arguments:{block_ids:[boot.state.blocks[0].id]}});assert.equal(display.isError,undefined);assert.equal(display.structuredContent.delivered,0);
 const found=await client.callTool({name:'search_workspace',arguments:{query:boot.state.blocks[0].name}});assert.equal(found.isError,undefined);assert.ok(found.structuredContent.total>0);
 const sharing=await fetch(origin+'/api/mcp/sharing',{headers:{Authorization:`Bearer ${boot.token}`}}).then(r=>r.json());assert.equal(sharing.enabled,false);
 const request={request_id:crypto.randomUUID(),revision:boot.state.revision,diagram:{id:'mcp-created',name:'MCP created'}};
 const created=await client.callTool({name:'create_diagram',arguments:request});assert.equal(created.isError,undefined);const savedRevision=created.structuredContent.revision;
 const replay=await client.callTool({name:'create_diagram',arguments:request});assert.equal(replay.structuredContent.revision,savedRevision);
 const conflict=await client.callTool({name:'create_diagram',arguments:{...request,diagram:{...request.diagram,name:'Different'}}});assert.equal(conflict.isError,true);
 const stale=await client.callTool({name:'update_diagram',arguments:{request_id:crypto.randomUUID(),revision:boot.state.revision,diagram_id:'mcp-created',patch:{name:'Stale'}}});assert.equal(stale.isError,true);
 const renamed=await client.callTool({name:'update_diagram',arguments:{request_id:crypto.randomUUID(),revision:savedRevision,diagram_id:'mcp-created',patch:{name:'Renamed'}}});assert.equal(renamed.isError,undefined);
 const removed=await client.callTool({name:'delete_diagram',arguments:{request_id:crypto.randomUUID(),revision:renamed.structuredContent.revision,diagram_id:'mcp-created'}});assert.equal(removed.isError,undefined);
 const jobsBefore=await client.callTool({name:'list_jobs',arguments:{status:'all'}});
 const jobRequest={request_id:crypto.randomUUID(),revision:jobsBefore.structuredContent.revision,title:'MCP work item',description:'Register only'};
 const registered=await client.callTool({name:'create_job',arguments:jobRequest});assert.equal(registered.isError,undefined);
 await client.callTool({name:'create_job',arguments:jobRequest});
 const jobs=await client.callTool({name:'list_jobs',arguments:{status:'all'}});const matches=jobs.structuredContent.jobs.filter(j=>j.title==='MCP work item');assert.equal(matches.length,1);assert.equal(matches[0].status,'pending');
 const deleted=await client.callTool({name:'delete_job',arguments:{request_id:crypto.randomUUID(),revision:jobs.structuredContent.revision,job_id:matches[0].id}});assert.equal(deleted.isError,undefined);
 const recipe={version:1,id:'mcp-check',title:'MCP check',executable:process.execPath,args:['-e','require("node:fs").appendFileSync(process.argv[1], "executed\\n")','{{workspace}}/executions.txt']};
 const saved=await client.callTool({name:'save_run_recipe',arguments:{request_id:crypto.randomUUID(),expected_hash:null,recipe}});assert.equal(saved.isError,undefined);assert.match(saved.structuredContent.hash,/^[a-f0-9]{64}$/);
 const read=await client.callTool({name:'get_run_recipe',arguments:{recipe_id:recipe.id}});assert.equal(read.structuredContent.hash,saved.structuredContent.hash);
 if(process.platform==='win32'){
  const launchInput={request_id:crypto.randomUUID(),recipe_id:recipe.id,expected_hash:saved.structuredContent.hash};
  const launched=await client.callTool({name:'launch_run',arguments:launchInput});assert.equal(launched.isError,undefined);
  const sessionId=launched.structuredContent.sessionId;assert.ok(sessionId);
  try{
   const duplicate=await client.callTool({name:'launch_run',arguments:launchInput});assert.equal(duplicate.structuredContent.sessionId,sessionId);
   const runRoot=path.join(temp,'workspace','tmp','recipe-runs');let manifest;
   const deadline=Date.now()+15000;
   while(Date.now()<deadline){
    for(const dir of fs.existsSync(runRoot)?fs.readdirSync(runRoot):[]){const file=path.join(runRoot,dir,'manifest.json');if(fs.existsSync(file)){try{const value=JSON.parse(fs.readFileSync(file));if(value.endedAt)manifest=value;}catch{}}}
    if(manifest)break;await new Promise(r=>setTimeout(r,100));
   }
   assert.ok(manifest,'Recipe execution must produce a completed manifest');assert.equal(manifest.status,'succeeded');
   assert.equal(fs.readFileSync(path.join(temp,'workspace','executions.txt'),'utf8'),'executed\n');assert.equal(fs.readdirSync(runRoot).length,1);
  }finally{await fetch(`${origin}/api/terminals/${sessionId}`,{method:'DELETE',headers:{Authorization:`Bearer ${boot.token}`}});}
 }
 const outdated=await client.callTool({name:'delete_run_recipe',arguments:{request_id:crypto.randomUUID(),recipe_id:recipe.id,expected_hash:'0'.repeat(64)}});assert.equal(outdated.isError,true);
 const recipeDeleted=await client.callTool({name:'delete_run_recipe',arguments:{request_id:crypto.randomUUID(),recipe_id:recipe.id,expected_hash:saved.structuredContent.hash}});assert.equal(recipeDeleted.isError,undefined);
 const imagePath=path.join(temp,'workspace','sample.raw');fs.writeFileSync(imagePath,Buffer.alloc(8,0));
 const image=await client.callTool({name:'import_viewer_image',arguments:{path:imagePath,spec:{format:'raw',width:2,height:2,bitDepth:12,pattern:'RGGB'}}});assert.equal(image.isError,undefined);assert.ok(image.content.every(c=>c.type==='text'));
 const imageId=image.structuredContent.id;assert.ok(imageId);
 const view=await client.callTool({name:'control_viewer',arguments:{image_id:imageId,fit:true}});assert.equal(view.isError,undefined);assert.equal(view.structuredContent.status,'pending');assert.equal(view.structuredContent.delivered,0);
 const pixels=await client.callTool({name:'get_image_pixels',arguments:{image_id:imageId,x:0,y:0,width:2,height:2}});assert.equal(pixels.isError,undefined);assert.ok(pixels.content.every(c=>c.type==='text'));
 const cropInput={request_id:crypto.randomUUID(),image_id:imageId,prompt:'Select the test region'};
 const crop=await client.callTool({name:'request_viewer_crops',arguments:cropInput});assert.equal(crop.isError,undefined);assert.equal(crop.structuredContent.status,'pending');
 const cropAgain=await client.callTool({name:'request_viewer_crops',arguments:cropInput});assert.equal(cropAgain.structuredContent.id,crop.structuredContent.id);
 const cropStatus=await client.callTool({name:'get_crop_request',arguments:{crop_request_id:crop.structuredContent.id}});assert.equal(cropStatus.structuredContent.status,'pending');
 const reportPath=path.join(temp,'workspace','report.html');fs.writeFileSync(path.join(temp,'workspace','report.css'),'h1{color:blue}');fs.writeFileSync(reportPath,'<!doctype html><link rel="stylesheet" href="report.css"><h1>Evidence</h1>');
 const reportInput={request_id:crypto.randomUUID(),file:reportPath,title:'MCP report',block_id:boot.state.blocks[0].id,revision:boot.state.revision};
 const report=await client.callTool({name:'register_report',arguments:reportInput});assert.equal(report.isError,undefined);assert.equal(report.structuredContent.kind,'html');assert.equal(report.structuredContent.content,undefined);
 assert.equal(report.structuredContent.metadata.registrationSource.assets[0].path,'report.css');
 const reportBytes=fs.readFileSync(path.join(temp,'workspace','.isp/artifacts',report.structuredContent.file),'utf8');assert.match(reportBytes,/h1\{color:blue\}/);assert.ok(!reportBytes.includes('href="report.css"'));
 const cliResult=JSON.parse(execFileSync(process.execPath,['scripts/isp.mjs','artifact',reportPath,'--block',boot.state.blocks[0].id,'--revision',String(boot.state.revision)],{cwd:root,env:{...process.env,ISP_API_URL:origin,ISP_API_TOKEN:boot.token},encoding:'utf8',windowsHide:true}));assert.equal(cliResult.metadata.registrationSource.assets[0].path,'report.css');
 const repeatedReport=await client.callTool({name:'register_report',arguments:reportInput});assert.equal(repeatedReport.structuredContent.id,report.structuredContent.id);
 fs.writeFileSync(reportPath,'<!doctype html><h1>Updated evidence</h1>');
 const updatedReport=await client.callTool({name:'update_report',arguments:{request_id:crypto.randomUUID(),file:reportPath,artifact_id:report.structuredContent.id,expected_file:report.structuredContent.file}});assert.equal(updatedReport.isError,undefined);assert.notEqual(updatedReport.structuredContent.file,report.structuredContent.file);
 assert.notEqual(updatedReport.structuredContent.metadata.registrationSource.sha256,report.structuredContent.metadata.registrationSource.sha256);assert.deepEqual(updatedReport.structuredContent.metadata.registrationSource.assets,[]);
 const listedReports=await client.callTool({name:'list_reports',arguments:{}});assert.ok(listedReports.structuredContent.artifacts.some(a=>a.id===report.structuredContent.id));
 const removedReport=await client.callTool({name:'delete_reports',arguments:{request_id:crypto.randomUUID(),artifact_ids:[report.structuredContent.id]}});assert.equal(removedReport.isError,undefined);assert.ok(fs.existsSync(reportPath));
});


test('MCP packs a previewed graph-only bundle locally, rejects stale evidence and retries idempotently',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-pack-mcp-'));let client;
 t.after(async()=>{if(client)await client.close();});
 const {origin}=await startServer(t,temp,'workspace');
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true,maxRetries:10}));
 const boot=await fetch(origin+'/api/bootstrap').then(r=>r.json());
 const workspace=path.join(temp,'workspace'),source=path.join(workspace,'project/private.cpp');fs.writeFileSync(source,'PRIVATE_CODE');
 client=new Client({name:'bundle-test',version:'1'});
 await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${boot.token}`}}}));
 const tools=(await client.listTools()).tools;
 assert.equal(tools.find(t=>t.name==='pack_bundle').annotations.readOnlyHint,false);
 const options={includeSource:false,includeWorkRecords:false,includeGit:true};
 const preview=await client.callTool({name:'preview_bundle',arguments:options});assert.equal(preview.isError,undefined);
 assert.equal(preview.structuredContent.includeGit,false);assert.ok(!preview.structuredContent.files.some(f=>f.path.endsWith('private.cpp')));
 const args={request_id:crypto.randomUUID(),preview_id:preview.structuredContent.previewId};
 const result=await client.callTool({name:'pack_bundle',arguments:args});assert.equal(result.isError,undefined,JSON.stringify(result));
 assert.equal(path.dirname(result.structuredContent.path),workspace);assert.ok(fs.existsSync(result.structuredContent.path));
 const retry=await client.callTool({name:'pack_bundle',arguments:args});assert.deepEqual(retry.structuredContent,result.structuredContent);
 const {unpackBundle}=await import('../server/bundles.mjs');await unpackBundle(result.structuredContent.path,path.join(temp,'copy'));assert.ok(!fs.existsSync(path.join(temp,'copy/project/private.cpp')));
 const full=await client.callTool({name:'preview_bundle',arguments:{includeSource:true,includeWorkRecords:true}});assert.equal(full.isError,undefined);
 fs.writeFileSync(source,'CHANGED_CODE');
 const stale=await client.callTool({name:'pack_bundle',arguments:{request_id:crypto.randomUUID(),preview_id:full.structuredContent.previewId}});assert.equal(stale.isError,true);assert.match(stale.content[0].text,/stale/);
 const again=await client.callTool({name:'preview_bundle',arguments:{includeSource:true,includeWorkRecords:true}});
 const packed=await client.callTool({name:'pack_bundle',arguments:{request_id:crypto.randomUUID(),preview_id:again.structuredContent.previewId}});assert.equal(packed.isError,undefined,JSON.stringify(packed));
});


test('management MCP preserves retries, skill versions, JOB lineage and checkpoint previews', {timeout:120000}, async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-management-mcp-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const {origin}=await startServer(t,temp,'workspace');
 const boot=await fetch(origin+'/api/bootstrap').then(r=>r.json());
 const client=new Client({name:'management-test',version:'1'});t.after(()=>client.close());
 await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+boot.token}}}));
 const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;};
 const change=(name,args)=>call(name,{request_id:crypto.randomUUID(),...args});
 const skill={request_id:crypto.randomUUID(),name:'test-workflow',version:null,files:{'SKILL.md':'---\nname: test-workflow\ndescription: Use for management integration tests.\n---\nRun the fixture.\n'}};
 const saved=await call('save_project_skill',skill);
 assert.deepEqual(await call('save_project_skill',skill),saved);
 assert.equal((await client.callTool({name:'save_project_skill',arguments:{...skill,request_id:crypto.randomUUID()}})).isError,true);
 assert.equal((await call('get_project_skill',{name:skill.name})).version,saved.version);
 await change('delete_project_skill',{name:skill.name,version:saved.version});
 let project=await call('get_project');
 const userRequests=['consume-me','split-me'].map(id=>({id,text:'Test request',createdAt:new Date().toISOString()}));
 const seeded=await fetch(origin+'/api/global',{method:'PATCH',headers:{Authorization:'Bearer '+boot.token,'Content-Type':'application/json'},body:JSON.stringify({revision:project.revision,patch:{userRequests}})});assert.equal(seeded.status,200);
 let requests=await call('list_user_requests');
 await change('consume_user_request',{revision:requests.revision,user_request_id:'consume-me',resolution:'Validated fixture'});
 requests=await call('list_user_requests');assert.ok(!requests.requests.some(r=>r.id==='consume-me'));
 await change('split_user_request',{revision:requests.revision,user_request_id:'split-me',jobs:[{title:'Request child'}]});
 assert.ok((await call('list_jobs')).jobs.some(j=>j.title==='Request child'&&j.sourceRequestId==='split-me'));
 project=await call('get_project');
 await change('create_job',{revision:project.revision,title:'Original global job'});
 let jobs=await call('list_jobs');const job=jobs.jobs.find(j=>j.title==='Original global job');assert.ok(job);
 await change('restructure_jobs',{revision:jobs.revision,mode:'split',jobIds:[job.id],jobs:[{title:'Part A'},{title:'Part B'}]});
 jobs=await call('list_jobs');assert.ok(!jobs.jobs.some(j=>j.id===job.id));
 const parts=jobs.jobs.filter(j=>['Part A','Part B'].includes(j.title));assert.equal(parts.length,2);
 await change('restructure_jobs',{revision:jobs.revision,mode:'merge',jobIds:parts.map(j=>j.id),jobs:[{title:'Merged'}]});
 assert.ok((await call('list_jobs')).jobs.some(j=>j.title==='Merged'));
 const info=await call('get_workspace_info');
 const git=(...args)=>execFileSync('git',args,{cwd:info.sourceRoot,windowsHide:true,stdio:'pipe'});
 git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-m','Fixture');
 const input={request_id:crypto.randomUUID(),title:'MCP checkpoint'};
 const checkpoint=await call('create_checkpoint',input);
 assert.deepEqual(await call('create_checkpoint',input),checkpoint);
 const tracking=await call('list_work_tracking');assert.equal(tracking.checkpoints.filter(c=>c.id===checkpoint.id).length,1);
 const preview=await call('preview_checkpoint_restore',{checkpoint_id:checkpoint.id});assert.ok(preview.snapshot);
 const attempt=await change('create_work_attempt',{title:'MCP attempt',baselineCheckpointId:checkpoint.id});
 await change('update_work_attempt',{attempt_id:attempt.id,expectedUpdatedAt:attempt.updatedAt,status:'completed',summary:'Validated',validation:['MCP integration'],resultCheckpointId:checkpoint.id});
 await change('accept_work_attempt',{attempt_id:attempt.id});
 assert.equal((await call('list_work_tracking')).acceptedAttemptId,attempt.id);
 assert.ok((await call('export_graph_mermaid',{diagram_id:project.diagrams[0].id})).mermaid);
 await call('get_version_status');
 fs.writeFileSync(path.join(info.sourceRoot,'after-preview.txt'),'changed');
 const stale=await client.callTool({name:'restore_checkpoint',arguments:{request_id:crypto.randomUUID(),checkpoint_id:checkpoint.id,snapshot:preview.snapshot,stopTerminals:true}});
 assert.equal(stale.isError,true);assert.ok(fs.existsSync(path.join(info.sourceRoot,'after-preview.txt')));
 const fresh=await call('preview_checkpoint_restore',{checkpoint_id:checkpoint.id});
 await change('restore_checkpoint',{checkpoint_id:checkpoint.id,snapshot:fresh.snapshot,stopTerminals:true});
 assert.ok(!fs.existsSync(path.join(info.sourceRoot,'after-preview.txt')));
});
