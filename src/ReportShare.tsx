import {useState} from 'react';
import {Share2,X,Copy,Power,Trash2} from 'lucide-react';
import type {Api,Artifact} from './types';
import './report-share.css';
type State={running:boolean;port:number;addresses:{name:string;address:string}[];items:{artifactId:string;token:string;title:string;revision:number;updatedAt:string}[]};
export function ReportShare({api,artifact}:{api:Api;artifact?:Artifact}){
  const [open,setOpen]=useState(false),[state,setState]=useState<State|null>(null),[address,setAddress]=useState(''),[port,setPort]=useState('4311'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function run(endpoint:string,body?:unknown,method?:string){
    setBusy(true);setError('');setNotice('');
    try{const next=await api<State>(endpoint,body,method);setState(next);setPort(String(next.port));setAddress(old=>next.addresses.some(a=>a.address===old)?old:next.addresses[0]?.address||'');}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  const selected=state?.items.find(i=>i.artifactId===artifact?.id);
  return <>
    <button title="로컬망에 리포트 공유" aria-label="리포트 공유" onClick={()=>{setOpen(true);void run('/report-sharing');}}><Share2 size={16}/></button>
    {open&&<div className="report-share-backdrop" onClick={()=>setOpen(false)}><section className="report-share-dialog" role="dialog" aria-modal="true" aria-label="로컬망 리포트 공유" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}>
      <header><h2>리포트 공유 <small>{state?.running?'● 실행 중':'○ 중지됨'}</small></h2><button autoFocus aria-label="닫기" onClick={()=>setOpen(false)}><X size={18}/></button></header>
      <p>이 PC와 서버가 켜져 있는 동안 링크를 가진 사람이 열람할 수 있습니다. 공유본은 별도로 저장되며 원본 변경은 자동 반영되지 않습니다.</p>
      <div className="report-share-network"><label>네트워크 주소<select value={address} onChange={e=>setAddress(e.target.value)}>{state?.addresses.map(a=><option key={a.address} value={a.address}>{a.name} · {a.address}</option>)}</select></label><label>포트<input type="number" min="1024" max="65535" value={port} disabled={busy||state?.running} onChange={e=>setPort(e.target.value)}/></label></div>
      {!address&&<p role="status">LAN 주소를 찾지 못했습니다. 네트워크 연결을 확인하세요.</p>}
      <div className="report-share-actions"><button disabled={busy||!state||!address||!artifact} className="primary" onClick={()=>void run('/report-sharing/publish',{artifactId:artifact?.id})}><Share2 size={15}/>{selected?'공유본 업데이트':'현재 리포트 공유'}</button>
      {state?.running?<button disabled={busy} onClick={()=>void run('/report-sharing/stop',{})}><Power size={15}/>전체 공유 중지</button>:<button disabled={busy||!state||!address} onClick={()=>void run('/report-sharing/start',{port:Number(port)})}><Power size={15}/>공유 서버 시작</button>}
      <button disabled={busy} onClick={()=>void run('/report-sharing')}>새로고침</button></div>
      <p className="report-share-hint">최초 공유 시 자동 시작(기본 4311, 사용 중이면 빈 포트). 지정 포트는 ‘공유 서버 시작’으로 적용하세요. Windows 방화벽에서 신뢰하는 사설 네트워크에 해당 포트를 허용해야 할 수 있습니다. 주소 선택은 링크 생성용이며 모든 IPv4 인터페이스에서 수신합니다.</p>
      {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      <div className="report-share-list">{state?.items.map(item=>{const link=`http://${address}:${state.port}/s/${item.token}`;return <article key={item.token}><strong>{item.title}</strong><small>r{item.revision} · {new Date(item.updatedAt).toLocaleString()}{!state.running?' · 서버 중지됨':''}</small><div><input aria-label={`${item.title} 공유 링크`} readOnly value={address?link:'네트워크 주소 없음'} onFocus={e=>e.target.select()}/><button disabled={!address||!state.running} title="링크 복사" aria-label={`${item.title} 링크 복사`} onClick={()=>{void navigator.clipboard.writeText(link).then(()=>setNotice('링크를 복사했습니다.')).catch(()=>setError('링크를 선택하여 직접 복사하세요.'));}}><Copy size={16}/></button><button disabled={busy} title="공유 취소" aria-label={`${item.title} 공유 취소`} onClick={()=>void run(`/report-sharing/${item.token}`,{},'DELETE')}><Trash2 size={16}/></button></div></article>;})}</div>
      <p className="report-share-hint">공유 취소는 원본을 삭제하지 않습니다. 재시작 후 공유 서버는 OFF이며 다시 켜면 저장된 링크가 활성화됩니다. IP·포트가 바뀌면 링크도 달라집니다. HTML에 포함된 그림·수식만 공유하며 외부 파일·API 참조는 제공하지 않습니다.</p>
    </section></div>}
  </>;
}
