import {useEffect, useRef, useState} from 'react';
import {ChevronDown, Download, Eye, FileJson, Save, Trash2, X} from 'lucide-react';
import type {Api} from './types';

export type ROI = {x:number;y:number;width:number;height:number};
export type CropPurpose = 'analysis'|'white_balance'|'input';
export type CropRegion = {roi:ROI;paths:{crop:string;preview:string;metadata:string};output:{cfaOrigin?:{x:number;y:number}}};
export type CropResult = CropRegion & {regions?:CropRegion[];id?:string;description?:string;purpose?:CropPurpose};
export const purposeLabels:Record<CropPurpose,string> = {analysis:'영역 분석',white_balance:'화이트밸런스 계산',input:'입력 데이터 만들기'};
export function cropRegions(crop:CropResult) {return crop.regions||[crop];}
export function roiLabel(roi:ROI) {return `(${roi.x}, ${roi.y}) · ${roi.width} × ${roi.height}`;}

/** Render a bounded thumbnail from the already loaded preview, never from RAW bytes. */
export function RegionThumbnail({roi,bitmap,area}:{roi:ROI;bitmap:HTMLImageElement|null;area?:ROI}) {
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{const ctx=ref.current?.getContext('2d');if(!ctx)return;ctx.clearRect(0,0,64,44);if(!bitmap||!area)return;
  const x=Math.max(roi.x,area.x),y=Math.max(roi.y,area.y),right=Math.min(roi.x+roi.width,area.x+area.width),bottom=Math.min(roi.y+roi.height,area.y+area.height);if(right<=x||bottom<=y)return;
  const sx=(x-area.x)/area.width*bitmap.width,sy=(y-area.y)/area.height*bitmap.height,sw=(right-x)/area.width*bitmap.width,sh=(bottom-y)/area.height*bitmap.height;
  const scale=Math.min(64/sw,44/sh);ctx.imageSmoothingEnabled=false;ctx.drawImage(bitmap,sx,sy,sw,sh,(64-sw*scale)/2,(44-sh*scale)/2,sw*scale,sh*scale);
 },[bitmap,area,roi]);
 return <canvas ref={ref} width={64} height={44} aria-hidden="true"/>;
}

export function SavedCropThumbnail({requestId,crop,token}:{requestId:string;crop:CropResult;token:string}) {
 const [url,setUrl]=useState('');
 useEffect(()=>{const abort=new AbortController();let local='';setUrl('');
  void fetch(`/api/viewer/requests/${encodeURIComponent(requestId)}/files/preview${crop.id?`?cropId=${encodeURIComponent(crop.id)}`:''}`,{headers:{Authorization:`Bearer ${token}`},signal:abort.signal}).then(async response=>{
   if(!response.ok)throw new Error('Preview unavailable');const blob=await response.blob();if(abort.signal.aborted)return;local=URL.createObjectURL(blob);setUrl(local);
  }).catch(()=>{});return()=>{abort.abort();if(local)URL.revokeObjectURL(local);};
 },[requestId,crop.id,token]);
 return url?<img src={url} alt=""/>:<span className="crop-thumbnail-placeholder" aria-hidden="true"/>;
}

export function CropCard({crop,requestId,index,api,token,onSaved,onInspect,onDownload,chosen,onChoose}:{chosen:boolean;onChoose:(shift:boolean,toggle:boolean)=>void;crop:CropResult;requestId:string;index:number;api:Api;token:string;onSaved:()=>Promise<void>;onInspect:()=>void;onDownload:(kind:string)=>void}) {
 const [text,setText]=useState(crop.description||''),[saving,setSaving]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState(false);
 const base=useRef(crop.description||''),inFlight=useRef(false);
 useEffect(()=>{if(text===base.current){setText(crop.description||'');base.current=crop.description||'';}},[crop.description]);
 async function save(){if(inFlight.current||text===base.current)return;inFlight.current=true;setSaving(true);setError('');const next=text;try{await api(`/viewer/requests/${requestId}/crops/${crop.id||requestId}`,{description:next,previousDescription:base.current},'PATCH');base.current=next;await onSaved();}catch(e){setError(String(e));}finally{inFlight.current=false;setSaving(false);}}
 async function remove(){if(inFlight.current)return;inFlight.current=true;setSaving(true);setError('');try{const result=await api<{cleanupPending:string[]}>(`/viewer/requests/${requestId}/crops/${crop.id||requestId}`,{},'DELETE');await onSaved();if(result.cleanupPending.length)throw new Error('목록에서 제거됐지만 일부 파일 정리가 실패했습니다.');}catch(e){setError(String(e));}finally{inFlight.current=false;setSaving(false);}}
 return <article className={`viewer-crop-card viewer-crop-card-compact ${chosen?'crop-chosen':''}`}>
  <div className="viewer-crop-heading">
   <input type="checkbox" aria-label={`크롭 ${index+1} 전달 선택`} checked={chosen} onChange={()=>onChoose(false,true)}/>
   <button className="crop-card-label" onClick={e=>onChoose(e.shiftKey,false)} title="전달할 크롭 선택 · Shift+클릭으로 범위 선택"><strong>크롭 {index+1}</strong><small>{cropRegions(crop).length}개 영역 · {purposeLabels[crop.purpose||'analysis']}</small></button>
   <button className="viewer-icon-button" title="저장된 영역 확인" aria-label={`크롭 ${index+1} 영역 확인`} onClick={onInspect}><Eye size={15}/></button>
   <button className="viewer-icon-button" title="설명과 좌표 편집" aria-label={`크롭 ${index+1} 상세`} aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><ChevronDown size={15}/></button>
  </div>
  {!expanded&&<div className="crop-card-summary"><SavedCropThumbnail requestId={requestId} crop={crop} token={token}/><span>{crop.description||roiLabel(crop.roi)}</span></div>}
  {expanded&&<><div className="crop-region-coordinates">{cropRegions(crop).map((region,i)=><code key={i}>{i+1}. {roiLabel(region.roi)}</code>)}</div><textarea aria-label={`크롭 ${index+1} 설명`} placeholder="이 영역에 대한 설명…" rows={2} maxLength={12000} value={text} onChange={e=>{setText(e.target.value);setError('');}}/><small>{saving?'저장 중…':text===base.current?'설명 저장됨':'저장하지 않은 설명'}</small><div className="viewer-card-actions"><button className="viewer-icon-button" title="설명 저장" aria-label={`크롭 ${index+1} 설명 저장`} disabled={saving||text===base.current} onClick={()=>void save()}><Save size={16}/></button><button className="viewer-icon-button" title={crop.regions?'전체 영역 ZIP 다운로드':'크롭 파일 다운로드'} aria-label={`크롭 ${index+1} 파일 다운로드`} onClick={()=>onDownload('crop')}><Download size={16}/></button><button className="viewer-icon-button" title="좌표 / 설명 다운로드" aria-label={`크롭 ${index+1} 메타데이터 다운로드`} onClick={()=>onDownload('metadata')}><FileJson size={16}/></button><button className="viewer-icon-button viewer-remove" title="크롭 제거" disabled={saving} aria-label={`크롭 ${index+1} 제거`} onClick={()=>void remove()}><Trash2 size={16}/></button></div></>}
  {error&&<p role="alert">{error}</p>}
 </article>;
}

export function DraftRegions({regions,bitmap,area,onRemove}:{regions:ROI[];bitmap:HTMLImageElement|null;area?:ROI;onRemove:(index:number)=>void}) {
 return <div className="crop-draft-regions" aria-label="아직 저장하지 않은 크롭 영역">{regions.map((region,index)=><div className="crop-draft-region" key={index} title={`영역 ${index+1} · ${roiLabel(region)}`}><RegionThumbnail roi={region} bitmap={bitmap} area={area}/><span>{index+1}</span><button aria-label={`선택 영역 ${index+1} 제거`} title={`선택 영역 ${index+1} 제거`} onClick={()=>onRemove(index)}><X size={12}/></button><small>{roiLabel(region)}</small></div>)}</div>;
}
