import {useTerminalKeyboard} from './terminal-keyboard';
import {useEffect,useRef,useState} from 'react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import type {Api} from './types';
import {terminalClipboardHandler} from './terminal-clipboard';
import './shared-terminals.css';

type Agent={id:string;label:string;status:string};
type Session={id:string;title:string;agentId?:string;agent?:Agent;controlVersion:number;owner:'agent'|'user';status:'running'|'stopping'|'exited';exitCode?:number};
export function SharedTerminals({api,token,visible,onPresent}:{api:Api;token:string;visible:boolean;onPresent:()=>void}){
 const [resourceText,setResourceText]=useState(''),[joinKey,setJoinKey]=useState('');
 const [sessions,setSessions]=useState<Session[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[connected,setConnected]=useState(false),[pending,setPending]=useState(false);
 const host=useRef<HTMLDivElement>(null),socket=useRef<WebSocket|null>(null),terminal=useRef<Terminal|null>(null),fit=useRef<FitAddon|null>(null);
 const attached=useRef('');
 const latest=useRef({visible,selected,onPresent,version:0});latest.current={visible,selected,onPresent,version:sessions.find(s=>s.id===selected)?.controlVersion??0};
 const keyboard=useTerminalKeyboard(selected);
 const session=sessions.find(s=>s.id===selected);
 useEffect(()=>setJoinKey(''),[selected,token]);
 const send=(value:unknown)=>{if(socket.current?.readyState!==WebSocket.OPEN){setError('터미널 연결이 끊겼습니다. 재연결 후 다시 입력하세요.');return;}socket.current.send(JSON.stringify(value));};
 const resize=()=>{if(!terminal.current||!host.current?.clientWidth||attached.current!==latest.current.selected)return;fit.current?.fit();send({type:'shared-resize',cols:terminal.current.cols,rows:terminal.current.rows});};
 useEffect(()=>{
  let disposed=false,retry:ReturnType<typeof setTimeout>;
  function connect(){
   const ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws?token=${encodeURIComponent(token)}`);socket.current=ws;
   ws.onopen=()=>{if(disposed)return;setConnected(true);setError('');ws.send(JSON.stringify({type:'shared-subscribe'}));if(latest.current.visible&&latest.current.selected)ws.send(JSON.stringify({type:'shared-attach',id:latest.current.selected}));};
   ws.onmessage=e=>{
    if(disposed)return;const m=JSON.parse(e.data);
    if(m.type==='shared-terminals'){setSessions(m.sessions);if(m.resources)setResourceText(`${m.resources.running} 실행 · ${m.resources.sessions}/${m.resources.limits.sessions} 세션 · 출력 ${(m.resources.bufferChars*2/1048576).toFixed(1)} MiB`);setSelected(current=>m.sessions.some((s:Session)=>s.id===current)?current:m.sessions[0]?.id||'');}
    if(m.type==='shared-present'){setSelected(m.id);setNotice(m.message);latest.current.onPresent();}
    if(m.type==='shared-attached'&&m.session.id===latest.current.selected){attached.current=m.session.id;terminal.current?.reset();terminal.current?.write(m.buffer,()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'shared-ack',id:m.session.id,chars:m.buffer.length}));});resize();}
    if(m.type==='shared-output'&&m.id===latest.current.selected)terminal.current?.write(m.data,()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'shared-ack',id:m.id,chars:m.data.length}));});
    if(m.type==='shared-exit'&&m.id===latest.current.selected)terminal.current?.writeln(`\r\n[세션 종료 · ${m.exitCode}]`);
    if(m.type==='error')setError(m.error);
    if(m.type==='workspace-changed'){disposed=true;setConnected(false);setSessions([]);setSelected('');setError('작업 폴더가 변경되었습니다. 페이지를 새로고침하세요.');ws.close();}
   };
   ws.onclose=()=>{attached.current='';if(disposed)return;setConnected(false);retry=setTimeout(connect,1500);};
  }
  connect();return()=>{disposed=true;clearTimeout(retry);socket.current?.close();};
 },[token]);
 useEffect(()=>{
  if(!visible||!selected||!host.current)return;
  const term=new Terminal({fontSize:13,fontFamily:'Cascadia Mono, Consolas, monospace',scrollback:3000,disableStdin:true,theme:{background:'#11151d',foreground:'#e4e9f2'}}),addon=new FitAddon();
  terminal.current=term;fit.current=addon;term.loadAddon(addon);term.open(host.current);
  term.attachCustomKeyEventHandler(terminalClipboardHandler({deleteWord:()=>term.input(keyboard.deleteWord(),true),copySelection:()=>document.execCommand("copy"),readText:()=>navigator.clipboard.readText(),writeText:text=>navigator.clipboard.writeText(text),paste:text=>term.paste(text),ready:()=>!term.options.disableStdin&&socket.current?.readyState===WebSocket.OPEN,selection:()=>term.getSelection(),selectAll:()=>term.selectAll(),error:setError}));
  const input=term.onData(data=>send({type:'shared-input',controlVersion:latest.current.version,requestId:crypto.randomUUID(),data}));
  const observer=new ResizeObserver(()=>{if(socket.current?.readyState===WebSocket.OPEN)resize();});observer.observe(host.current);
  if(socket.current?.readyState===WebSocket.OPEN)send({type:'shared-attach',id:selected});
  return()=>{attached.current='';if(socket.current?.readyState===WebSocket.OPEN)send({type:'shared-detach'});observer.disconnect();input.dispose();terminal.current=null;fit.current=null;term.dispose();};
 },[visible,selected,token,!!session]);
 useEffect(()=>{if(terminal.current)terminal.current.options.disableStdin=!connected||session?.status!=='running';},[connected,session?.owner,session?.status,visible,selected]);
 async function action(fn:()=>Promise<unknown>){setPending(true);setError('');try{await fn();}catch(e){setError(String(e));}finally{setPending(false);}}
 const content = <section className="shared-terminals" style={{display:visible?'flex':'none'}} aria-label="Terminal Hub">
  <header><strong>Terminal Hub</strong><small>탭 이동: Alt+←/→</small><span className="shared-connection">{connected?'연결됨':'재연결 중'}</span><button disabled={pending||!connected} onClick={()=>void action(async()=>{const s=await api<Session>('/shared-terminals',{id:crypto.randomUUID(),title:`터미널 ${sessions.length+1}`,owner:'user'});setSelected(s.id);setJoinKey('');setNotice('');})}>새 터미널</button></header>
  <div className="shared-tabs" role="tablist" aria-label="공유 세션" title="이전/다음 탭: Alt+←/→">{sessions.map(s=><button key={s.id} role="tab" aria-selected={selected===s.id} onClick={()=>{setSelected(s.id);setJoinKey('');setNotice('');}}>{s.title}<small>{s.agent?.label||'사용자'}{s.agentId?' #'+s.agentId.slice(0,8):''} · {s.status==='exited'?'종료':s.status==='stopping'?'종료 중':s.owner==='user'?'사용자 입력':'에이전트'}</small></button>)}</div>
  {notice&&<p className="shared-notice">{notice}<button aria-label="안내 닫기" onClick={()=>setNotice('')}>×</button></p>}
  {error&&<p role="alert" className="shared-error">{error}</p>}
  {session?<><div className="shared-controls"><span>{session.status==='exited'?`종료 코드 ${session.exitCode}`:session.owner==='user'?'사용자 입력 우선 · 제출 후 에이전트 재개':`${session.agent?.label||'에이전트'} · ${session.agent?.status==='disconnected'?'연결 종료':session.agent?.status==='unconfirmed'?'연결 확인 필요':'조작 중'} · 입력하면 사용자 우선`}</span>{session.status==='running'&&<><select aria-label="터미널 키 입력" title="Ctrl+Backspace: Windows는 Ctrl+H, SSH·Linux는 Ctrl+W" value={keyboard.mode} onChange={e=>keyboard.change(e.target.value)}><option value="windows">Windows 키</option><option value="unix">SSH·Linux 키</option></select><button disabled={pending||!connected} onClick={()=>send({type:'shared-input',controlVersion:latest.current.version,requestId:crypto.randomUUID(),data:'\u0003'})}>Ctrl+C</button><button disabled={pending||!connected} onClick={()=>void action(()=>api('/shared-terminals/'+selected+'/stop',{}))}>세션 종료</button></>}{session.status==='exited'&&<button disabled={pending||!connected} onClick={()=>void action(()=>api('/shared-terminals/'+selected,undefined,'DELETE'))}>목록에서 삭제</button>}</div>{session.status==='running'&&<div className="shared-controls"><button disabled={pending||!connected} onClick={()=>void action(async()=>{const result=await api<{key:string}>('/shared-terminals/'+selected+'/join-key',{});setJoinKey(result.key);try{await navigator.clipboard.writeText(result.key);setNotice('키를 복사했습니다. 에이전트에게 전달하면 이 터미널에 연결합니다.');}catch{setNotice('아래 키를 선택해 복사한 뒤 에이전트에게 전달하세요.');}})}>Shared Terminal Key 복사</button>{joinKey&&<input aria-label="Shared Terminal Key" readOnly value={joinKey} onFocus={event=>event.currentTarget.select()}/>}</div>}<div className="shared-screen" ref={host}/></>:<div className="shared-empty"><h3>함께 보는 작업 터미널</h3><p>SSH, 개발 서버, 빌드 로그를 같은 화면에서 확인하세요.</p><p>에이전트가 만든 세션도 여기에 나타납니다. 화면을 숨겨도 작업은 계속됩니다.</p></div>}
  <footer>{resourceText}<br/>화면 숨기기는 세션을 종료하지 않습니다. 앱 서버를 종료하면 세션도 종료됩니다.</footer>
 </section>;
 return content;
}
