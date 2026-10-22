import {mergeInteraction} from './interaction-state';
import {startTransition,useEffect,useRef,useState} from 'react';
import {RefreshCw,X} from 'lucide-react';
import type {Project,Api} from './types';
import './interaction.css';
type Item={id:string;type:string;text?:string;command?:string;status?:string;aggregatedOutput?:string;changes?:{path:string;diff:string}[];tool?:string;server?:string;result?:unknown;error?:unknown};
type ClaudeOptions={model?:string;effort?:string;permissionMode?:string};
type Chat={createdAt?:string;updatedAt?:string;diagramId?:string;harnessRunId?:string;queue?:{id:string;text:string}[];queuePaused?:boolean;notice?:string;runtimeOptions?:{model?:string;permissionMode?:string};phase?:string;claudeOptions?:ClaudeOptions;provider?:'codex'|'claude';id:string;title:string;blockId:string;model?:string;items:Item[];busy:boolean;status:string;error?:string;plan?:{step:string;status:string}[]};
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
 const [listOpen,setListOpen]=useState(false),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[menu,setMenu]=useState(''),[editing,setEditing]=useState(''),[title,setTitle]=useState(''),[deleting,setDeleting]=useState(''),[pending,setPending]=useState(false),[managementError,setManagementError]=useState('');
 const [opened,setOpened]=useState<Record<number,string>>(()=>Object.fromEntries(panes.map(slot=>[slot,localStorage.getItem('isp-chat:'+workspace+':pane:'+slot)||(slot===0?localStorage.getItem('isp-chat:'+workspace)||'':'')])));
 function openChat(id:string,newPane=false){let slot=active;if(newPane){if(panes.length>=4)return;slot=nextPane.current++;setPanes(p=>[...p,slot]);setActive(slot);}setTarget({slot,id,nonce:Date.now()});setOpened(p=>({...p,[slot]:id}));setListOpen(false);setMenu('');}
 function closePane(slot:number){if(panes.length===1){setTarget({slot,id:'',nonce:Date.now()});setOpened(p=>({...p,[slot]:''}));}else{setPanes(p=>p.filter(n=>n!==slot));if(active===slot)setActive(panes.find(n=>n!==slot)!);}}
 async function manage(id:string,kind:'rename'|'delete'){setPending(true);setManagementError('');try{await props.api('/interaction/'+id,kind==='rename'?{title}:undefined,kind==='rename'?'PATCH':'DELETE');if(kind==='delete')window.dispatchEvent(new CustomEvent('isp-chat-deleted',{detail:id}));setEditing('');setDeleting('');setMenu('');}catch(e){setManagementError(String(e));}finally{setPending(false);}}
 const visible=[...state.chats].sort((a,b)=>(b.updatedAt||b.createdAt||'').localeCompare(a.updatedAt||a.createdAt||'')).filter(c=>(!query||c.title.toLowerCase().includes(query.toLowerCase()))&&(filter==='all'||(filter==='running'?c.busy||chatStatus(c,state.requests).kind==='waiting':c.status==='completed')));
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
  <div className="conversation-toolbar"><button aria-expanded={listOpen} onClick={()=>setListOpen(v=>!v)}>대화 목록 <span>{state.chats.length}</span></button><span>{state.chats.filter(c=>c.busy).length} 실행 중</span><button onClick={()=>openChat('')}>＋ 새 대화</button><button disabled={panes.length>=4} onClick={()=>openChat('',true)}>분할 열기</button></div>
  <nav className="open-chat-tabs" aria-label="열린 대화">{panes.map(slot=>{const c=state.chats.find(c=>c.id===opened[slot]);return <div key={slot} className={slot===active?'active':''}><button onClick={()=>{setActive(slot);document.getElementById('chat-pane-'+slot)?.scrollIntoView({block:'nearest',inline:'nearest'});}}>{c&&<span className={`conversation-status ${chatStatus(c,state.requests).kind}`}>{chatStatus(c,state.requests).label}</span>}<span>{c?.title||'새 대화'}</span></button><button aria-label={`${c?.title||'새 대화'} 탭 닫기`} title="화면에서만 닫기 · 실행은 계속됩니다" onClick={()=>closePane(slot)}>×</button></div>;})}</nav>
  {listOpen&&<section className="conversation-library" aria-label="대화 목록"><div className="conversation-library-search"><input autoFocus aria-label="대화 검색" placeholder="대화 검색…" value={query} onChange={e=>setQuery(e.target.value)}/><button aria-label="대화 목록 닫기" onClick={()=>setListOpen(false)}><X size={16}/></button></div><div className="conversation-filters">{[['all','전체'],['running','실행 중 · 응답 대기'],['completed','완료']].map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>{managementError&&<p role="alert">{managementError}</p>}<div className="conversation-library-rows">{visible.map(c=>{const status=chatStatus(c,state.requests);const preview=[...c.items].reverse().find(i=>i.text?.trim())?.text;return <article key={c.id} className="conversation-library-row"><div className="conversation-library-line"><button className="conversation-open" onClick={()=>openChat(c.id)}><strong>{c.title}</strong><span>{preview?.replace(/\s+/g,' ').slice(0,150)||'메시지 기록 없음'}</span></button><span className={`conversation-status ${status.kind}`}>{status.label}</span><button aria-label={`${c.title} 대화 메뉴`} aria-expanded={menu===c.id} onClick={()=>{setMenu(menu===c.id?'':c.id);setEditing('');setDeleting('');setManagementError('');}}>⋯</button></div><small>{c.provider==='claude'?'Claude Code':'Codex'}{(c.updatedAt||c.createdAt)?' · '+(c.updatedAt?'최근 활동 ':'생성 ')+new Date(c.updatedAt||c.createdAt!).toLocaleString():''}</small>{menu===c.id&&<div className="conversation-row-actions"><button onClick={()=>{setEditing(c.id);setTitle(c.title);setDeleting('');}}>이름 변경</button><button disabled={panes.length>=4} onClick={()=>openChat(c.id,true)}>다른 창에서 열기</button><button disabled={c.busy} title={c.busy?'실행을 중지한 뒤 삭제할 수 있습니다':undefined} onClick={()=>{setDeleting(c.id);setEditing('');}}>삭제</button></div>}{editing===c.id&&<form className="conversation-row-editor" onSubmit={e=>{e.preventDefault();void manage(c.id,'rename');}}><input aria-label="새 대화 이름" maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/><button disabled={pending||!title.trim()}>저장</button><button type="button" onClick={()=>setEditing('')}>취소</button></form>}{deleting===c.id&&<div className="conversation-delete-confirm"><p>앱 목록에서 삭제합니다. 작업 파일과 엔진 원본 기록은 유지됩니다.{c.queue?.length?' 대기 중인 추가 지시도 제거됩니다.':''}</p><button disabled={pending||c.busy} onClick={()=>void manage(c.id,'delete')}>대화 삭제</button><button disabled={pending} onClick={()=>setDeleting('')}>취소</button></div>}</article>;})}{!visible.length&&<p className="conversation-empty">{query||filter!=='all'?'조건에 맞는 대화가 없습니다.':'아직 대화가 없습니다. 새 대화를 시작하세요.'}</p>}</div></section>}
  <div className={`conversation-panes ${panes.length>1?'multiple':''}`}>{panes.map((slot,index)=><div id={'chat-pane-'+slot} key={slot} className={`conversation-pane ${active===slot?'active':''}`} onFocusCapture={()=>setActive(slot)} onPointerDownCapture={()=>setActive(slot)}>
   {panes.length>1&&<div className="conversation-pane-label"><button aria-pressed={active===slot} onClick={()=>setActive(slot)}>대화 창 {index+1}</button><button aria-label={`대화 창 ${index+1} 닫기`} title="창만 닫기 · 작업은 계속 실행됩니다" onClick={()=>{setPanes(p=>p.filter(n=>n!==slot));if(active===slot)setActive(panes.find(n=>n!==slot)!);}}>×</button></div>}
   <InteractionPane {...props} onSelection={(id)=>setOpened(p=>p[slot]===id?p:{...p,[slot]:id})} onActivate={()=>setActive(slot)} state={state} streamError={error} slot={slot} target={target?.slot===slot?target:undefined}/>
  </div>)}</div>
 </section>;
}
function InteractionPane({api,token,project,workspace,blockId,onArtifact,panelOpen,onTogglePanel,state,streamError,slot,target,onActivate,onSelection }:InteractionProps&{onSelection:(id:string)=>void;onActivate:()=>void;state:State;streamError:string;slot:number;target?:{id:string;nonce:number}}){
 const [selected,setSelected]=useState(()=>{try{return localStorage.getItem('isp-chat:'+workspace+':pane:'+slot)||(slot===0?localStorage.getItem('isp-chat:'+workspace)||'':'');}catch{return '';}}),[error,setError]=useState(''),[sending,setSending]=useState(false),[connecting,setConnecting]=useState(false);
 useEffect(()=>{try{localStorage.setItem('isp-chat:'+workspace+':pane:'+slot,selected);if(slot===0)localStorage.setItem('isp-chat:'+workspace,selected);}catch{}},[selected,workspace,slot]);
 useEffect(()=>{if(target){setSelected(target.id);setError('');}},[target]);
 const frame=useRef<HTMLIFrameElement>(null),[frameReady,setFrameReady]=useState(false),[limit,setLimit]=useState(80);
 useEffect(()=>{onSelection(selected);},[selected]);
 useEffect(()=>{const deleted=(e:Event)=>{if((e as CustomEvent<string>).detail===selected)setSelected('');};window.addEventListener('isp-chat-deleted',deleted);return()=>window.removeEventListener('isp-chat-deleted',deleted);},[selected]);
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
 return <section className="interaction">
 <div className="chat-main"><header className="chat-header"><div className="chat-header-title"><strong>Interaction</strong><span>{agentName} · {provider==='claude'?(state.claude?.ready?'회사 CLI '+state.claude.engineVersion:'회사 CLI 연결 대기'):state.connected?'연결됨':'연결 대기'}</span></div><div className="chat-provider-switch" role="group" aria-label="실행 엔진 선택">{(['codex','claude'] as const).map(p=><button key={p} type="button" aria-pressed={provider===p} disabled={sending} onClick={()=>selectProvider(p)} title={chat&&provider!==p?'이 엔진으로 새 대화 시작':undefined}>{p==='claude'?'Claude Code':'Codex'}</button>)}</div><button onClick={onTogglePanel} aria-expanded={panelOpen}>{panelOpen?'작업 패널 숨기기':'작업 패널 열기'}</button><button aria-label="에이전트 연결" disabled={connecting||state.chats.some(c=>c.busy)} onClick={()=>void connect()}><RefreshCw size={14}/><span className="sr-only">{connecting?'연결 중':'엔진 확인'}</span></button></header>
 <div className="current-conversation"><strong title={chat?.blockId||"전체 프로젝트"}>{chat?.title||"새 대화"}{chat?` · ${chat.blockId||"전체 프로젝트"} · ${chat.diagramId||""}${chat.harnessRunId?" · Harness "+chat.harnessRunId.slice(0,8):""}`:""}</strong>{chat&&<span className={`conversation-status ${chatStatus(chat,state.requests).kind}`}>{chatStatus(chat,state.requests).label}</span>}</div>
 <iframe ref={frame} className="cloudcli-frame" title="Interaction · CloudCLI" src={`/cloudcli/index.html?pane=${slot}`}/>
 </div></section>;
}
