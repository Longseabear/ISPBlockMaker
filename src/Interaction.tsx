import {mergeInteraction} from './interaction-state';
import {startTransition,useEffect,useRef,useState} from 'react';
import {Plus,MessageSquare,RefreshCw,Trash2,FileText,ChevronRight,X} from 'lucide-react';
import type {Project,Api} from './types';
import './interaction.css';
type Item={id:string;type:string;text?:string;command?:string;status?:string;aggregatedOutput?:string;changes?:{path:string;diff:string}[];tool?:string;server?:string;result?:unknown;error?:unknown};
type ClaudeOptions={model?:string;effort?:string;permissionMode?:string};
type Chat={diagramId?:string;harnessRunId?:string;queue?:{id:string;text:string}[];queuePaused?:boolean;notice?:string;runtimeOptions?:{model?:string;permissionMode?:string};phase?:string;claudeOptions?:ClaudeOptions;provider?:'codex'|'claude';id:string;title:string;blockId:string;model?:string;items:Item[];busy:boolean;status:string;error?:string;plan?:{step:string;status:string}[]};
type Request={id:number|string;method:string;params:{chatId?:string;input?:unknown;threadId?:string;reason?:string;command?:string;cwd?:string;grantRoot?:string;availableDecisions?:unknown[];questions?:{id:string;header:string;question:string;multiSelect?:boolean;options?:{label:string;description:string}[]}[]}};
type State={declaredSettings?:{source:string;model?:string;permissionMode?:string;effort?:string;error?:string}[];claude?:{ready:boolean;sdkVersion:string;engineVersion:string;validated?:boolean}|null;preferredProvider?:'codex'|'claude';connected:boolean;account:{type:string;email?:string}|null;models:{id:string;model:string;name:string;isDefault:boolean}[];chats:Chat[];requests:Request[];error:string;mcp?:{revision:number;names:string[]}};
const empty:State={connected:false,account:null,models:[],chats:[],requests:[],error:''};
type InteractionProps={api:Api;token:string;project:Project;workspace:string;blockId:string;onArtifact:(id:string)=>void;panelOpen:boolean;onTogglePanel:()=>void};
function chatStatus(chat:Chat,requests:Request[]){
 const waiting=requests.some(r=>r.params.chatId===chat.id || (!!r.params.threadId && r.params.threadId===(chat as Chat&{threadId?:string}).threadId));
 return waiting?{kind:'waiting',label:'응답 대기'}:chat.busy?{kind:'running',label:chat.phase==='tool'?'도구 실행 중':'실행 중'}:chat.queue?.length?{kind:'waiting',label:chat.queuePaused?'대기 지시 일시정지':`지시 ${chat.queue.length}개 대기`}:chat.status==='failed'||chat.error?{kind:'failed',label:'오류'}:chat.status==='completed'?{kind:'completed',label:'완료'}:chat.status==='interrupted'?{kind:'interrupted',label:'중지됨'}:{kind:'idle',label:'대기'};
}
export function Interaction(props:InteractionProps){
 const {token,workspace}=props;
 const [state,setState]=useState<State>(empty),[error,setError]=useState('');
 const [panes,setPanes]=useState<number[]>(()=>{try{const p=JSON.parse(localStorage.getItem('isp-panes:'+workspace)||'[0]');return Array.isArray(p)&&p.length&&p.length<=4&&p.every(n=>Number.isSafeInteger(n)&&n>=0)?[...new Set<number>(p)]:[0];}catch{return [0];}}),[active,setActive]=useState(()=>{try{return Number(localStorage.getItem('isp-active-pane:'+workspace))||0;}catch{return 0;}}),[target,setTarget]=useState<{slot:number;id:string;nonce:number}|null>(null);
 useEffect(()=>{const open=(e:Event)=>setTarget({slot:active,id:(e as CustomEvent<string>).detail,nonce:Date.now()});window.addEventListener('isp-open-chat',open);return()=>window.removeEventListener('isp-open-chat',open);},[active]);
 const nextPane=useRef(Math.max(...panes)+1);
 useEffect(()=>{if(!panes.includes(active))setActive(panes[0]);},[panes,active]);
 useEffect(()=>{try{localStorage.setItem('isp-panes:'+workspace,JSON.stringify(panes));localStorage.setItem('isp-active-pane:'+workspace,String(active));}catch{}},[panes,active,workspace]);
 useEffect(()=>{
  const controller=new AbortController();let retry:ReturnType<typeof setTimeout>;
  async function connectStream(){
   try{
    const response=await fetch('/api/interaction/events',{headers:{Authorization:'Bearer '+token},signal:controller.signal});
    if(response.status===401)window.dispatchEvent(new Event('isp-session-expired'));
    if(!response.ok||!response.body)throw Error('대화 스트림 연결 실패 ('+response.status+')');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',first=true;
    setError('');
    while(!controller.signal.aborted){
     const {value,done}=await reader.read();if(done)throw Error('대화 연결이 끊겨 다시 연결합니다.');
     buffer+=decoder.decode(value,{stream:true});let end;
     while((end=buffer.indexOf('\n\n'))>=0){
      const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);if(!frame.startsWith('data: '))continue;
      const event=JSON.parse(frame.slice(6)) as {state?:State;updates:{chatId:string;item:Item}[]};const reset=first;first=false;
      startTransition(()=>setState(previous=>mergeInteraction<State,Item>(previous,event,reset)));
     }
    }
   }catch(e){if(!controller.signal.aborted){setError(String(e));retry=setTimeout(()=>void connectStream(),1500);}}
  }
  void connectStream();return()=>{controller.abort();clearTimeout(retry);};
 },[token,workspace]);
 return <section className="interaction-workspace">
  <div className="conversation-toolbar"><strong>대화 {panes.length}</strong><span>{state.chats.filter(c=>c.busy).length} 실행 중 · {state.chats.filter(c=>chatStatus(c,state.requests).kind==='waiting').length} 응답 대기</span><button disabled={panes.length>=4} onClick={()=>{const id=nextPane.current++;setPanes(p=>[...p,id]);setActive(id);}}>＋ 채팅 추가</button></div>
  <nav className="conversation-status-list" aria-label="대화 실행 상태">{[...state.chats].reverse().map(c=>{const status=chatStatus(c,state.requests);return <button key={c.id} title={c.title} onClick={()=>setTarget({slot:active,id:c.id,nonce:Date.now()})}><span className={`conversation-status ${status.kind}`}>{status.label}</span><span>{c.title}</span></button>;})}{!state.chats.length&&<span>새 대화에서 작업을 시작하세요.</span>}</nav>
  <div className={`conversation-panes ${panes.length>1?'multiple':''}`}>{panes.map((slot,index)=><div key={slot} className={`conversation-pane ${active===slot?'active':''}`} onFocusCapture={()=>setActive(slot)} onPointerDownCapture={()=>setActive(slot)}>
   {panes.length>1&&<div className="conversation-pane-label"><button aria-pressed={active===slot} onClick={()=>setActive(slot)}>대화 창 {index+1}</button><button aria-label={`대화 창 ${index+1} 닫기`} title="창만 닫기 · 작업은 계속 실행됩니다" onClick={()=>{setPanes(p=>p.filter(n=>n!==slot));if(active===slot)setActive(panes.find(n=>n!==slot)!);}}>×</button></div>}
   <InteractionPane {...props} onActivate={()=>setActive(slot)} state={state} streamError={error} slot={slot} target={target?.slot===slot?target:undefined}/>
  </div>)}</div>
 </section>;
}
function InteractionPane({api,token,project,workspace,blockId,onArtifact,panelOpen,onTogglePanel,state,streamError,slot,target,onActivate }:InteractionProps&{onActivate:()=>void;state:State;streamError:string;slot:number;target?:{id:string;nonce:number}}){
 const [selected,setSelected]=useState(()=>{try{return localStorage.getItem('isp-chat:'+workspace+':pane:'+slot)||(slot===0?localStorage.getItem('isp-chat:'+workspace)||'':'');}catch{return '';}}),[error,setError]=useState(''),[sending,setSending]=useState(false),[connecting,setConnecting]=useState(false);
 useEffect(()=>{try{localStorage.setItem('isp-chat:'+workspace+':pane:'+slot,selected);if(slot===0)localStorage.setItem('isp-chat:'+workspace,selected);}catch{}},[selected,workspace,slot]);
 useEffect(()=>{if(target){setSelected(target.id);setError('');}},[target]);
 const frame=useRef<HTMLIFrameElement>(null),[frameReady,setFrameReady]=useState(false),[limit,setLimit]=useState(80);
 const historyDialog=useRef<HTMLDialogElement>(null);
 const [providerChoice,setProvider]=useState<'codex'|'claude'|''>('');
 const chat=state.chats.find(c=>c.id===selected);
 const provider=chat?.provider||(chat?'codex':providerChoice||state.preferredProvider||'claude'),agentName=provider==='claude'?'Claude Code':'Codex';


 async function action(fn:()=>Promise<unknown>){setError('');try{await fn();}catch(e){setError(String(e));}}
 async function connect(){setConnecting(true);await action(()=>api('/interaction/connect',{provider}));setConnecting(false);}
 async function sendMessage(payload:{text:string;options:ClaudeOptions;stopFirst?:boolean;requestId?:string;chatId?:string}){
  if(sending)throw Error('전송 중입니다.');
  if((payload.chatId||'')!==selected)throw Error('대화가 변경되었습니다. 현재 대화에서 다시 보내세요.');
  if(!payload.text?.trim())throw Error('메시지를 입력하세요.');
  setSending(true);try{

   const result=await api<{id:string}>('/interaction/send',{text:payload.text,requestId:payload.requestId,stopFirst:payload.stopFirst,diagramId:chat?.diagramId||project.selectedDiagramId,provider,...(provider==='claude'?{claudeOptions:payload.options}:{model:payload.options.model??''}),...(chat?{chatId:chat.id}:{}),blockId});
   setSelected(result.id);return result;
  }finally{setSending(false);}
 }

 function selectProvider(next:'codex'|'claude'){if(next===provider)return;setProvider(next);setSelected('');setError('');}
 function choose(id:string){historyDialog.current?.close();setSelected(id);setError('');}

 const view={selected,workspace,provider,chat:chat?{...chat,items:chat.items.slice(-limit)}:null,total:chat?.items.length||0,requests:state.requests.filter(r=>r.params.chatId?r.params.chatId===chat?.id:!!chat&&(!r.params.threadId||r.params.threadId===(chat as Chat&{threadId?:string})?.threadId)),models:state.models,settings:state.declaredSettings||[],engine:state.claude,error:error||streamError||state.error};
 const latest=useRef({view,sendMessage,onActivate});latest.current={view,sendMessage,onActivate};
 useEffect(()=>{if(frameReady)frame.current?.contentWindow?.postMessage({channel:'isp-cloudcli-state',view},location.origin);},[state,selected,provider,error,streamError,limit,frameReady]);
 useEffect(()=>{
  const receive=async(event:MessageEvent)=>{
   if(event.origin!==location.origin||event.source!==frame.current?.contentWindow||event.data?.channel!=='isp-cloudcli')return;
   const {id,action:kind,payload={}}=event.data;
   if(kind==='focus'){latest.current.onActivate();return;}
   if(kind==='ready'){setFrameReady(true);frame.current?.contentWindow?.postMessage({channel:'isp-cloudcli-state',view:latest.current.view},location.origin);return;}
   try{let value:unknown;const current=latest.current.view;
    switch(kind){
     case 'send':value=await latest.current.sendMessage(payload);break;
     case 'stop':if(current.selected)value=await api('/interaction/interrupt',{id:current.selected});break;
     case 'queue':value=await api('/interaction/'+current.selected+'/queue',payload);break;
     case 'answer':value=await api('/interaction/answer',payload);break;
     case 'recover':value=await api('/interaction/'+current.selected+'/recover-image',{});break;
     case 'image':value=await api('/interaction/image',{path:payload.path});break;
     case 'file':value=await api('/interaction/file',{path:payload.path});break;
     case 'earlier':setLimit(n=>n+80);break;
     default:throw Error('지원하지 않는 요청입니다.');
    }
    frame.current?.contentWindow?.postMessage({channel:'isp-cloudcli-result',id,value},location.origin);
   }catch(e){frame.current?.contentWindow?.postMessage({channel:'isp-cloudcli-result',id,error:String(e)},location.origin);}
  };
  window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
 },[api]);
 useEffect(()=>setLimit(80),[selected]);
 return <section className="interaction"><dialog ref={historyDialog} className="chat-history-dialog" aria-labelledby="chat-history-title" onClick={e=>{if(e.target===e.currentTarget)historyDialog.current?.close();}}><aside className="chat-history"><div className="chat-history-heading"><strong id="chat-history-title">대화 기록</strong><button aria-label="대화 기록 닫기" onClick={()=>historyDialog.current?.close()}><X size={16}/></button></div><button className="chat-new" onClick={()=>choose('')}><Plus size={16}/> 새 대화</button><small>이 프로젝트의 대화</small><div className="chat-history-list">{[...state.chats].reverse().map(c=><div className={selected===c.id?'selected':''} key={c.id}><button onClick={()=>choose(c.id)}><MessageSquare size={14}/><span>{c.title}</span><small className={`conversation-status ${chatStatus(c,state.requests).kind}`}>{chatStatus(c,state.requests).label}</small></button><button aria-label={`${c.title} 대화 삭제`} disabled={c.busy} onClick={()=>{if(confirm('앱의 대화 목록에서 삭제할까요? 엔진 원본 기록과 작업 파일은 유지됩니다.'))void action(async()=>{await api('/interaction/'+c.id,undefined,'DELETE');if(selected===c.id)choose('');});}}><Trash2 size={12}/></button></div>)}</div><footer><strong>프로젝트 결과</strong>{project.artifacts.slice(-4).reverse().map(a=><button key={a.id} onClick={()=>{historyDialog.current?.close();onArtifact(a.id);}}><FileText size={14}/><span>{a.title}</span><ChevronRight size={13}/></button>)}<small>Visualizations에 등록된 결과</small></footer></aside></dialog>
 <div className="chat-main"><header className="chat-header"><button onClick={()=>historyDialog.current?.showModal()} aria-haspopup="dialog"><MessageSquare size={16}/> 대화 기록</button><button onClick={()=>choose('')}><Plus size={16}/> 새 대화</button><div className="chat-header-title"><strong>Interaction</strong><span>{agentName} · {provider==='claude'?(state.claude?.ready?'회사 CLI '+state.claude.engineVersion:'회사 CLI 연결 대기'):state.connected?'연결됨':'연결 대기'}</span></div><div className="chat-provider-switch" role="group" aria-label="실행 엔진 선택">{(['codex','claude'] as const).map(p=><button key={p} type="button" aria-pressed={provider===p} disabled={sending} onClick={()=>selectProvider(p)} title={chat&&provider!==p?'이 엔진으로 새 대화 시작':undefined}>{p==='claude'?'Claude Code':'Codex'}</button>)}</div><button onClick={onTogglePanel} aria-expanded={panelOpen}>{panelOpen?'작업 패널 숨기기':'작업 패널 열기'}</button><button aria-label="에이전트 연결" disabled={connecting||state.chats.some(c=>c.busy)} onClick={()=>void connect()}><RefreshCw size={14}/><span className="sr-only">{connecting?'연결 중':'엔진 확인'}</span></button></header>
 <div className="current-conversation"><strong title={chat?.blockId||"전체 프로젝트"}>{chat?.title||"새 대화"}{chat?` · ${chat.blockId||"전체 프로젝트"} · ${chat.diagramId||""}${chat.harnessRunId?" · Harness "+chat.harnessRunId.slice(0,8):""}`:""}</strong>{chat&&<span className={`conversation-status ${chatStatus(chat,state.requests).kind}`}>{chatStatus(chat,state.requests).label}</span>}</div>
 <iframe ref={frame} className="cloudcli-frame" title="Interaction · CloudCLI" src={`/cloudcli/index.html?pane=${slot}`}/>
 </div></section>;
}
