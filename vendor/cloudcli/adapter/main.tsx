import React,{useCallback,memo,useEffect,useMemo,useRef,useState,startTransition} from 'react';
import {createRoot} from 'react-dom/client';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import chatEnglish from '@/modules/i18n/locales/en/chat.json';
import commonEnglish from '@/modules/i18n/locales/en/common.json';
import ChatComposer from '@/modules/chat/composer/ChatComposer';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import {PaletteOpsProvider,usePaletteOpsRegister} from '@/modules/command-palette/context/PaletteOpsContext';
import {request} from './bridge';
import {Approval} from './Approval';
import 'katex/dist/katex.min.css';
import './adapter.css';

void i18n.use(initReactI18next).init({lng:'en',fallbackLng:'en',resources:{en:{chat:chatEnglish,common:commonEnglish}},interpolation:{escapeValue:false}});
type Options={model?:string;effort?:string;permissionMode?:string};
type View={selected:string;workspace:string;provider:string;chat:any;requests:any[];models:any[];settings:any[];engine:any;error:string;total:number};
const noop=()=>{};
const paneKey=':pane:'+(new URLSearchParams(location.search).get('pane')||'0');
const empty:View={selected:'',workspace:'',provider:'claude',chat:null,requests:[],models:[],settings:[],engine:null,error:'',total:0};
const diff=(oldText:string,newText:string)=>[...oldText.split('\n').map(content=>({type:'removed',content})),...newText.split('\n').map(content=>({type:'added',content}))];
const cache=new Map<string,{signature:string;message:any}>();
function convert(item:any){
 const signature=JSON.stringify(item),old=cache.get(item.id);if(old?.signature===signature)return old.message;
 const base={id:item.id,timestamp:item.timestamp||'',isStreaming:item.status==='inProgress'};
 const message=item.type==='userMessage'?{...base,type:'user',content:item.text||''}:item.type==='agentMessage'?{...base,type:'assistant',content:item.text||''}:item.type==='reasoning'?{...base,type:'assistant',content:item.text||'',isThinking:true}:{...base,type:'assistant',isToolUse:true,content:'',toolId:item.id,toolName:item.tool||(item.type==='commandExecution'?'Bash':item.type==='fileChange'?'ApplyPatch':item.type),toolInput:item.input||(item.command?{command:item.command}:item.changes?{changes:item.changes}:{}),toolStatus:item.status==='inProgress'?'in_progress':item.status==='failed'?'failed':'completed',toolResult:item.result!=null||item.aggregatedOutput||item.error?{content:typeof item.result==='string'?item.result:JSON.stringify(item.result??item.aggregatedOutput??item.error),isError:!!item.error}:undefined};
 cache.set(item.id,{signature,message});return message;
}
const Rows=memo(function Rows({items,provider,onFile}:{items:any[];provider:string;onFile:(path:string)=>void}){
 const messages=useMemo(()=>items.map(convert),[items]);
 return <>{messages.map((message,index)=><div className="isp-row" key={message.id}><MessageComponent message={message} prevMessage={messages[index-1]||null} provider={provider} createDiff={diff as any} showThinking showRawParameters onFileOpen={onFile}/></div>)}</>;
});
function App(){
 useEffect(()=>{const activate=()=>parent.postMessage({channel:'isp-cloudcli',action:'focus'},location.origin);document.addEventListener('pointerdown',activate);document.addEventListener('focusin',activate);return()=>{document.removeEventListener('pointerdown',activate);document.removeEventListener('focusin',activate);};},[]);
 const [file,setFile]=useState<{path:string;content:string}|null>(null);
 const [view,setView]=useState<View>(empty),[input,setInput]=useState(''),[options,setOptions]=useState<Options>({permissionMode:'bypassPermissions'}),[error,setError]=useState(''),[sending,setSending]=useState(false),[commandOpen,setCommandOpen]=useState(false),[commandIndex,setCommandIndex]=useState(0),[focused,setFocused]=useState(false),[queue,setQueue]=useState<{id:string;text:string;options:Options;armed?:boolean}|null>(null);
 const outgoing=useRef<{key:string;text:string}|null>(null);
 const textRef=useRef<HTMLTextAreaElement>(null),highlight=useRef<HTMLDivElement>(null),scroll=useRef<HTMLDivElement>(null),follow=useRef(true),current=useRef(view),drafts=useRef(new Map<string,{input:string;options:Options}>()),lastKey=useRef(''),inputRef=useRef(input),optionsRef=useRef(options),started=useRef(Date.now());
 current.current=view;inputRef.current=input;optionsRef.current=options;
 const key=view.selected||'new:'+view.provider;
 const storageKey='isp-cloudcli-drafts:'+view.workspace+paneKey;
 useEffect(()=>{if(!view.workspace)return;try{sessionStorage.setItem(storageKey,JSON.stringify({drafts:[...drafts.current.set(key,{input,options})],queue}));}catch{}},[input,options,queue,view.workspace,key]);
 useEffect(()=>{
  function receive(event:MessageEvent){
   if(event.origin!==location.origin||event.source!==parent||event.data?.channel!=='isp-cloudcli-state')return;
   const next=event.data.view as View,nextKey=next.selected||'new:'+next.provider;
   if(next.workspace!==current.current.workspace){try{const saved=JSON.parse(sessionStorage.getItem('isp-cloudcli-drafts:'+next.workspace+paneKey)||'null');drafts.current=new Map(saved?.drafts||[]);setQueue(saved?.queue?{...saved.queue,armed:false}:null);}catch{}}
   if(nextKey!==lastKey.current){
    drafts.current.set(lastKey.current,{input:inputRef.current,options:optionsRef.current});
    const saved=drafts.current.get(nextKey);const followingNewSend=lastKey.current.startsWith('new:')&&outgoing.current?.key===lastKey.current;setInput(saved?.input||(followingNewSend&&inputRef.current!==outgoing.current?.text?inputRef.current:''));setOptions({permissionMode:next.provider==='claude'?'bypassPermissions':'',...(saved?.options||next.chat?.claudeOptions||{})});setError('');setCommandOpen(false);follow.current=true;lastKey.current=nextKey;cache.clear();
   }
   if(next.chat?.busy&&!current.current.chat?.busy)started.current=Date.now();
   startTransition(()=>setView(next));
  }
  window.addEventListener('message',receive);parent.postMessage({channel:'isp-cloudcli',action:'ready'},location.origin);
  return()=>window.removeEventListener('message',receive);
 },[]);
 useEffect(()=>{if(follow.current)scroll.current?.scrollTo({top:scroll.current.scrollHeight});},[view]);
 const openFile=useCallback((path:string)=>{void request('file',{path}).then(setFile).catch(e=>setError(e.message));},[]);
 usePaletteOpsRegister({openFileInEditor:path=>{void request('file',{path}).then(setFile).catch(e=>setError(e.message));},openDirectory:path=>{void request('file',{path}).then(setFile).catch(e=>setError(e.message));}});
 async function send(text=input,chosen=options,stopFirst=false){
  if(!text.trim()||sending)return;
  setSending(true);setError('');const originKey=key;outgoing.current={key:originKey,text};
  try{await request('send',{text,options:chosen,stopFirst,requestId:crypto.randomUUID(),chatId:view.selected});drafts.current.delete(originKey);if(lastKey.current===originKey||originKey.startsWith('new:'))setInput(value=>value===text?'':value);follow.current=true;}
  catch(e){setError(String(e));throw e;}finally{setSending(false);}
 }
 const commands=useMemo(()=>{
  const names=view.provider==='claude'?['init',...(view.chat?.commands||[])]:[];
  return [...new Set(names)].map(name=>({name:'/'+String(name).replace(/^\//,''),description:name==='init'?'Initialize project guidance using the company CLI':'Company CLI command',type:'built-in'}));
 },[view.provider,view.chat?.commands]);
 const filtered=commands.filter(c=>!input.startsWith('/')||c.name.startsWith(input.split(' ')[0]));
 const selectCommand=(command:any)=>{setInput(command.name+' ');setCommandOpen(false);textRef.current?.focus();};
 const models=view.provider==='claude'?[{value:'',label:'Workspace settings'},...['sonnet','opus','haiku'].map(value=>({value,label:value})),...(options.model&&!['sonnet','opus','haiku'].includes(options.model)?[{value:options.model,label:options.model}]:[])]:[{value:'',label:'Default'},...view.models.map(m=>({value:m.model,label:m.name}))];
 const activity=view.chat?.busy?{startedAt:started.current,statusText:view.chat.phase==='tool'?'Running tools':view.chat.phase==='responding'?'Responding':'Working',tasks:[]}:null;
 return <div className="isp-chat">
  {file&&<dialog open className="isp-file-preview"><header><strong>{file.path}</strong><button onClick={()=>setFile(null)}>닫기</button></header><pre>{file.content}</pre></dialog>}

  <div className="isp-transcript" ref={scroll} onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;}}><div className="isp-messages">
   {!view.chat&&<div className="isp-welcome"><h1>무엇을 함께 만들까요?</h1><p>코드 작업과 Board · Report를 함께 확인하세요.</p></div>}
   {view.total>(view.chat?.items?.length||0)&&<button className="isp-more" onClick={()=>void request('earlier')}>이전 메시지 더 보기</button>}
   <Rows items={view.chat?.items||[]} provider={view.provider} onFile={openFile}/>
   {view.chat?.plan&&<details><summary>작업 계획</summary>{view.chat.plan.map((p:any,i:number)=><p key={i}>{p.status}: {p.step}</p>)}</details>}
   {view.requests.map(r=><Approval key={r.id} request={r} submit={body=>request('answer',body).catch(e=>{setError(e.message);throw e;})}/>)}
   {view.chat?.notice&&<p className="isp-status">{view.chat.notice}</p>}
   {view.chat?.error&&<div role="alert" className="isp-error">{view.chat.error}{/does not support image/i.test(view.chat.error)&&<button onClick={()=>void request('recover').catch(e=>setError(e.message))}>이미지 제외하고 세션 복구</button>}</div>}
  </div></div>
  {(error||view.error)&&<div role="alert" className="isp-error">{error||view.error}</div>}
  <div className="isp-status">{view.chat?.runtimeOptions?.model||options.model||view.settings.filter(s=>s.model).at(-1)?.model||'Workspace settings'} · {view.chat?.runtimeOptions?.permissionMode||'CLI permissions'}{view.chat?.busy?' · 설정 변경은 다음 요청에 적용':''}</div>
  <details className="isp-settings"><summary>설정 출처 · 회사 모델</summary>{view.provider==='claude'&&<label>Model <input aria-label="회사 모델" value={options.model||''} placeholder="워크스페이스 설정 사용" onChange={e=>setOptions(o=>({...o,model:e.target.value}))}/></label>}{view.settings.map((s,i)=><p key={i}>{s.source} · {s.model||'—'} · {s.permissionMode||'—'} · {s.effort||'—'}</p>)}<button onClick={()=>setOptions({permissionMode:''})}>설정 파일의 기본값으로 초기화</button><p>CloudCLI UI · 회사 CLI {view.engine?.engineVersion||'연결 대기'} · <a href="/cloudcli/INTEGRATION.md" target="_blank" rel="noreferrer">About</a> · <a href="/cloudcli/LICENSE" target="_blank" rel="noreferrer">License</a> · <a href="/cloudcli/source.tar.gz" download>Source</a></p></details>
  {queue&&queue.id===view.selected&&(!queue.armed||(!view.chat?.busy&&view.chat?.status!=='completed'))&&<p className="isp-status">대기 메시지가 보류됐습니다. 편집 버튼으로 확인한 뒤 보내세요.</p>}
  {queue&&queue.id!==view.selected&&<p className="isp-status">다른 대화에 대기 중인 메시지가 있습니다. 해당 대화를 열면 이어집니다. <button onClick={()=>setQueue(null)}>취소</button></p>}
  {!!view.chat?.queue?.length&&<section className="isp-server-queue" aria-label="대기 지시"><header><strong>대기 지시 {view.chat.queue.length}</strong><span>{view.chat.queueReason}</span>{view.chat.queuePaused&&<button onClick={()=>void request('queue',{resume:true}).catch(e=>setError(e.message))}>재개</button>}</header>{view.chat.queue.map((item:any,index:number)=><div key={item.id}><span>{index+1}. {item.text}</span><button disabled={item.state==='dispatching'} onClick={()=>{const text=prompt('대기 지시 수정',item.text);if(text?.trim())void request('queue',{id:item.id,text}).catch(e=>setError(e.message));}}>수정</button><button disabled={item.state==='dispatching'} onClick={()=>void request('queue',{id:item.id,remove:true}).catch(e=>setError(e.message))}>취소</button></div>)}</section>}
  <div className="isp-composer">
   {view.chat?.busy&&input.trim()&&<div className="isp-stop-send"><button disabled={sending} onClick={()=>void send(input,options,true).catch(noop)}>중지 후 지금 보내기</button></div>}
   <ChatComposer
    pendingPermissionRequests={[]} handlePermissionDecision={noop} handleGrantToolPermission={()=>({success:false})}
    activity={activity as any} isLoading={!!view.chat?.busy} onAbortSession={()=>void request('stop').catch(e=>setError(e.message))}
    permissionMode={(options.permissionMode||'workspace') as any} availablePermissionModes={(view.provider==='claude'?['workspace','default','acceptEdits','plan','dontAsk','auto','bypassPermissions']:[]) as any} onSelectPermissionMode={permissionMode=>setOptions(o=>({...o,permissionMode:permissionMode==='workspace'?'':permissionMode}))}
    providerLabel={view.provider==='claude'?'Claude Code':'Codex'} effort={options.effort||'default'} availableEffortOptions={view.provider==='claude'?['low','medium','high','xhigh','max'].map(value=>({value})):[]} onSelectEffort={effort=>setOptions(o=>({...o,effort:effort==='default'?'':effort}))}
    model={options.model||''} availableModelOptions={models as any} onSelectModel={model=>setOptions(o=>({...o,model}))} modelsLoading={false}
    tokenBudget={null} onShowTokenUsage={noop} slashCommandsCount={commands.length} onToggleCommandMenu={()=>setCommandOpen(v=>!v)} hasInput={!!input} onClearInput={()=>setInput('')}
    onSubmit={e=>{e.preventDefault();void send().catch(noop);}} isDragActive={false}
    queuedDraft={queue?.id===view.selected?{content:queue.text,attachments:[]}:null as any} backgroundSendPrompt={null} onResolveBackgroundSendPrompt={noop} isEditingSentMessage={false} onCancelEditMessage={noop}
    scheduledMessages={[]} onScheduleMessage={noop} onCancelScheduledMessage={noop}
    onEditQueuedDraft={()=>{if(queue){setInput(queue.text);setOptions(queue.options);setQueue(null);}}} onDeleteQueuedDraft={()=>setQueue(null)}
    attachedFiles={[]} onRemoveAttachment={noop} fileErrors={new Map()} showFileDropdown={false} filteredFiles={[]} selectedFileIndex={0} onSelectFile={noop}
    filteredCommands={filtered} selectedCommandIndex={commandIndex} onCommandSelect={(c,index,hover)=>hover?setCommandIndex(index):selectCommand(c)} onCloseCommandMenu={()=>setCommandOpen(false)} isCommandMenuOpen={commandOpen} frequentCommands={[]}
    getRootProps={()=>({})} getInputProps={()=>({type:'hidden'})} openAttachmentPicker={noop}
    inputHighlightRef={highlight as any} renderInputWithMentions={text=>text} textareaRef={textRef as any} input={input}
    onInputChange={e=>{setInput(e.target.value);setCommandOpen(e.target.value.startsWith('/')&&!e.target.value.includes(' '));setCommandIndex(0);}}
    onTextareaClick={noop} onTextareaKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(commandOpen&&e.key==='Escape'){setCommandOpen(false);e.preventDefault();return;}if(commandOpen&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setCommandIndex(i=>Math.max(0,Math.min(filtered.length-1,i+(e.key==='ArrowDown'?1:-1))));return;}if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(commandOpen&&filtered[commandIndex])selectCommand(filtered[commandIndex]);else void send().catch(noop);}}}
    onTextareaPaste={noop} onTextareaScrollSync={noop} onTextareaInput={noop} isInputFocused={focused} onInputFocusChange={setFocused} placeholder={sending?'전송 중…':'메시지를 입력하세요. / 명령'} isTextareaExpanded={false}
   />
  </div>
 </div>;
}
class ChatBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<div role="alert" className="isp-error">채팅 화면을 다시 불러와야 합니다. 실행 중인 작업은 서버에서 유지됩니다. <button onClick={()=>location.reload()}>채팅 다시 열기</button></div>:this.props.children;}
}
createRoot(document.getElementById('root')!).render(<ChatBoundary><PaletteOpsProvider><App/></PaletteOpsProvider></ChatBoundary>);
