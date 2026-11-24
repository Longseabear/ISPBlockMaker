import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {externalMcpHandler} from '../server/external-mcp.mjs';
import {McpAgents} from '../server/mcp-agents.mjs';
import {SharedTerminals} from '../server/shared-terminals.mjs';

async function fixture(t){
 let time=0;
 const agents=new McpAgents(),inputs=[];
 const manager=new SharedTerminals({agents,context:()=>({workspace:process.cwd(),env:{}}),freeMemory:()=>1024**3,spawn:()=>({pid:123,onData(){},onExit(){},write:data=>inputs.push(data),resize(){},kill(){}})});
 const context=req=>({store:{get:()=>({revision:0,diagrams:[]})},search:{},localApi:async()=>({}),terminalApi:async(method,route,body)=>{
  const actor=agents.authenticate(req.mcpTerminalToken||req.headers.authorization.slice(7));assert.ok(actor);
  if(route==='/api/shared-terminals')return method==='GET'?manager.list():manager.create(body,actor);
  const id=route.split('/')[3];
  if(route.endsWith('/input'))return manager.write(id,body,actor);
  if(route.includes('/output'))return manager.read(id);
  throw Error('Unexpected test route '+route);
 }});
 const handler=externalMcpHandler(context,{agents,hasTerminals:id=>manager.list().some(s=>s.agentId===id),idleMs:60000,now:()=>time});
 const app=express();app.use(express.json());app.all('/mcp',(req,res,next)=>{
  req.mcpActor=agents.authenticate(req.headers.authorization?.slice(7));
  if(req.headers.authorization!=='Bearer root'&&!req.mcpActor)return res.sendStatus(401);
  next();
 },handler);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url=new URL(`http://127.0.0.1:${server.address().port}/mcp`),clients=[];
 t.after(async()=>{await Promise.all(clients.map(c=>c.close()));await handler.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 async function connect(token='root'){
  const client=new Client({name:'same-external-client',version:'1'}),transport=new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+token}}});
  clients.push(client);await client.connect(transport);return {client,transport};
 }
 return {agents,manager,inputs,connect,url,setTime:value=>time=value,handler};
}
test('external clients auto-register distinct identities and keep ownership across tool requests',async t=>{
 const f=await fixture(t),a=await f.connect(),b=await f.connect();
 assert.notEqual(a.transport.sessionId,b.transport.sessionId);assert.equal(f.agents.list().length,2);
 assert.ok((await a.client.listTools()).tools.some(t=>t.name==='create_shared_terminal'));
 const create=await a.client.callTool({name:'create_shared_terminal',arguments:{session_id:crypto.randomUUID(),title:'SSH'}});
 assert.ok(!create.isError);const session=create.structuredContent;
 await b.transport.terminateSession();await b.client.close();
 f.setTime(3600001); // A quiet SSH owner must not lose its identity.
 const input={session_id:session.id,control_version:session.controlVersion,request_id:crypto.randomUUID(),data:'ssh build-host\r'};
 assert.ok(!(await a.client.callTool({name:'write_shared_terminal',arguments:input})).isError);
 const other=await f.connect();
 assert.equal((await other.client.callTool({name:'write_shared_terminal',arguments:{...input,request_id:crypto.randomUUID()}})).isError,true);
 assert.deepEqual(f.inputs,['ssh build-host\r']);
 await a.transport.terminateSession();assert.equal(f.agents.get(session.agentId).status,'disconnected');
 assert.equal(f.manager.list()[0].status,'running');
 const c=await f.connect();assert.equal((await c.client.callTool({name:'write_shared_terminal',arguments:{...input,request_id:crypto.randomUUID()}})).isError,true);
 await other.transport.terminateSession();await c.transport.terminateSession();
 assert.equal(f.agents.list().length,1); // Retain only the disconnected terminal owner.
});
test('missing, unknown, revoked and mismatched session credentials fail without assigning a shared identity',async t=>{
 const f=await fixture(t),a=await f.connect(),other=f.agents.issue('scoped');
 const request=(headers,body={jsonrpc:'2.0',id:7,method:'tools/list'})=>fetch(f.url,{method:'POST',headers:{Authorization:'Bearer root','Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers},body:JSON.stringify(body)});
 assert.equal((await request({})).status,400);
 assert.equal((await request({'mcp-session-id':crypto.randomUUID()})).status,404);
 assert.equal((await request({'mcp-session-id':a.transport.sessionId,Authorization:'Bearer '+other.token})).status,403);
 f.agents.revoke(f.agents.list().find(x=>x.label.startsWith('External')).id);
 assert.equal((await request({'mcp-session-id':a.transport.sessionId})).status,404);
 assert.equal((await request({Authorization:'Bearer invalid'})).status,401);
 const count=f.agents.list().length;
 assert.equal((await request({},{jsonrpc:'2.0',id:8,method:'initialize',params:{}})).status,400);
 assert.equal(f.agents.list().length,count);
});
test('scoped app clients stay stateless; idle external sessions release unused identities',async t=>{
 const f=await fixture(t),identity=f.agents.issue('App'),app=await f.connect(identity.token);
 assert.equal(app.transport.sessionId,undefined);assert.ok(!(await app.client.callTool({name:'list_shared_terminals',arguments:{}})).isError);
 const external=await f.connect();f.setTime(60001);
 const response=await fetch(f.url,{method:'GET',headers:{Authorization:'Bearer root','mcp-session-id':external.transport.sessionId,Accept:'text/event-stream'}});
 assert.equal(response.status,404);assert.equal(f.agents.list().length,1);
});
