import {useEffect,useState} from 'react';
import {Package,Download,X,Check,RefreshCw} from 'lucide-react';
import type {Api} from './types';
import './bundle-exchange.css';

type BundleArtifact={id:string;title:string;kind:string;file:string;blockId:string};
type Plan={downloadName:string;fileCount:number;bytes:number;revision:number;skipped:string[];files:{path:string;size:number}[];includeGit:boolean;sourceRoot?:string;availableArtifacts?:BundleArtifact[];selectedArtifactIds?:string[]};
type VisualizationChoice='all'|'selected'|'none';
const size=(bytes:number)=>bytes<1024*1024?`${(bytes/1024).toFixed(1)} KiB`:`${(bytes/1024/1024).toFixed(1)} MiB`;
export function BundleShare({api,token,dirty}:{api:Api;token:string;dirty:boolean}){
 const [open,setOpen]=useState(false),[images,setImages]=useState(true),[viewer,setViewer]=useState(true),[data,setData]=useState(false),[git,setGit]=useState(false);
 const [visualizations,setVisualizations]=useState<VisualizationChoice>('all'),[artifactIds,setArtifactIds]=useState<string[]>([]),[availableArtifacts,setAvailableArtifacts]=useState<BundleArtifact[]>([]);
 const [planned,setPlanned]=useState<{key:string;value:Plan}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[notice,setNotice]=useState('');
 const options={includeImages:viewer&&images,includeViewer:viewer,includeData:data,includeGit:git,includeVisualizations:visualizations!=='none',...(visualizations==='selected'?{artifactIds}:{} )};
 const settingsKey=JSON.stringify(options),plan=planned?.key===settingsKey?planned.value:null;
 useEffect(()=>{
  if(!open)return;
  let alive=true;
  setPlanned(null);setError('');setNotice('');
  const values=JSON.parse(settingsKey) as typeof options;
  const query=new URLSearchParams();
  for(const [name,value] of Object.entries(values))query.set(name,Array.isArray(value)?value.join(','):String(value));
  api<Plan>(`/bundle/preview?${query}`).then(result=>{if(alive){setPlanned({key:settingsKey,value:result});setAvailableArtifacts(result.availableArtifacts||[]);}}).catch(async error=>{
   if(!alive)return;
   if(/unknown visualization/i.test(String(error))&&values.artifactIds){
    try{
     query.delete('artifactIds');
     const catalog=await api<Plan>(`/bundle/preview?${query}`);
     if(!alive)return;
     const available=catalog.availableArtifacts||[];
     setAvailableArtifacts(available);setArtifactIds(ids=>ids.filter(id=>available.some(artifact=>artifact.id===id)));return;
    }catch(nextError){if(alive)setError(String(nextError));return;}
   }
   setError(String(error));
  });
  return()=>{alive=false;};
 },[api,open,settingsKey,refresh]);
 async function download(){
  if(!plan||busy||dirty)return;
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/bundle/export',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...options,revision:plan.revision})});
   if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||`Bundle export failed (${response.status})`);}
   const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');
   anchor.href=url;anchor.download=plan.downloadName||'workspace.bundle';anchor.click();
   setNotice('번들 다운로드를 시작했습니다.');setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError(String(e));setPlanned(null);}finally{setBusy(false);}
 }
 return <>
  <button className="bundle-share-button" title="프로젝트를 .bundle로 공유" aria-label="프로젝트 공유" onClick={()=>setOpen(true)}><Package size={15}/><span>공유</span></button>
  {open&&<div className="workspace-picker-backdrop"><section className="bundle-dialog bundle-exchange-dialog" role="dialog" aria-modal="true" aria-label="프로젝트 번들 저장" onKeyDown={e=>{if(e.key==='Escape'&&!busy)setOpen(false);}}>
   <header><div><h2>프로젝트 공유</h2><p>구현과 함께 전달할 결과를 선택하세요.</p></div><button autoFocus disabled={busy} aria-label="번들 창 닫기" onClick={()=>setOpen(false)}><X size={18}/></button></header>
   <div className="bundle-core"><Check size={17}/><div><strong>Project · 항상 포함</strong><small>그래프, 구현 코드, 요청/JOB, 작업 기록, 참조 입출력 세트 및 프로젝트 스킬</small></div></div>
   <fieldset className="bundle-choices" disabled={busy}><legend>Visualizations</legend><div className="bundle-choice-row">
    {([['all','전체'],['selected','선택'],['none','제외']] as const).map(([value,label])=><label key={value} className={visualizations===value?'active':''}><input type="radio" name="bundle-visualizations" value={value} checked={visualizations===value} onChange={()=>setVisualizations(value)}/>{label}{value==='all'&&availableArtifacts.length>0?` (${availableArtifacts.length})`:''}</label>)}
   </div>
   {visualizations==='selected'&&<div className="bundle-artifact-list" aria-label="공유할 시각화 선택">
    {availableArtifacts.length?availableArtifacts.map(artifact=><label key={artifact.id}><input type="checkbox" checked={artifactIds.includes(artifact.id)} onChange={e=>setArtifactIds(ids=>e.target.checked?[...ids,artifact.id]:ids.filter(id=>id!==artifact.id))}/><span>{artifact.title}<small>{artifact.kind}{artifact.blockId?` · ${artifact.blockId}`:''}</small></span></label>):<p>등록된 시각화가 없습니다.</p>}
   </div>}
   <small>{visualizations==='none'?'시각화 파일은 제외하고 구현을 공유합니다.':visualizations==='selected'?`${artifactIds.filter(id=>availableArtifacts.some(artifact=>artifact.id===id)).length}개 선택 · 시각화 파일과 등록 정보를 포함합니다.`:'등록된 시각화 파일과 등록 정보를 포함합니다.'}</small>
   </fieldset>
   <fieldset className="bundle-choices" disabled={busy}><legend>추가 자료</legend>
    <label className="bundle-option"><input type="checkbox" checked={viewer} onChange={e=>setViewer(e.target.checked)}/><span>Image Viewer · 크롭 자료<small>저장된 크롭 그룹, 설명과 Viewer 요청</small></span></label>
    {viewer&&<label className="bundle-option bundle-sub-option"><input type="checkbox" checked={images} onChange={e=>setImages(e.target.checked)}/><span>Viewer 원본 이미지<small>끄면 저장된 크롭은 유지되며, 원본 미리보기와 새 크롭에는 원본 파일이 필요합니다.</small></span></label>}
    <label className="bundle-option"><input type="checkbox" checked={data} onChange={e=>setData(e.target.checked)}/><span>data/ 입력 데이터<small>Workspace의 data/ 폴더를 추가합니다. tmp/와 캐시는 제외합니다.</small></span></label>
    <label className="bundle-option"><input type="checkbox" checked={git} onChange={e=>setGit(e.target.checked)}/><span>Git 이력 · 체크포인트<small>포함하면 이전 구현으로 복원할 수 있습니다. 끄면 현재 구현과 작업 기록만 전달합니다.</small></span></label>
   </fieldset>
   {dirty&&<p role="alert">작성 중인 변경을 저장한 뒤 번들을 내려받으세요.</p>}
   {error&&<div className="bundle-feedback" role="alert"><p>{error}</p><button disabled={busy} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={14}/> 포함 목록 다시 확인</button>{/session token|unauthorized/i.test(error)&&<button onClick={()=>location.reload()}>서버에 다시 연결</button>}</div>}
   {notice&&<p role="status">{notice}</p>}
   {plan?<>
    <div className="bundle-size"><small>저장 파일: {plan.downloadName}</small><strong>{plan.fileCount.toLocaleString()}개 파일 · {size(plan.bytes)}</strong><small>선택한 파일 기준 · ZIP 헤더{git?' 및 Git 이력':''} 용량 별도</small><button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>목록 새로고침</button></div>
    <details><summary>포함 파일 확인</summary><ul className="bundle-files">{plan.files.map(file=><li key={file.path}><code>{file.path}</code><span>{size(file.size)}</span></li>)}</ul></details>
    <details><summary>제외 항목 ({plan.skipped.length})</summary><ul className="bundle-files">{plan.skipped.map(file=><li key={file}><code>{file}</code></li>)}</ul></details>
   </>:!error&&<p role="status">포함 파일과 용량 확인 중…</p>}
   <footer><p>받는 사람은 ‘번들 열기’에서 복원합니다. 에이전트가 파일을 수정 중이면 완료 후 저장하세요.</p><button className="primary" disabled={!plan||busy||dirty} onClick={()=>void download()}><Download size={16}/>{busy?'번들 만드는 중…':'.bundle 저장'}</button></footer>
  </section></div>}
 </>;
}
