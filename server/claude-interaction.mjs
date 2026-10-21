import {sdkClaudeOptions} from './claude-options.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {readMcpSettings,agentMcpConfig,resolveAgent} from './mcp-settings.mjs';
const require=createRequire(import.meta.url);
export function claudeRuntime(env=process.env){
 if(process.platform!=='win32')throw Error('Claude SDK 연결은 Windows 환경을 대상으로 합니다.');
 const launch=env.ISP_CLAUDE_PATH?{command:path.resolve(env.ISP_CLAUDE_PATH),args:[]}:resolveAgent('claude',env);
 // Use the company installation only. Never fall back to the SDK's bundled CLI.
 if(launch.args.length||path.extname(launch.command).toLowerCase()!=='.exe')throw Error('회사 Claude Code의 claude.exe 경로를 ISP_CLAUDE_PATH 또는 PATH에 지정하세요.');
 const file=fs.realpathSync(launch.command);
 const sdk=JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk')),'package.json'),'utf8'));
 const output=execFileSync(file,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000,env});
 const engineVersion=output.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
 if(!engineVersion)throw Error('회사 Claude Code 버전을 확인하지 못했습니다. 실행 경로를 확인하세요.');
 return {file,sdkVersion:sdk.version,engineVersion,architecture:process.arch,validated:engineVersion==='2.1.306'};
}
export function runClaude({workspace,env,chat,text,save,ask,cancelPrompts,queryImpl=query,runtime=claudeRuntime(env)}){
 const abortController=new AbortController();let stream,finished=false,resultSeen=false,resultError='',messageId='',partial='';
 const config=readMcpSettings(workspace);
 const options={...sdkClaudeOptions(chat.claudeOptions),cwd:workspace,env:{...env},pathToClaudeCodeExecutable:runtime.file,settingSources:['user','project','local'],includePartialMessages:true,abortController,
  ...(chat.threadId?{resume:chat.threadId}:{}),
  ...(config.servers.some(s=>s.enabled&&s.agents.includes('claude'))?{mcpServers:agentMcpConfig(config.servers,'claude')}:{}),
  canUseTool:(tool,input,context)=>ask({...chat,workspace},tool,input,context),
  systemPrompt:{type:'preset',preset:'claude_code',append:`You are working in ISP Block Maker at ${workspace}. Read AGENTS.md and project skills. Use node .isp/tools/isp.mjs for graph/context/artifacts. For a new request to read/explain the block diagram, run isp project or graph-info to read the currently selected diagram, independently of the pinned block. Capture its diagramId and use --diagram ID for subsequent graph edits in that task. JOBs are project-global. Pinned block: ${chat.blockId||'whole project'}. Do not change targets based on UI selection. Respond in the user's language. Never print credentials.`}
 };
 const upsert=item=>{const old=chat.items.find(i=>i.id===item.id);if(old)Object.assign(old,item);else chat.items.push(item);};
 const done=(async()=>{
  await Promise.resolve();
  try{
   if(abortController.signal.aborted)return;
   stream=queryImpl({prompt:text,options});
   for await(const m of stream){
    if(m.session_id)chat.threadId=m.session_id;
    if(m.type==='stream_event'){
     const e=m.event;if(e.type==='message_start'){messageId=e.message.id;partial='';}
     if(e.type==='content_block_delta'&&e.delta.type==='text_delta'){partial+=e.delta.text;upsert({id:messageId,type:'agentMessage',text:partial,status:'inProgress'});}
    }
    if(m.type==='assistant'){
     const blocks=m.message.content||[],body=blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');
     if(body)upsert({id:m.message.id,type:'agentMessage',text:body,status:'completed'});
     for(const b of blocks.filter(b=>b.type==='tool_use'))upsert({id:b.id,type:'claudeToolCall',tool:b.name,status:'inProgress'});
    }
    if(m.type==='user'&&Array.isArray(m.message.content))for(const b of m.message.content)if(b.type==='tool_result')upsert({id:b.tool_use_id,type:'claudeToolCall',status:b.is_error?'failed':'completed',result:b.content});
    if(m.type==='result'){resultSeen=true;if(m.is_error)resultError='Claude 실행이 실패했습니다. 워크스페이스의 인증·모델·회사 게이트웨이 설정을 확인하세요.';
     if(m.permission_denials?.length)resultError='Claude 설정 또는 회사 정책으로 거절된 작업이 있습니다. 허용되지 않은 작업은 실행하지 않았습니다.';
    }
   }
   if(!resultSeen&&!abortController.signal.aborted)resultError='Claude가 결과 없이 종료되었습니다.';
  }catch{if(!abortController.signal.aborted)resultError='회사 Claude Code와 SDK 연결에 실패했습니다. 실행 파일 버전, 워크스페이스 인증 설정, Windows 실행 환경을 확인하세요.';}
  finally{
   finished=true;cancelPrompts(chat.id);stream?.close?.();chat.busy=false;
   if(chat.status!=='interrupted'){chat.status=resultError?'failed':'completed';chat.error=resultError;}
   save();
  }
 })();
 return {done,async stop(){if(finished)return;chat.status='interrupted';cancelPrompts(chat.id);abortController.abort();stream?.close?.();await done;}};
}
