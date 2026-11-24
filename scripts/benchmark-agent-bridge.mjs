import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-bridge-benchmark-'));
const workspace=path.join(temp,'workspace');fs.mkdirSync(workspace);
const reserve=net.createServer().listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const child=spawn(process.execPath,[path.join(root,'server/index.mjs')],{cwd:root,env:{...process.env,ISP_WORKSPACE:workspace,ISP_STATE_HOME:path.join(temp,'state'),ISP_NO_DISCOVERY:'1',PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
let client,transport,boot;const origin=`http://127.0.0.1:${port}`,results=[];
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Benchmark server startup timed out')),20000);child.stdout.on('data',d=>{if(String(d).includes(origin)){clearTimeout(timer);resolve();}});child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('Benchmark server exited'));});child.stderr.resume();});
 boot=await fetch(origin+'/api/bootstrap').then(r=>r.json());
 const headers={Authorization:'Bearer '+boot.token,'Content-Type':'application/json'};
 const api=async(route,body)=>{const r=await fetch(origin+'/api'+route,{method:'POST',headers,body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error);return v;};
 client=new Client({name:'bridge-benchmark',version:'1'});transport=new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers}});await client.connect(transport);
 const names=new Set((await client.listTools()).tools.map(t=>t.name));
 const mcp=async(name,args)=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content?.[0]?.text||name);return r;};
 const cli=async(args)=>promisify(execFile)(process.execPath,[path.join(root,'scripts/isp.mjs'),...args],{cwd:workspace,env:{...process.env,ISP_API_URL:origin,ISP_API_TOKEN:boot.token,ISP_TIMING:'1'},windowsHide:true,timeout:30000});
 for(const channel of ['http','mcp','cli'])for(const operation of ['present','summary','recipe-save']){
  if(channel==='mcp'&&operation==='summary'&&!names.has('record_work_summary')){results.push({channel,operation,missing:true});continue;}
  const samples=[],cliTimings=[];
  for(let i=0;i<3;i++){
   const summary={title:'Benchmark',summary:'Isolated transport timing; no user project modified.'};
   const recipe={version:1,id:`bench-${channel}-${i}`,title:'Benchmark',executable:process.execPath,args:['--version']};
   const body=operation==='present'?{view:'graph'}:operation==='summary'?summary:{recipe,expectedHash:null};
   const inputFile=path.join(temp,`${channel}-${operation}-${i}.json`);fs.writeFileSync(inputFile,JSON.stringify(body));
   const start=performance.now();
   if(channel==='http')await api(operation==='present'?'/present':operation==='summary'?'/activity/summaries':'/recipes',body);
   if(channel==='mcp')await mcp(operation==='present'?'present_board':operation==='summary'?'record_work_summary':'save_run_recipe',operation==='present'?{block_ids:[]}:operation==='summary'?{request_id:crypto.randomUUID(),...summary}:{request_id:crypto.randomUUID(),recipe,expected_hash:null});
   if(channel==='cli'){const result=await cli(operation==='present'?['present','--graph']:[operation,inputFile]);cliTimings.push(result.stderr.split(/\r?\n/).filter(line=>line.startsWith('[isp timing] ')).map(line=>JSON.parse(line.slice(13))));}
   samples.push(Math.round(performance.now()-start));
  }
  results.push({channel,operation,ms:samples,...(cliTimings.length?{cliTimings}:{})});
 }
 console.log(JSON.stringify({environment:{platform:process.platform,node:process.version,workspace:'isolated OS temp',samples:3},results},null,2));
}finally{
 await transport?.terminateSession().catch(()=>{});await client?.close().catch(()=>{});
 const exited=child.exitCode===null?once(child,'exit'):Promise.resolve();
 if(boot)await fetch(origin+'/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+boot.token,'Content-Type':'application/json'},body:JSON.stringify({instance:(await fetch(origin+'/health').then(r=>r.json())).instance})}).catch(()=>{});
 if(child.exitCode===null)child.kill();await exited;
 fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
