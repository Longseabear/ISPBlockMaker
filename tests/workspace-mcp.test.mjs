import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {workspaceMcpHandler} from '../server/workspace-mcp.mjs';
import {localApiAdapter} from '../server/mcp-local-tools.mjs';

test('real MCP HTTP client negotiates, discovers read tools and rejects arbitrary operations',async t=>{
 const app=express();app.use(express.json());const calls=[];
 app.post('/mcp',workspaceMcpHandler(()=>({store:{get:()=>({revision:3,diagrams:[{id:'main',name:'Main',kind:'pipeline',overview:{description:'Example'}}]})},search:{search:async input=>{calls.push(input);return {generation:1,revision:3,total:0,results:[]};}}})));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const client=new Client({name:'test',version:'1.0.0'});t.after(async()=>{await client.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));
 const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='retrieve_context'));assert.ok(tools.tools.every(t=>t.annotations.readOnlyHint));
 const diagrams=await client.callTool({name:'list_diagrams',arguments:{}});assert.equal(diagrams.structuredContent.diagrams[0].id,'main');
 await client.callTool({name:'search_workspace',arguments:{query:'noise'}});assert.equal(calls[0].query,'noise');
 const invalid=await client.callTool({name:'execute_shell',arguments:{command:'anything'}});assert.equal(invalid.isError,true);
});

test('local display tools return metadata and are absent from the public catalogue',async t=>{
 const app=express();app.use(express.json());const calls=[];
 const context={store:{get:()=>({revision:1,diagrams:[]})},search:{},mutate:async(name,input,fn)=>fn(),localApi:async(...args)=>{calls.push(args);return {id:'command',status:'pending',delivered:1};}};
 for(const route of ['local','public'])app.post(`/${route}`,workspaceMcpHandler(()=>({...context,scope:{public:route==='public'}})));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const clients=[];t.after(async()=>{await Promise.all(clients.map(c=>c.close()));server.closeAllConnections();await new Promise(r=>server.close(r));});
 for(const route of ['local','public']){
  const client=new Client({name:'test',version:'1'});clients.push(client);await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/${route}`)));
  const {tools}=await client.listTools();const display=tools.find(t=>t.name==='control_viewer');
  if(route==='public'){assert.equal(display,undefined);assert.ok(tools.every(t=>t.annotations.readOnlyHint));assert.ok(!tools.some(t=>['launch_run','create_job','start_harness','edit_graph'].includes(t.name)));const denied=await client.callTool({name:'control_viewer',arguments:{image_id:'d89074cd-2e06-4302-bba6-b7c29cf8838a'}});assert.equal(denied.isError,true);continue;}
  assert.equal(display.annotations.readOnlyHint,false);
  const result=await client.callTool({name:'control_viewer',arguments:{image_id:'d89074cd-2e06-4302-bba6-b7c29cf8838a',fit:true}});
  assert.equal(result.structuredContent.status,'pending');assert.ok(result.content.every(c=>c.type==='text'));
  assert.equal(calls[0][1],'/api/viewer/commands');assert.equal(calls[0][2].show,true);
  const before=calls.length;
  const oversized=await client.callTool({name:'get_image_pixels',arguments:{image_id:'d89074cd-2e06-4302-bba6-b7c29cf8838a',x:0,y:0,width:100,height:100}});
  assert.equal(oversized.isError,true);assert.equal(calls.length,before);
 }
 assert.equal(calls.length,1);
});

test('local adapter enforces origin, rotated credentials and bounded responses',async()=>{
 assert.throws(()=>localApiAdapter({origin:'https://example.com',token:()=>''}),/loopback/);
 let secret='first';const requests=[];
 const api=localApiAdapter({origin:'http://127.0.0.1:4310',token:()=>secret,fetchImpl:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({ok:true}));}});
 await api('GET','/api/viewer');secret='second';await api('GET','/api/viewer');
 assert.equal(requests[0].options.headers.Authorization,'Bearer first');assert.equal(requests[1].options.headers.Authorization,'Bearer second');assert.equal(requests[0].options.redirect,'error');
 await assert.rejects(api('GET','//evil.example/api'),/route/);
 const large=localApiAdapter({origin:'http://localhost:4310',token:()=>'',fetchImpl:async()=>new Response('x'.repeat(512*1024+1))});
 await assert.rejects(large('GET','/api/viewer'),/limit/);
});
