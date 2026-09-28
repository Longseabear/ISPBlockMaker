import {useEffect,useState} from 'react';
import {FolderOpen,X,RefreshCw} from 'lucide-react';
import {WorkspacePicker} from './WorkspacePicker';
import type {Api} from './types';
import './bundle-exchange.css';

type Restored={id:string;workspace:string;name:string;includeImages:boolean;backupPath?:string};
type ImportPreview={token:string;name:string;sourceRoot:string;fileCount:number;bytes:number;includeImages:boolean;includeViewer:boolean;includeVisualizations:boolean;artifactCount:number;hasGit:boolean};
type DestinationPreview={destination:string;snapshot:string;exists:boolean;name?:string;backupRequired:boolean;backupPath?:string;serverRunning?:boolean;currentWorkspace?:boolean};
type ImportMode='new'|'overwrite';
type BackupNotice={workspace:string;backupPath:string;name:string;time:number};
const folderName=(value:string)=>value.replace(/\.bundle$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim().replace(/[. ]+$/g,'')||'imported-project';
const parentPath=(value:string)=>value.replace(/[\\/]+$/,'').replace(/[\\/][^\\/]+$/,'');
const joinPath=(parent:string,name:string)=>parent.replace(/[\\/]$/,'')+'/'+name;
const size=(bytes:number)=>bytes<1024*1024?`${(bytes/1024).toFixed(1)} KiB`:`${(bytes/1024/1024).toFixed(1)} MiB`;
function savedBackup():BackupNotice|null{
 try{
  const prefix='#isp-bundle-restore=',fragment=location.hash.startsWith(prefix)?location.hash.slice(prefix.length):'';
  const value=JSON.parse(fragment&&fragment.length<16000?decodeURIComponent(fragment):sessionStorage.getItem('isp-last-bundle-backup')||'null') as BackupNotice|null;
  if(fragment)history.replaceState(history.state,'',location.pathname+location.search);
  const valid=value&&typeof value.workspace==='string'&&value.workspace.length<4096&&typeof value.backupPath==='string'&&value.backupPath.length<4096&&typeof value.name==='string'&&typeof value.time==='number'&&Math.abs(Date.now()-value.time)<24*60*60*1000;
  if(!valid)return null;
  try{sessionStorage.setItem('isp-last-bundle-backup',JSON.stringify(value));}catch{}
  return value;
 }catch{return null;}
}

export function BundleOpen({api,token,current,dirty}:{api:Api;token:string;current:string;dirty:boolean}){
 const [open,setOpen]=useState(false),[file,setFile]=useState<File|null>(null),[destination,setDestination]=useState(''),[mode,setMode]=useState<ImportMode>('new'),[picker,setPicker]=useState(false);
 const [busy,setBusy]=useState(false),[phase,setPhase]=useState(''),[error,setError]=useState(''),[preview,setPreview]=useState<ImportPreview|null>(null),[restored,setRestored]=useState<Restored|null>(null);
 const [targetCheck,setTargetCheck]=useState<{key:string;value:DestinationPreview}|null>(null),[checkingTarget,setCheckingTarget]=useState(false),[targetError,setTargetError]=useState(''),[confirmed,setConfirmed]=useState(false),[refresh,setRefresh]=useState(0);
 const [backupNotice,setBackupNotice]=useState<BackupNotice|null>(savedBackup);
 const targetKey=JSON.stringify([preview?.token,destination,mode]),target=targetCheck?.key===targetKey?targetCheck.value:null;
 useEffect(()=>()=>{if(preview?.token)void fetch(`/api/bundle/import/preview/${encodeURIComponent(preview.token)}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}}).catch(()=>{});},[preview?.token]);
 useEffect(()=>{
  setTargetCheck(null);setTargetError('');setConfirmed(false);
  if(!open||!preview||!destination.trim()||restored){setCheckingTarget(false);return;}
  let alive=true;setCheckingTarget(true);
  const timer=setTimeout(()=>{
   api<DestinationPreview>('/bundle/import/destination',{token:preview.token,destination:destination.trim(),mode}).then(result=>{if(alive)setTargetCheck({key:targetKey,value:result});}).catch(e=>{if(alive)setTargetError(String(e));}).finally(()=>{if(alive)setCheckingTarget(false);});
  },350);
  return()=>{alive=false;clearTimeout(timer);};
 },[api,open,preview,destination,mode,restored,targetKey,refresh]);

 async function inspect(selected:File){
  setFile(selected);setPreview(null);setRestored(null);setError('');setConfirmed(false);setTargetCheck(null);setBusy(true);setPhase('번들 업로드 · 내용 확인 중…');
  try{
   if(selected.size>2*1024*1024*1024+8*1024*1024)throw new Error('번들은 최대 2 GiB입니다.');
   const response=await fetch('/api/bundle/import/preview',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},body:selected});
   if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||`번들 확인 실패 (${response.status})`);}
   const result=await response.json() as ImportPreview;
   setPreview(result);if(mode==='new')setDestination(joinPath(parentPath(current),folderName(result.name||selected.name)+'-import'));
  }catch(e){setError(String(e));}finally{setBusy(false);setPhase('');}
 }
 function chooseMode(next:ImportMode){
  setMode(next);setConfirmed(false);setError('');
  setDestination(next==='overwrite'?current:joinPath(parentPath(current),folderName(preview?.name||file?.name||'imported-project')+'-import'));
 }
 async function restore(){
  if(busy||dirty)return;
  if(!restored&&(!preview||!target||(mode==='overwrite'&&!confirmed)))return;
  setBusy(true);setError('');
  try{
   let result=restored;
   if(!result&&preview&&target){
    setPhase(mode==='overwrite'?'기존 작업 백업 · 번들 복원 중…':'번들 복원 중…');
    result=await api<Restored>('/bundle/import/confirm',{token:preview.token,destination:target.destination,mode,destinationSnapshot:target.snapshot});
    setRestored(result);
   }
   if(!result)throw new Error('복원된 프로젝트를 찾지 못했습니다.');
   setPhase('복원된 프로젝트 서버 시작 중…');
   let url:string;
   if(target?.currentWorkspace&&mode==='overwrite'||restored?.workspace===current){
    const bootstrap=await fetch('/api/bootstrap');
    if(!bootstrap.ok)throw new Error('서버 연결을 갱신하지 못했습니다. 복원된 폴더는 유지됩니다.');
    const session=await bootstrap.json() as {token:string};
    const response=await fetch('/api/bundle/open',{method:'POST',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({id:result.id})});
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'복원된 프로젝트 서버를 열지 못했습니다.');}
    url=(await response.json() as {url:string}).url;
   }else({url}=await api<{url:string}>('/bundle/open',{id:result.id}));
   const next=new URL(url);if(next.protocol!=='http:'||next.hostname!=='127.0.0.1')throw new Error('잘못된 로컬 서버 주소');
   if(result.backupPath){
    const notice={workspace:result.workspace,backupPath:result.backupPath,name:result.name,time:Date.now()};
    try{sessionStorage.setItem('isp-last-bundle-backup',JSON.stringify(notice));}catch{}
    if(next.origin!==location.origin)next.hash='isp-bundle-restore='+encodeURIComponent(JSON.stringify(notice));
   }
   location.assign(next.href);
  }catch(e){setError(String(e));if(!restored)setTargetCheck(null);}finally{setBusy(false);setPhase('');}
 }
 return <>
  <button className="bundle-share-button" aria-label="번들 열기" title=".bundle 파일에서 프로젝트 복원" onClick={()=>{setDestination(current+'-import');setMode('new');setFile(null);setPreview(null);setRestored(null);setError('');setConfirmed(false);setOpen(true);}}><FolderOpen size={15}/><span>번들 열기</span></button>
  {backupNotice&&backupNotice.workspace.replace(/\\/g,'/').toLowerCase()===current.replace(/\\/g,'/').toLowerCase()&&<div className="bundle-backup-notice" role="status"><button aria-label="번들 복원 알림 닫기" onClick={()=>{setBackupNotice(null);try{sessionStorage.removeItem('isp-last-bundle-backup');}catch{}}}><X size={15}/></button><strong>{backupNotice.name} · 번들 복원 완료</strong><p>이전 작업 폴더는 아래 위치에 보존했습니다.</p><code>{backupNotice.backupPath}</code></div>}
  {open&&<div className="workspace-picker-backdrop"><section className="bundle-dialog bundle-exchange-dialog" role="dialog" aria-modal="true" aria-label="번들 열기" onKeyDown={e=>{if(e.key==='Escape'&&!busy&&!picker){setOpen(false);setPreview(null);}}}>
   <header><div><h2>번들 열기</h2><p>번들 내용을 확인하고 새 폴더 또는 기존 작업 폴더에 복원합니다.</p></div><button autoFocus disabled={busy} aria-label="번들 열기 닫기" onClick={()=>{setOpen(false);setPreview(null);}}><X size={18}/></button></header>
   <label className="bundle-field">번들 파일<input aria-label="번들 파일" type="file" accept=".bundle" disabled={busy||!!restored} onChange={e=>{const selected=e.target.files?.[0];if(selected)void inspect(selected);else{setFile(null);setPreview(null);setError('');}}}/></label>
   {busy&&!preview&&<p role="status">{phase}</p>}
   {preview&&<div className="bundle-import-summary"><strong>{preview.name}</strong><dl>
    <dt>구현</dt><dd>{preview.sourceRoot==='project'?'project/':'이전 workspace 형식 · 복원 시 변환'}</dd>
    <dt>포함 파일</dt><dd>{preview.fileCount.toLocaleString()}개 · {size(preview.bytes)}</dd>
    <dt>Visualizations</dt><dd>{preview.artifactCount}개</dd>
    <dt>Image Viewer</dt><dd>{preview.includeViewer?(preview.includeImages?'크롭 자료 + 원본 이미지':'크롭 자료 · 원본 제외'):'제외'}</dd>
    <dt>Git · 체크포인트</dt><dd>{preview.hasGit?'이력 포함':'현재 구현만 포함'}</dd>
   </dl></div>}
   {preview&&!restored&&<>
    <fieldset className="bundle-choices" disabled={busy}><legend>복원 위치</legend><div className="bundle-choice-row">
     <label className={mode==='new'?'active':''}><input type="radio" name="bundle-import-mode" checked={mode==='new'} onChange={()=>chooseMode('new')}/>새 폴더 만들기</label>
     <label className={mode==='overwrite'?'active':''}><input type="radio" name="bundle-import-mode" checked={mode==='overwrite'} onChange={()=>chooseMode('overwrite')}/>기존 작업 폴더에 덮어쓰기</label>
    </div>
    <div className="bundle-destination-controls"><label className="bundle-field">{mode==='new'?'만들 폴더 경로':'덮어쓸 작업 폴더'}<input aria-label={mode==='new'?'복원할 새 폴더':'덮어쓸 작업 폴더'} value={destination} onChange={e=>{setDestination(e.target.value);setConfirmed(false);setError('');}}/></label><button onClick={()=>setPicker(true)}><FolderOpen size={15}/>{mode==='new'?'부모 폴더 선택':'작업 폴더 선택'}</button></div>
    <small>{mode==='new'?'마지막 폴더 이름은 새 이름이어야 합니다. 복원 후 해당 프로젝트 화면으로 이동합니다.':'기존 폴더 전체를 옆 폴더에 백업한 뒤 번들 내용으로 교체합니다. 데이터·미추적 파일도 백업에 보존됩니다.'}</small>
    </fieldset>
    {checkingTarget&&<p role="status">복원 위치 확인 중…</p>}
    {targetError&&<div className="bundle-feedback" role="alert"><p>{targetError}</p><button disabled={busy} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={14}/> 위치 다시 확인</button>{file&&/expired|만료/i.test(targetError)&&<button disabled={busy} onClick={()=>void inspect(file)}>선택한 번들 다시 확인</button>}</div>}
    {mode==='overwrite'&&target&&<div className="bundle-overwrite-confirm">
     <p>대상: <strong>{target.name||target.destination}</strong>{target.serverRunning&&' · 실행 중인 서버'}<br/>백업 위치:</p><code>{target.backupPath||'기존 작업 폴더 옆에 별도 백업 폴더를 만듭니다.'}</code>
     <label className="bundle-option"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>기존 작업 폴더를 백업하고 번들로 교체합니다.{target.serverRunning&&' 해당 서버의 터미널 작업도 종료합니다.'}</span></label>
    </div>}
   </>}
   {dirty&&<p role="alert">현재 작성 중인 변경을 저장한 뒤 번들을 여세요.</p>}
   {restored&&<div className="bundle-restored" role="status"><p>복원 완료: {restored.name}</p><code>{restored.workspace}</code>{restored.backupPath&&<><p>이전 작업 폴더 백업:</p><code>{restored.backupPath}</code></>}<p>서버 열기에 실패해도 복원된 파일은 유지됩니다.</p></div>}
   {error&&<div className="bundle-feedback" role="alert"><p>{error}</p>{file&&!restored&&<button disabled={busy} onClick={()=>void inspect(file)}><RefreshCw size={14}/> 선택한 번들 다시 확인</button>}{preview&&!restored&&<button disabled={busy} onClick={()=>setRefresh(value=>value+1)}>복원 위치 다시 확인</button>}{/session token|unauthorized/i.test(error)&&<button onClick={()=>location.reload()}>서버에 다시 연결</button>}</div>}
   <footer><p>{restored?<code>isp-block-maker "{restored.workspace}"</code>:'Python 패키지와 번들에서 제외한 외부 데이터는 별도로 준비하세요.'}</p><button className="primary" disabled={busy||dirty||(!restored&&(!preview||!target||(mode==='overwrite'&&!confirmed)))} onClick={()=>void restore()}>{busy?phase:restored?'프로젝트 열기 다시 시도':mode==='overwrite'?'백업 후 덮어쓰고 열기':'새 폴더에 복원하고 열기'}</button></footer>
  </section></div>}
  {picker&&<WorkspacePicker api={api} current={current} title={mode==='new'?'복원할 부모 폴더 선택':'덮어쓸 작업 폴더 선택'} hint={mode==='new'?'선택한 폴더 아래에 새 프로젝트 폴더를 만듭니다.':'기존 ISP 작업 폴더를 선택하세요. 복원 전에 내용을 확인하고 백업합니다.'} onClose={()=>setPicker(false)} onPick={selected=>{setDestination(mode==='new'?joinPath(selected,folderName(preview?.name||file?.name||'imported-project')+'-import'):selected);setConfirmed(false);setPicker(false);}}/>}
 </>;
}
