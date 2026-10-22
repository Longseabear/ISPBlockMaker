import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';

const text=z.string().max(8000).refine(s=>!s.includes('\0'),'NUL is not allowed');
const mapping=z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),text).refine(v=>Object.keys(v).length<=100);
const headers=z.record(z.string().regex(/^[A-Za-z0-9_-]+$/),text.refine(s=>!/[\r\n]/.test(s))).refine(v=>Object.keys(v).length<=50);
export const mcpServerSchema=z.object({
 name:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),enabled:z.boolean(),
 agents:z.array(z.enum(['codex','claude'])).min(1).max(2),transport:z.enum(['stdio','http']),
 command:text.default(''),args:z.array(text).max(100).default([]),env:mapping.default({}),
 url:text.default(''),headers:headers.default({}),
}).strict().superRefine((s,ctx)=>{
 if(s.transport==='stdio'&&!s.command.trim())ctx.addIssue({code:'custom',message:'실행 명령을 입력하세요.',path:['command']});
 if(s.transport==='http'){try{const url=new URL(s.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();}catch{ctx.addIssue({code:'custom',message:'HTTP(S) URL을 입력하세요. 인증 값은 헤더에 넣으세요.',path:['url']});}}
});
const serversSchema=z.array(mcpServerSchema).max(50).refine(list=>new Set(list.map(s=>s.name.toLowerCase())).size===list.length,'MCP 이름은 중복될 수 없습니다.');
const stateSchema=z.object({revision:z.number().int().nonnegative(),servers:serversSchema});
function safe(workspace,...parts){
 let target=fs.realpathSync(workspace);
 for(const part of ['.isp',...parts]){target=path.join(target,part);try{if(fs.lstatSync(target).isSymbolicLink())throw Error('Linked MCP settings paths are not allowed');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return target;
}
export function readMcpSettings(workspace){const file=safe(workspace,'mcp-settings.json');if(!fs.existsSync(file))return {revision:0,servers:[]};return stateSchema.parse(JSON.parse(fs.readFileSync(file,'utf8')));}
export function saveMcpSettings(workspace,input){
 const next=stateSchema.parse(input),old=readMcpSettings(workspace);
 if(next.revision!==old.revision)throw Error('MCP 설정이 다른 화면에서 변경되었습니다. 새로고침 후 다시 저장하세요.');
 const value={revision:old.revision+1,servers:next.servers},file=safe(workspace,'mcp-settings.json'),temp=safe(workspace,'mcp-'+crypto.randomUUID()+'.tmp');
 fs.mkdirSync(path.dirname(file),{recursive:true});
 try{fs.writeFileSync(temp,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 return value;
}
export function tomlValue(value){
 if(Array.isArray(value))return '['+value.map(tomlValue).join(', ')+']';
 if(value&&typeof value==='object')return '{ '+Object.entries(value).map(([key,v])=>JSON.stringify(key)+' = '+tomlValue(v)).join(', ')+' }';
 return JSON.stringify(value);
}
export function agentMcpConfig(servers,agent){
 return Object.fromEntries(servers.filter(s=>s.enabled&&s.agents.includes(agent)).map(s=>[s.name,
  s.transport==='stdio'?{...(agent==='claude'?{type:'stdio'}:{}),command:s.command,args:s.args,env:s.env}:
  agent==='codex'?{url:s.url,http_headers:s.headers}:{type:'http',url:s.url,headers:s.headers}
 ]));
}
// Runtime-only: never write the built-in credential into workspace settings.
export function effectiveMcpServers(workspace,env=process.env){
 const {servers}=readMcpSettings(workspace);
 if(!env.ISP_API_URL||!env.ISP_API_TOKEN||!env.ISP_WORKSPACE)return servers;
 if(path.resolve(env.ISP_WORKSPACE).toLowerCase()!==path.resolve(workspace).toLowerCase())throw Error('Built-in MCP workspace mismatch');
 const url=new URL(env.ISP_API_URL);if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password)throw Error('Built-in MCP requires a local server');
 if(servers.some(s=>s.name.toLowerCase()==='isp-workspace'))throw Error('MCP 이름 isp-workspace는 기본 제공 서버와 충돌합니다. 사용자 서버 이름을 변경하세요.');
 return [...servers,{name:'isp-workspace',enabled:true,agents:['claude','codex'],transport:'http',url:new URL('/mcp',url).href,headers:{Authorization:'Bearer '+env.ISP_API_TOKEN}}];
}
// Launch executables directly: MCP args never become cmd/PowerShell source code.
export function resolveAgent(agent,env=process.env,platform=process.platform){
 if(!['codex','claude'].includes(agent))throw Error('Unknown agent');
 const dirs=(env.PATH||env.Path||'').split(path.delimiter).filter(Boolean).map(p=>p.replace(/^"|"$/g,''));
 for(const dir of dirs){
  const native=path.join(dir,agent+(platform==='win32'?'.exe':''));
  if(fs.existsSync(native)&&fs.statSync(native).isFile())return {command:native,args:[]};
  if(platform==='win32'){
   const entry=path.join(dir,'node_modules',agent==='codex'?'@openai/codex/bin/codex.js':'@anthropic-ai/claude-code/cli.js');
   if(fs.existsSync(entry))return {command:process.execPath,args:[entry]};
  }
 }
 throw Error(`${agent} 실행 파일을 찾을 수 없습니다. CLI를 설치하고 서버를 다시 시작하세요. 사용자 정의 .cmd 래퍼 대신 공식 CLI 설치를 사용하세요.`);
}
export function prepareMcpLaunch(workspace,agent,sessionId,env=process.env){
 const state=readMcpSettings(workspace),config=agentMcpConfig(effectiveMcpServers(workspace,env),agent),names=Object.keys(config);
 if(!names.length)return {revision:state.revision,names,launch:null,cleanup:()=>{}};
 const launch=resolveAgent(agent,env);let file;
 if(agent==='codex')for(const [name,value] of Object.entries(config))launch.args.push('-c',`mcp_servers.${name}=${tomlValue(value)}`);
 else{
  if(!/^[a-f0-9-]{36}$/.test(sessionId))throw Error('Invalid terminal session');
  file=safe(workspace,'mcp-runtime',sessionId+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({mcpServers:config}),{flag:'wx',mode:0o600});
  launch.args.push('--mcp-config',file);
 }
 return {revision:state.revision,names,launch,cleanup:()=>{if(file&&fs.existsSync(file))fs.unlinkSync(file);}};
}
export function installMcpSettings(app,current,sessions){
 const state=()=>({...readMcpSettings(current()),builtin:{name:'isp-workspace',available:true,endpoint:'/mcp'},sessions:[...sessions.entries()].filter(([,s])=>s.agent!=='shell').map(([id,s])=>({id,agent:s.agent,revision:s.mcpRevision??0,names:s.mcpNames||[]}))});
 app.get('/api/mcp',(_req,res)=>res.json(state()));
 app.put('/api/mcp',(req,res)=>{saveMcpSettings(current(),req.body);res.json(state());});
}
