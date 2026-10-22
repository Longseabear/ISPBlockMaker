import {denyImageRead} from './claude-image-recovery.mjs';
import crypto from 'node:crypto';
import {sdkClaudeOptions} from './claude-options.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {readMcpSettings,agentMcpConfig,resolveAgent,effectiveMcpServers} from './mcp-settings.mjs';
const require=createRequire(import.meta.url);
function runtimeFiles(env){
 if(process.platform!=='win32')throw Error('Claude SDK 연결은 Windows 환경을 대상으로 합니다.');
 const launch=env.ISP_CLAUDE_PATH?{command:path.resolve(env.ISP_CLAUDE_PATH),args:[]}:resolveAgent('claude',env);
 // Use the company installation only. Never fall back to the SDK's bundled CLI.
 if(launch.args.length||path.extname(launch.command).toLowerCase()!=='.exe')throw Error('회사 Claude Code의 claude.exe 경로를 ISP_CLAUDE_PATH 또는 PATH에 지정하세요.');
 const file=fs.realpathSync(launch.command);
 const sdk=JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk')),'package.json'),'utf8'));
 return {file,sdkVersion:sdk.version};
}
function runtimeVersion(files,output){
 const engineVersion=output.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
 if(!engineVersion)throw Error('회사 Claude Code 버전을 확인하지 못했습니다. 실행 경로를 확인하세요.');
 return {...files,engineVersion,architecture:process.arch,validated:engineVersion==='2.1.306'};
}
export function claudeRuntime(env=process.env){
 const files=runtimeFiles(env);return runtimeVersion(files,execFileSync(files.file,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000,env}));
}
export async function claudeRuntimeAsync(env=process.env){
 const files=runtimeFiles(env);
 const {stdout}=await promisify(execFile)(files.file,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000,env});
 return runtimeVersion(files,stdout);
}
export function safeClaudeError(error,env={}){
 let text=typeof error==='string'?error:[error?.status,error?.code,error?.message,...(error?.errors||[])].filter(Boolean).join(' · ');
 for(const [key,value] of Object.entries(env))if(/token|secret|password|api.?key|authorization/i.test(key)&&typeof value==='string'&&value.length>=4)text=text.split(value).join('[redacted]');
 return text.replace(/Bearer\s+[^\s"',]+/gi,'Bearer [redacted]').replace(/sk-[a-zA-Z0-9_-]+/g,'[redacted]').slice(0,2000)||'Claude 실행 오류';
}
export function runClaude({workspace,env,chat,text,save,ask,cancelPrompts,queryImpl=query,changed=()=>{},runtime=claudeRuntime(env)}){
 const abortController=new AbortController();let stream,finished=false,resultSeen=false,resultError='',messageId='',partial='';
 const config={servers:effectiveMcpServers(workspace,env)};
 const options={...sdkClaudeOptions(chat.claudeOptions),cwd:workspace,env:{...env},pathToClaudeCodeExecutable:runtime.file,settingSources:['user','project','local'],includePartialMessages:true,abortController,
  ...(chat.threadId?{resume:chat.threadId}:{}),
  ...(config.servers.some(s=>s.enabled&&s.agents.includes('claude'))?{mcpServers:agentMcpConfig(config.servers,'claude')}:{}),
  canUseTool:(tool,input,context)=>chat.inputMode==='text'&&denyImageRead(tool,input)?Promise.resolve({behavior:'deny',message:'This session uses a text-only model. Do not read image bytes into model context. To display an image use node .isp/tools/isp.mjs viewer-open FILE. Generate plots with Python and register/present them using the visualization skill.'}):ask({...chat,workspace},tool,input,context),
  systemPrompt:{type:'preset',preset:'claude_code',append:`You are working in ISP Block Maker at ${workspace}. Read AGENTS.md and project skills. Use node .isp/tools/isp.mjs for graph/context/artifacts. Pinned diagram: ${chat.diagramId||'none'}. When a diagram is pinned, always use isp project --diagram ID and explicit --diagram ID for that diagram, regardless of UI selection. Otherwise run isp project or graph-info to discover the current diagram. Capture its diagramId and use --diagram ID for subsequent graph edits in that task. JOBs are project-global. Pinned block: ${chat.blockId||'whole project'}. Do not change targets based on UI selection. Respond in the user's language. Never print credentials. Display-only image requests do not require vision: use node .isp/tools/isp.mjs viewer-open FILE instead of Read on image files. For plots use Python to generate the file and the visualization skill to register/present it. Only read image pixels into model context when the user requests visual analysis and the model supports image input.${chat.inputMode==='text'?' This session is text-only: do not return image attachments to the model; use file paths, metadata and Python numeric results.':''}`}
 };
 const toolResult=content=>{
  const text=typeof content==='string'?content:JSON.stringify(content);
  if(!text||text.length<=24000)return content;
  const dir=path.join(workspace,'.isp','interaction-output');fs.mkdirSync(dir,{recursive:true});
  if(fs.lstatSync(dir).isSymbolicLink())throw Error('Linked interaction output directory is not supported');
  const name=crypto.randomUUID()+'.txt';fs.writeFileSync(path.join(dir,name),text,{flag:'wx',mode:0o600});
  return {preview:text.slice(0,24000),truncated:true,outputFile:'.isp/interaction-output/'+name,characters:text.length};
 };
 const upsert=item=>{const old=chat.items.find(i=>i.id===item.id);if(old)chat.items[chat.items.indexOf(old)]={...old,...item};else chat.items.push(item);changed();};
 const done=(async()=>{
  await Promise.resolve();
  try{
   if(abortController.signal.aborted)return;
   const prompt=!chat.threadId&&chat.recoveryContext?'Prior user requests (text-only reference, not proof of completed work):\n'+chat.recoveryContext+'\n\nCurrent request:\n'+text:text;
   stream=queryImpl({prompt,options});
   for await(const m of stream){
    if(m.session_id){chat.threadId=m.session_id;changed();}
    if(m.type==='system'&&m.subtype==='init'){chat.runtimeOptions={model:m.model,permissionMode:m.permissionMode};chat.commands=(m.slash_commands||[]).filter(name=>!(m.terminal_slash_commands||[]).includes(name));chat.phase='working';changed();}
    if(m.type==='system'&&m.subtype==='commands_changed'){chat.commands=(m.commands||[]).filter(c=>!c.isTerminalOnly).map(c=>c.name);changed();}
    if(m.type==='system'&&m.subtype==='local_command_output'){upsert({id:m.uuid||crypto.randomUUID(),type:'agentMessage',text:safeClaudeError(m.content,env),status:'completed'});resultSeen=true;}
    if(m.type==='stream_event'){
     const e=m.event;
     if(e.type==='content_block_start'&&e.content_block?.type==='tool_use'){chat.phase='tool';upsert({id:e.content_block.id,type:'claudeToolCall',tool:e.content_block.name,status:'inProgress'});}
     if(e.type==='content_block_delta'&&e.delta.type==='thinking_delta'&&chat.phase!=='thinking'){chat.phase='thinking';changed();}
     if(e.type==='message_start'){messageId=e.message.id;partial='';}
     if(e.type==='content_block_delta'&&e.delta.type==='text_delta'){chat.phase='responding';partial+=e.delta.text;upsert({id:messageId,type:'agentMessage',text:partial,status:'inProgress'});}
    }
    if(m.type==='assistant'){
     const blocks=m.message.content||[],body=blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');
     if(body)upsert({id:m.message.id,type:'agentMessage',text:body,status:'completed'});
     for(const b of blocks.filter(b=>b.type==='tool_use'))upsert({id:b.id,type:'claudeToolCall',tool:b.name,input:b.input,status:'inProgress'});
    }
    if(m.type==='user'&&Array.isArray(m.message.content))for(const b of m.message.content)if(b.type==='tool_result')upsert({id:b.tool_use_id,type:'claudeToolCall',status:b.is_error?'failed':'completed',result:toolResult(b.content)});
    if(m.type==='result'){resultSeen=true;if(m.is_error)resultError=safeClaudeError({code:m.subtype,errors:m.errors,message:m.result},env);
     if(m.permission_denials?.length)resultError='Claude 설정 또는 회사 정책으로 거절된 작업이 있습니다. 허용되지 않은 작업은 실행하지 않았습니다.';
    }
   }
   if(!resultSeen&&!abortController.signal.aborted)resultError='Claude가 결과 없이 종료되었습니다.';
  }catch(error){if(!abortController.signal.aborted)resultError=safeClaudeError(error,env);}
  finally{
   finished=true;cancelPrompts(chat.id);stream?.close?.();chat.busy=false;
   if(chat.status!=='interrupted'){chat.status=resultError?'failed':'completed';chat.error=resultError;}
   await save();
  }
 })();
 return {done,async stop(){if(finished)return;chat.status='interrupted';cancelPrompts(chat.id);abortController.abort();stream?.close?.();await done;}};
}
