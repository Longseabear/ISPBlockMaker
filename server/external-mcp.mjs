import crypto from 'node:crypto';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {createWorkspaceMcp,workspaceMcpHandler} from './workspace-mcp.mjs';

// Authentication happens before this handler. A root credential authorizes a new
// connection, but is never used as that connection's terminal identity.
export function externalMcpHandler(context,{agents,hasTerminals=()=>false,idleMs=3600000,now=Date.now}){
 const connections=new Map(),stateless=workspaceMcpHandler(context);
 const fail=(res,status,message)=>res.status(status).json({jsonrpc:'2.0',id:null,error:{code:-32000,message}});
 async function dispose(record){
  if(record.closed)return;record.closed=true;connections.delete(record.id);
  if(hasTerminals(record.agent.id))agents.revoke(record.agent.id);else agents.forget(record.agent.id);
  await record.server.close().catch(()=>{});
 }
 const sweep=()=>Promise.all([...connections.values()].filter(r=>!r.active&&!hasTerminals(r.agent.id)&&now()-r.used>idleMs).map(dispose));
 const timer=setInterval(()=>void sweep(),Math.min(idleMs,60000));timer.unref();
 const handler=async(req,res)=>{
  const sessionId=req.headers['mcp-session-id'];
  if(!sessionId&&req.mcpActor){
   if(req.method!=='POST')return res.status(405).end();
   return stateless(req,res); // App-managed agents already have their own identity.
  }
  let record;
  try{
   await sweep();
   if(sessionId){
    record=connections.get(sessionId);
    if(!record)return fail(res,404,'MCP session expired. Reconnect isp-workspace; do not manually register tokens.');
    if(record.authorization!==req.headers.authorization)return fail(res,403,'MCP session belongs to another connection credential.');
    if(!agents.authenticate(record.agent.token)){await dispose(record);return fail(res,404,'MCP agent disconnected. Reconnect isp-workspace.');}
   }else{
    if(req.method!=='POST'||req.body?.method!=='initialize')return fail(res,400,'Initialize or reconnect isp-workspace MCP first. Terminal Hub identity is assigned automatically.');
    if(connections.size>=128)return fail(res,429,'Too many MCP connections. Close unused MCP clients.');
    const name=req.body?.params?.clientInfo?.name;
    const label=`External · ${typeof name==='string'?name.replace(/[\x00-\x1f\x7f]/g,'').slice(0,80):'MCP'}`;
    const agent=agents.issue(label),id=crypto.randomUUID();
    req.mcpActor=agents.authenticate(agent.token);req.mcpTerminalToken=agent.token;
    try{
     const server=createWorkspaceMcp(context(req));
     const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>id,enableJsonResponse:true,onsessionclosed:()=>dispose(record)});
     record={id,agent,server,transport,authorization:req.headers.authorization,used:now(),active:0,closed:false};
     connections.set(id,record);await server.connect(transport);
    }catch(error){agents.forget(agent.id);if(record)await dispose(record);throw error;}
   }
   record.used=now();record.active++;
   try{await record.transport.handleRequest(req,res,req.body);}
   finally{record.active--;record.used=now();if(!record.transport.sessionId||(!record.active&&record.retiring))await dispose(record);}
  }catch(error){if(!res.headersSent)fail(res,500,'MCP connection failed: '+String(error.message).slice(0,200));}
 };
 // A restore/switch can invalidate sessions from inside its own tool call.
 // Let that response finish before closing its transport, otherwise the caller
 // waits for a timeout even though the source mutation succeeded.
 handler.clear=()=>Promise.all([...connections.values()].map(record=>{
  record.retiring=true;
  return record.active?undefined:dispose(record);
 }));
 handler.close=async()=>{clearInterval(timer);await handler.clear();};
 return handler;
}
