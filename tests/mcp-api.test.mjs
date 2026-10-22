import {WebSocket} from "ws";
import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
 const reportPath=path.join(temp,'workspace','report.html');fs.writeFileSync(reportPath,'<!doctype html><h1>Evidence</h1>');
 const reportInput={request_id:crypto.randomUUID(),file:reportPath,title:'MCP report',block_id:boot.state.blocks[0].id,revision:boot.state.revision};
 const report=await client.callTool({name:'register_report',arguments:reportInput});assert.equal(report.isError,undefined);assert.equal(report.structuredContent.kind,'html');assert.equal(report.structuredContent.content,undefined);
 const repeatedReport=await client.callTool({name:'register_report',arguments:reportInput});assert.equal(repeatedReport.structuredContent.id,report.structuredContent.id);
 fs.writeFileSync(reportPath,'<!doctype html><h1>Updated evidence</h1>');
 const updatedReport=await client.callTool({name:'update_report',arguments:{request_id:crypto.randomUUID(),file:reportPath,artifact_id:report.structuredContent.id,expected_file:report.structuredContent.file}});assert.equal(updatedReport.isError,undefined);assert.notEqual(updatedReport.structuredContent.file,report.structuredContent.file);
 const listedReports=await client.callTool({name:'list_reports',arguments:{}});assert.ok(listedReports.structuredContent.artifacts.some(a=>a.id===report.structuredContent.id));
 const removedReport=await client.callTool({name:'delete_reports',arguments:{request_id:crypto.randomUUID(),artifact_ids:[report.structuredContent.id]}});assert.equal(removedReport.isError,undefined);assert.ok(fs.existsSync(reportPath));
});
