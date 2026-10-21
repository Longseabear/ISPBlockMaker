
import {useState} from 'react';
import type {Api,Project} from './types';
import './diagram-tabs.css';
export function DiagramTabs({project,api,disabled}:{project:Project;api:Api;disabled:boolean}){
 const [editing,setEditing]=useState<'new'|'rename'|null>(null),[name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const diagrams=project.diagrams||[{id:'main',name:'Main'}],selected=project.selectedDiagramId||'main';
 const current=diagrams.find(d=>d.id===selected);
 async function act(fn:()=>Promise<unknown>){setBusy(true);setError('');try{await fn();setEditing(null);}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <div className="diagram-tabs"><div role="tablist" aria-label="Block diagrams">{diagrams.map(d=><button key={d.id} role="tab" aria-selected={d.id===selected} disabled={disabled||busy} onClick={()=>void act(()=>api('/diagrams/'+d.id+'/select',{}))}>{d.name}<small>{project.blocks.filter(b=>(b.diagramId||'main')===d.id).length}</small></button>)}</div>
 <button disabled={disabled||busy} onClick={()=>{setName('');setEditing('new');}}>+ Diagram</button><button disabled={disabled||busy} onClick={()=>{setName(current?.name||'');setEditing('rename');}}>이름 변경</button>
 <button disabled={disabled||busy||diagrams.length===1||project.blocks.some(b=>b.diagramId===selected)} title="블록을 먼저 이동하거나 제거한 빈 다이어그램만 삭제할 수 있습니다." onClick={()=>void act(()=>api('/diagrams/'+selected,{revision:project.revision},'DELETE'))}>빈 탭 삭제</button>
 {editing&&<form onSubmit={e=>{e.preventDefault();void act(()=>editing==='new'?api('/diagrams',{revision:project.revision,diagram:{id:'diagram-'+crypto.randomUUID().slice(0,8),name:name.trim()}}):api('/diagrams/'+selected,{revision:project.revision,patch:{name:name.trim()}},'PATCH'));}}><input autoFocus aria-label="다이어그램 이름" maxLength={100} required value={name} onChange={e=>setName(e.target.value)}/><button disabled={busy||!name.trim()}>저장</button><button type="button" onClick={()=>setEditing(null)}>취소</button></form>}
 {error&&<span role="alert">{error}</span>}</div>;
}
