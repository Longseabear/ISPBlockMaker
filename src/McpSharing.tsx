import {useEffect,useState} from 'react';
import {Copy,Link,RefreshCw} from 'lucide-react';
import type {Api} from './types';

type Sharing={enabled:boolean;urls?:string[];port?:number;access?:string;source_ids?:string[];image_ids?:string[]};
type Source={id:string;title:string;path:string};
export function McpSharing({api}:{api:Api}){
 const [state,setState]=useState<Sharing|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [sources,setSources]=useState<Source[]>([]),[selected,setSelected]=useState<string[]>([]);
 const [images,setImages]=useState<{id:string;name:string}[]>([]),[selectedImages,setSelectedImages]=useState<string[]>([]);
 useEffect(()=>{let active=true;void Promise.all([api<Sharing>('/mcp/sharing'),api<{sources:Source[];images:{id:string;name:string}[]}>('/mcp/sharing/catalog')]).then(([value,catalog])=>{if(active){setState(value);setSources(catalog.sources);setSelected(value.source_ids||[]);setImages(catalog.images||[]);setSelectedImages(value.image_ids||[]);}}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[api]);
 async function change(action:'start'|'stop'|'rotate'){
  setBusy(true);setError('');setNotice('');
  try{setState(await api<Sharing>(action==='rotate'?'/mcp/sharing/rotate':'/mcp/sharing',action==='start'?{enabled:true,source_ids:selected,image_ids:selectedImages}:{},action==='stop'?'DELETE':'POST'));}
  catch(e){setError(String(e));}finally{setBusy(false);}
 }
 return <aside className="mcp-status mcp-sharing"><strong><Link size={16}/> 워크스페이스 MCP 공유 <span>{state?.enabled?'공유 중':'꺼짐'}</span></strong>
  <p>같은 네트워크에서 이 URL을 MCP 서버로 등록하면 Board 설명과 문서를 검색할 수 있습니다. URL을 가진 사람에게 읽기 권한이 부여됩니다.</p>
  <small>Board 문서는 실시간으로 공유됩니다. 코드와 이미지는 선택한 항목만 포함하며, 대화·실행 권한은 공유하지 않습니다. 재시작이나 작업공간 변경 시 공유가 꺼집니다.</small>
  <details className="mcp-source-options"><summary>이미지 선택 · {selectedImages.length}개</summary><p>선택한 등록 이미지의 미리보기(최대 512px)를 제공합니다. 상대 에이전트가 요청하면 이미지 입력으로 전달되며, 내 뷰어 화면은 조작하지 않습니다.</p><fieldset disabled={busy||!!state?.enabled}>{images.map(image=><label key={image.id}><input type="checkbox" checked={selectedImages.includes(image.id)} onChange={e=>setSelectedImages(ids=>e.target.checked?[...ids,image.id]:ids.filter(id=>id!==image.id))}/><span>{image.name}</span></label>)}{!images.length&&<small>등록된 이미지가 없습니다.</small>}</fieldset></details>
  <details className="mcp-source-options"><summary>소스 파일 선택 · {selected.length}개</summary><p>블록의 구현 경로에 등록된 텍스트 소스입니다. 파일 내용 전체가 공유되며 이후 수정도 반영됩니다.</p><fieldset disabled={busy||!!state?.enabled}>{sources.map(source=><label key={source.id}><input type="checkbox" checked={selected.includes(source.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,source.id]:ids.filter(id=>id!==source.id))}/><span>{source.path}</span></label>)}{!sources.length&&<small>공유 가능한 소스 파일이 없습니다.</small>}</fieldset>{state?.enabled&&<small>선택을 바꾸려면 공유를 중지한 뒤 다시 시작하세요.</small>}</details>
  {state?.enabled&&<div className="mcp-share-links">{state.urls?.map(url=><div key={url}><input readOnly aria-label={url.includes('127.0.0.1')?'이 PC 테스트용 MCP URL':'네트워크 MCP 공유 URL'} value={url}/><button aria-label="MCP URL 복사" onClick={()=>{void navigator.clipboard.writeText(url).then(()=>setNotice('URL을 복사했습니다.')).catch(e=>setError(String(e)));}}><Copy size={16}/></button></div>)}<small>127.0.0.1은 이 PC에서만 사용할 수 있습니다. 다른 PC에는 네트워크 주소를 전달하세요. 연결 가능 여부는 방화벽 설정에 따라 달라집니다.</small></div>}
  <div className="work-controls">{state?.enabled?<><button disabled={busy} onClick={()=>void change('stop')}>공유 중지</button><button disabled={busy} onClick={()=>void change('rotate')}><RefreshCw size={16}/> URL 재발급</button></>:<button disabled={busy||!state} onClick={()=>void change('start')}>읽기 전용 공유 시작</button>}</div>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </aside>;
}
