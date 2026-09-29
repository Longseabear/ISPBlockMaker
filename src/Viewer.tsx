import {useEffect,useRef,useState,type CSSProperties} from "react";
import {zoomAround,visibleSource} from "./viewer-camera";
import {flushSync} from "react-dom";
import {X, Info, Send, Hash, FileImage, Grid2X2, Crop, Pin, PinOff, SlidersHorizontal, Maximize2, Minimize2, Scan, Minus, Plus, RefreshCw, Trash2} from "lucide-react";
import {alignCfaRoi} from "../server/cfa-roi.mjs";
import type {Api} from "./types";
import {CropCard,DraftRegions,SavedCropThumbnail,cropRegions,purposeLabels,type CropPurpose,type CropResult} from './ViewerCrops';
import {NativeImage} from './NativeImage';
import {PixelValues} from './PixelValues';
import './viewer-crops.css';

type Spec={format:"raw"|"bmp"|"rgba8";width:number;height:number;bitDepth:number;alignment:"lsb"|"msb";pattern:string;group:number;offset:number;stride:number;originX?:number;originY?:number};
type ImageRecord={id:string;name:string;spec:Spec};
type ROI={x:number;y:number;width:number;height:number};
type Highlight=ROI&{label:string};
type Render={mode:string;gamma:number;black:number;white:number};
type ViewState={imageId:string;render:Render;zoom:number;sourceScale:{x:number;y:number};rendering:'overview'|'native-webgl2';area:ROI;visible:ROI;highlights:Highlight[];pixelValues:boolean;selection?:ROI;selections?:ROI[]};
type ViewCommand={status?:string;id:string;imageId:string;zoom?:number;zoomPercent?:number;pixelValues?:boolean;pixels?:Partial<Spec>;center?:{x:number;y:number};fit?:boolean;render?:Render;highlights?:Highlight[];message:string};
type CropRequest={origin?:"agent"|"user";delivery?:{id:string};id:string;imageId:string;prompt:string;status:string;purpose?:CropPurpose;result?:CropResult;crops?:CropResult[]};
type CropDelivery={id:string;imageId:string;sentAt:string;status:string;items:{requestId:string;cropId:string}[]};
type State={images:ImageRecord[];requests:CropRequest[]};
const initial:Spec={format:"raw",width:4000,height:3000,bitDepth:12,alignment:"lsb",pattern:"GRBG",group:1,offset:0,stride:0};

const pixelPreferenceKey='isp-viewer-raw-pixels-v1';
function initialSpec():Spec {
 try {
  const saved=JSON.parse(localStorage.getItem(pixelPreferenceKey)||'{}');
  return {...initial,
   pattern:['GRBG','RGGB','GBRG','BGGR'].includes(saved?.pattern)?saved.pattern:initial.pattern,
   bitDepth:Number.isInteger(saved?.bitDepth)&&saved.bitDepth>=8&&saved.bitDepth<=16?saved.bitDepth:initial.bitDepth,
   group:[1,2,4].includes(saved?.group)?saved.group:initial.group,
   alignment:['lsb','msb'].includes(saved?.alignment)?saved.alignment:initial.alignment};
 } catch {return {...initial};}
}

export function Viewer({api,token,requestId,commandId,visible,expanded,onExpand}:{api:Api;token:string;requestId:string;commandId:string;visible:boolean;expanded:boolean;onExpand:()=>void}){
 const visibleRef=useRef(visible);visibleRef.current=visible;
 const [state,setState]=useState<State>({images:[],requests:[]}),[imageId,setImageId]=useState(""),[selected,setSelected]=useState(requestId);
 const [spec,setSpec]=useState(initialSpec),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [pixelPreferenceError,setPixelPreferenceError]=useState('');
 useEffect(()=>{try{localStorage.setItem(pixelPreferenceKey,JSON.stringify({pattern:spec.pattern,bitDepth:spec.bitDepth,group:spec.group,alignment:spec.alignment}));setPixelPreferenceError('');}catch{setPixelPreferenceError('브라우저 저장소를 사용할 수 없어 이번 화면에서만 유지됩니다.');}},[spec.pattern,spec.bitDepth,spec.group,spec.alignment]);
 const [roi,setRoi]=useState<ROI>({x:0,y:0,width:1,height:1}),[mode,setMode]=useState("color"),[zoom,setZoom]=useState(1);
 const [extraRois,setExtraRois]=useState<ROI[]>([]);
 const [offset,setOffset]=useState({x:0,y:0});
 const stateEpoch=useRef(0),receiptEpoch=useRef(0);
 const captureBusy=useRef(false),roiEdited=useRef(false),captureRequest=useRef<CropRequest|null>(null);
 const [chosenCrops,setChosenCrops]=useState<string[]>([]),[sendingCrops,setSendingCrops]=useState(false),[sentCrops,setSentCrops]=useState<{id:string;sentAt:string;count:number;status:string}|null>(null);
 const [batchDescription,setBatchDescription]=useState('');
 const [cropPurpose,setCropPurpose]=useState<CropPurpose>('analysis'),[historyOpen,setHistoryOpen]=useState(false),[inspection,setInspection]=useState<CropResult|null>(null);
 const [clearingHistory,setClearingHistory]=useState(false),historyDeleting=useRef(false);
 const [pixelValues,setPixelValues]=useState(()=>{try{return localStorage.getItem('isp-viewer-pixel-values')!=='false';}catch{return true;}});
 useEffect(()=>{try{localStorage.setItem('isp-viewer-pixel-values',String(pixelValues));}catch{}},[pixelValues]);
 const cropAnchor=useRef<string|null>(null);
 const [gamma,setGamma]=useState(2.2);
 const [nativeReady,setNativeReady]=useState(true);
 const [cursor,setCursor]=useState<{x:number;y:number}|null>(null);
 const [levels,setLevels]=useState({black:0,white:4095}),[displayLevels,setDisplayLevels]=useState(levels);
 const [preview,setPreview]=useState<{width:number;height:number;area:ROI;url:string;key:string}|null>(null);
 const [highlights,setHighlights]=useState<Highlight[]>([]),[liveStatus,setLiveStatus]=useState('화면 준비 중');
 const [sideWidth,setSideWidth]=useState(()=>{try{return Math.max(180,Math.min(600,Number(localStorage.getItem('isp-viewer-side-width'))||260));}catch{return 260;}});
 const [sideOpen,setSideOpen]=useState(false);
 const [sidePinned,setSidePinned]=useState(()=>{try{return localStorage.getItem('isp-viewer-crops-pinned')==='true';}catch{return false;}});
 useEffect(()=>{try{localStorage.setItem('isp-viewer-crops-pinned',String(sidePinned));}catch{}},[sidePinned]);
 const sideDrag=useRef<{x:number;width:number}|null>(null);
 useEffect(()=>{try{localStorage.setItem('isp-viewer-side-width',String(sideWidth));}catch{}},[sideWidth]);
 const [command,setCommand]=useState<ViewCommand|null>(null),[loadedKey,setLoadedKey]=useState(''),[showSelection,setShowSelection]=useState(false);
 const sessionId=useRef(crypto.randomUUID()),appliedCommand=useRef(''),liveView=useRef<()=>ViewState|null>(()=>null);
 const pan=useRef<{x:number;y:number;left:number;top:number}|null>(null);
 const canvas=useRef<HTMLCanvasElement>(null),viewport=useRef<HTMLDivElement>(null),start=useRef<{x:number;y:number;clientX:number;clientY:number;additive:boolean;staged:boolean}|null>(null),bitmap=useRef<HTMLImageElement|null>(null);
 const redraw=useRef(()=>{});redraw.current=draw;
 const request=state.requests.find(r=>r.id===selected),image=state.images.find(i=>i.id===(request?.imageId||imageId));
 const currentImageId=useRef(image?.id);currentImageId.current=image?.id;
 const active=request?.status!=="cancelled";
 const expectedKey=JSON.stringify([image?.id,mode,gamma,displayLevels.black,displayLevels.white]);
 const cropItems=state.requests.filter(r=>r.imageId===image?.id).flatMap(r=>(r.crops||(r.result?[r.result]:[])).map(crop=>({crop,requestId:r.id})));
 const cropKey=(item:typeof cropItems[number])=>`${item.requestId}:${item.crop.id||item.requestId}`;
 const chosenItems=cropItems.filter(item=>chosenCrops.includes(cropKey(item)));
 const historyItems=cropItems.filter(item=>!chosenCrops.includes(cropKey(item)));
 const draftRegions=showSelection?[...extraRois,roi]:[];
 const chosenRegionCount=chosenItems.reduce((total,item)=>total+cropRegions(item.crop).length,0);
 const contextKey=`${image?.id||''}:${selected}`;
 const contextRef=useRef(contextKey);contextRef.current=contextKey;
 useEffect(()=>{setChosenCrops([]);setSentCrops(null);setBatchDescription('');setHistoryOpen(false);setInspection(null);clearSelection();captureRequest.current=null;cropAnchor.current=null;
   const epoch=++receiptEpoch.current;let alive=true;
   if(image?.id)void api<CropDelivery|null>('/viewer/crop-selection').then(receipt=>{if(alive&&epoch===receiptEpoch.current&&receipt?.imageId===image.id)setSentCrops({id:receipt.id,sentAt:receipt.sentAt,status:receipt.status||'pending',count:receipt.items.length});}).catch(()=>{});
   return()=>{alive=false;};
 },[api,contextKey]);
 useEffect(()=>{setChosenCrops(old=>old.filter(key=>cropItems.some(item=>cropKey(item)===key)));},[state.requests,image?.id]);
 useEffect(()=>{if(!sentCrops||sentCrops.status!=='pending')return;let alive=true;const timer=setInterval(()=>{void api<{id:string;status:string}|null>('/viewer/crop-selection').then(receipt=>{if(!alive)return;if(receipt?.id===sentCrops.id&&receipt.status==='consumed')setSentCrops(previous=>previous?.id===sentCrops.id?{...previous,status:'consumed'}:previous);else if(receipt?.id!==sentCrops.id)setSentCrops(previous=>previous?.id===sentCrops.id?{...previous,status:'superseded'}:previous);}).catch(()=>{});},2500);return()=>{alive=false;clearInterval(timer);};},[api,sentCrops?.id,sentCrops?.status]);
 function chooseCrop(index:number,shift:boolean,toggle:boolean){const key=cropKey(cropItems[index]);
   const anchor=cropItems.findIndex(item=>cropKey(item)===cropAnchor.current);
   if(shift&&anchor>=0){const range=cropItems.slice(Math.min(anchor,index),Math.max(anchor,index)+1).map(cropKey);setChosenCrops(old=>[...new Set([...old,...range])]);}
   else {setChosenCrops(old=>toggle?(old.includes(key)?old.filter(k=>k!==key):[...old,key]):[key]);cropAnchor.current=key;}
 }
 async function sendCrops(){if(sendingCrops||!image||!chosenItems.length||showSelection)return;const context=contextKey,count=chosenItems.length;receiptEpoch.current++;setSendingCrops(true);setError('');try{
   const receipt=await api<{id:string;sentAt:string;status:string}>('/viewer/crop-selection',{imageId:image.id,description:batchDescription,purpose:cropPurpose,items:chosenItems.map(i=>({requestId:i.requestId,cropId:i.crop.id||i.requestId}))});
   if(contextRef.current===context){setSentCrops({...receipt,count});setChosenCrops([]);setBatchDescription('');setInspection(null);cropAnchor.current=null;}
   await refresh();
 }catch(e){if(contextRef.current===context)setError(String(e));}finally{setSendingCrops(false);}}

 function fitPreview(){if(preview&&viewport.current){const v=viewport.current,z=Math.min(v.clientWidth/preview.width,v.clientHeight/preview.height);setZoom(z);setOffset({x:(v.clientWidth-preview.width*z)/2,y:(v.clientHeight-preview.height*z)/2});}}
 function zoomCenter(next:number){const v=viewport.current;if(!v)return;setOffset(zoomAround(offset,zoom,next,{x:v.clientWidth/2,y:v.clientHeight/2}));setZoom(next);}
 useEffect(()=>{
   const v=viewport.current,c=canvas.current;if(!v||!c||!preview)return;
   const wheel=(event:WheelEvent)=>{
     if(!event.deltaY||(event.target as HTMLElement).closest(".viewer-info-float,.viewer-selection-float"))return;
     event.preventDefault();
     if(event.buttons)return;
     // Pointer release can be missed when a preview is replaced during a drag.
     start.current=null;pan.current=null;
     const bounds=c.getBoundingClientRect(),frame=v.getBoundingClientRect();
     const oldZoom=bounds.width/preview.width;if(!oldZoom)return;
     const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?v.clientHeight:1);
     const nextZoom=Math.max(.1,Math.min(512,oldZoom*Math.exp(-Math.max(-300,Math.min(300,delta))*.002)));
     if(nextZoom===oldZoom)return;
     const x=(event.clientX-bounds.left)/oldZoom;
     const y=(event.clientY-bounds.top)/oldZoom;
     const pointerX=event.clientX-frame.left-v.clientLeft,pointerY=event.clientY-frame.top-v.clientTop;
     flushSync(()=>{setZoom(nextZoom);setOffset({x:pointerX-x*nextZoom,y:pointerY-y*nextZoom});});
   };
   // React wheel handlers are passive; prevent page scrolling with a native listener.
   v.addEventListener('wheel',wheel,{passive:false,capture:true});
   const reset=()=>{start.current=null;pan.current=null;};
   window.addEventListener('blur',reset);
   return()=>{v.removeEventListener('wheel',wheel,true);window.removeEventListener('blur',reset);reset();};
 },[preview]);
 async function refresh(){const epoch=++stateEpoch.current,next=await api<State>("/viewer");if(epoch===stateEpoch.current)setState(next);}
 async function clearCropHistory(){
   if(busy||sendingCrops||historyDeleting.current||!historyItems.length)return;
   const items=[...historyItems];
   if(!window.confirm(`현재 이미지의 이전 크롭 ${items.length}개와 해당 크롭 파일·설명을 삭제할까요?\n원본 이미지와 이번 전달에 선택한 크롭은 유지됩니다.`))return;
   historyDeleting.current=true;setClearingHistory(true);setBusy(true);setError('');stateEpoch.current++;
   let removed=0,cleanupPending=0;
   try{
     for(const item of items){
       const updated=await api<CropRequest&{cleanupPending:string[]}>(`/viewer/requests/${item.requestId}/crops/${item.crop.id||item.requestId}`,{},'DELETE');
       removed++;cleanupPending+=updated.cleanupPending.length;stateEpoch.current++;
       setState(current=>({...current,requests:current.requests.map(r=>r.id===updated.id?updated:r)}));
       setInspection(current=>current===item.crop?null:current);
     }
     if(cleanupPending)setError(`이전 크롭은 비웠지만 ${cleanupPending}개 파일을 정리하지 못했습니다.`);
   }catch(e){setError(`${removed}/${items.length}개 삭제됨. 남은 크롭을 확인하고 다시 시도하세요. ${String(e)}`);}
   finally{try{await refresh();}catch(e){setError(`크롭 목록을 새로 읽지 못했습니다. ${String(e)}`);}historyDeleting.current=false;setClearingHistory(false);setBusy(false);}
 }
 useEffect(()=>{if(!visible)return;let alive=true;const load=()=>{const epoch=stateEpoch.current;return api<State>("/viewer").then(s=>{if(alive&&epoch===stateEpoch.current&&!captureBusy.current)setState(s);}).catch(e=>{if(alive)setError(String(e));});};void load();const timer=setInterval(load,2500);return()=>{alive=false;clearInterval(timer);};},[api,visible]);
 // Camera presentations carry an empty requestId. Only an explicit request/image
 // switch starts a new crop context; a same-image agent camera move preserves it.
 useEffect(()=>{if(requestId||!commandId)setSelected(requestId);},[requestId,commandId]);
 useEffect(()=>{setCropPurpose(request?.purpose||'analysis');},[selected,request?.purpose]);
 useEffect(()=>{
   if(!image)return;setCursor(null);setMode(image.spec.format==="raw"?"cfa":"color");setHighlights([]);setShowSelection(false);setExtraRois([]);try{setRoi(alignCfaRoi(image.spec,{x:0,y:0,width:image.spec.width,height:image.spec.height}));}catch(e){setError(String(e));}const next={black:0,white:2**image.spec.bitDepth-1};setLevels(next);setDisplayLevels(next);setPreview(null);
 },[image?.id]);
 useEffect(()=>{
   if(!image)return;let alive=true;setError("");
   api<{width:number;height:number;area:ROI;url:string}>(`/viewer/images/${image.id}/preview?mode=${mode}&black=${displayLevels.black}&white=${displayLevels.white}&gamma=${gamma}&fullFrame=true`).then(p=>{if(alive)setPreview({...p,key:expectedKey});}).catch(e=>{if(alive){setError(String(e));if(command&&appliedCommand.current!==command.id&&!command.id.startsWith('local-'))void api(`/viewer/commands/${command.id}/ack`,{status:'failed',error:String(e).slice(0,2000),sessionId:sessionId.current});}});
   return()=>{alive=false;};
 },[api,image?.id,mode,displayLevels.black,displayLevels.white,gamma]);
 useEffect(()=>{if(!preview)return;const img=new Image();img.onload=()=>{bitmap.current=img;setLoadedKey(preview.key);redraw.current();};img.src=preview.url;const v=viewport.current,z=Math.min(1,(v?.clientWidth||preview.width)/preview.width,(v?.clientHeight||preview.height)/preview.height);setZoom(z);setOffset({x:((v?.clientWidth||preview.width)-preview.width*z)/2,y:((v?.clientHeight||preview.height)-preview.height*z)/2});return()=>{img.onload=null;};},[preview]);
 // The image canvas contains image pixels only. ROI strokes live in a screen-space SVG.
 function draw(){const c=canvas.current,ctx=c?.getContext('2d');if(!ctx||!c||!bitmap.current)return;ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(bitmap.current,0,0,c.width,c.height);}
 useEffect(()=>{draw();},[preview,image?.id,loadedKey]);
 const annotations=[
  ...(showSelection?[...extraRois,roi].map((r,i)=>({...r,label:String(i+1),color:'#62ffb7'})):[]),
  ...highlights.map(h=>({...h,color:'#ffbf47'})),
  ...(inspection?cropRegions(inspection).map((region,i)=>({...region.roi,label:`저장 ${i+1}`,color:'#79baff'})):[])
 ];
 const annotationsRef=useRef(annotations);annotationsRef.current=annotations;

 useEffect(()=>{if(!commandId)return;let alive=true;const epoch=stateEpoch.current;void api<ViewCommand>(`/viewer/commands/${commandId.split('|')[0]}`).then(async c=>{if(c.status==='applied'&&currentImageId.current)return;const s=await api<State>('/viewer');if(alive){if(epoch===stateEpoch.current&&!captureBusy.current)setState(s);if(c.imageId!==currentImageId.current){setSelected('');setImageId(c.imageId);}setCommand(c);appliedCommand.current='';}}).catch(e=>{if(alive)setError(String(e));});return()=>{alive=false;};},[commandId,api]);
 useEffect(()=>{if(!command||command.imageId!==image?.id||appliedCommand.current===command.id)return;if(command.render){setMode(command.render.mode);setGamma(command.render.gamma);const l={black:command.render.black,white:command.render.white};setLevels(l);setDisplayLevels(l);}if(command.highlights)setHighlights(command.highlights);if(command.pixelValues!==undefined)setPixelValues(command.pixelValues);if(command.pixels&&image)setSpec(old=>({...old,pattern:image.spec.pattern,bitDepth:image.spec.bitDepth,group:image.spec.group,alignment:image.spec.alignment}));},[command,image?.id]);
 useEffect(()=>{if(!command||!preview||command.imageId!==image?.id||loadedKey!==expectedKey||preview.key!==expectedKey||appliedCommand.current===command.id)return;
   // Wait until command settings have reached the render; image changes reset defaults first.
   if(command.render&&(mode!==command.render.mode||gamma!==command.render.gamma||displayLevels.black!==command.render.black||displayLevels.white!==command.render.white))return;
   appliedCommand.current=command.id;const v=viewport.current!,z=command.fit?Math.min(v.clientWidth/preview.width,v.clientHeight/preview.height):command.zoomPercent!==undefined?command.zoomPercent/100*preview.area.width/preview.width:command.zoom??zoom;if(command.zoomPercent!==undefined&&(z<.1||z>512)){appliedCommand.current=command.id;void api(`/viewer/commands/${command.id}/ack`,{status:"failed",error:"Requested zoom is outside this image camera range",sessionId:sessionId.current});return;}setZoom(z);
   requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!viewport.current)return;const center=command.center||{x:preview.area.x+preview.area.width/2,y:preview.area.y+preview.area.height/2};setOffset({x:viewport.current.clientWidth/2-(center.x-preview.area.x)/preview.area.width*preview.width*z,y:viewport.current.clientHeight/2-(center.y-preview.area.y)/preview.area.height*preview.height*z});if(!command.id.startsWith('local-'))void api(`/viewer/commands/${command.id}/ack`,{status:'applied',sessionId:sessionId.current}).catch(e=>setError(String(e)));}));
 },[command,preview,loadedKey,expectedKey,zoom]);
 function currentView():ViewState|null {const v=viewport.current,c=canvas.current;if(!image||!preview||!v||!c||loadedKey!==expectedKey||preview.key!==expectedKey||!v.clientWidth||!v.clientHeight)return null;
   if(!visibleRef.current||!nativeReady)return null;
   const visible=visibleSource(preview.area,preview,zoom,offset,{width:v.clientWidth,height:v.clientHeight});if(!visible)return null;
   const sourceScale={x:preview.width/preview.area.width*zoom,y:preview.height/preview.area.height*zoom};
   return{imageId:image.id,render:{mode,gamma,...displayLevels},zoom,sourceScale,rendering:Math.min(sourceScale.x,sourceScale.y)>=1?'native-webgl2':'overview',area:preview.area,visible,highlights,pixelValues,...(showSelection?{selection:roi,selections:[...extraRois,roi]}:{})};}

 liveView.current=currentView;
 useEffect(()=>{
   if(!visible){void api('/viewer/view/hidden',{sessionId:sessionId.current}).catch(()=>{});return;}
   let stopped=false,pending=false;
   const publish=async()=>{if(pending)return;const view=liveView.current(),c=canvas.current;if(!view||!c){pending=true;try{await api('/viewer/view/hidden',{sessionId:sessionId.current});if(!stopped)setLiveStatus('화면에 보이는 이미지 없음');}catch{}finally{pending=false;}return;}pending=true;
     try{const sx=(view.visible.x-view.area.x)/view.area.width*c.width,sy=(view.visible.y-view.area.y)/view.area.height*c.height,sw=view.visible.width/view.area.width*c.width,sh=view.visible.height/view.area.height*c.height;
       const scale=Math.min(view.zoom,1600/Math.max(sw,sh)),out=document.createElement('canvas');out.width=Math.max(1,Math.round(sw*scale));out.height=Math.max(1,Math.round(sh*scale));const ctx=out.getContext('2d')!;ctx.imageSmoothingEnabled=false;ctx.drawImage(c,sx,sy,sw,sh,0,0,out.width,out.height);
       const native=viewport.current?.querySelector<HTMLCanvasElement>('canvas.viewer-native-image');
       if(native&&native.style.display!=='none'&&viewport.current){ctx.clearRect(0,0,out.width,out.height);const baseBounds=c.getBoundingClientRect(),viewBounds=viewport.current.getBoundingClientRect(),screenX=baseBounds.left-viewBounds.left-viewport.current.clientLeft+sx*view.zoom,screenY=baseBounds.top-viewBounds.top-viewport.current.clientTop+sy*view.zoom;ctx.drawImage(native,screenX*native.width/viewport.current.clientWidth,screenY*native.height/viewport.current.clientHeight,sw*view.zoom*native.width/viewport.current.clientWidth,sh*view.zoom*native.height/viewport.current.clientHeight,0,0,out.width,out.height);}
       const overlay=viewport.current?.querySelector<HTMLCanvasElement>('canvas.viewer-pixel-values');
       if(view.pixelValues&&overlay&&viewport.current){const baseBounds=c.getBoundingClientRect(),viewBounds=viewport.current.getBoundingClientRect(),screenX=baseBounds.left-viewBounds.left-viewport.current.clientLeft+sx*view.zoom,screenY=baseBounds.top-viewBounds.top-viewport.current.clientTop+sy*view.zoom,px=overlay.width/viewport.current.clientWidth,py=overlay.height/viewport.current.clientHeight;ctx.imageSmoothingEnabled=true;ctx.drawImage(overlay,screenX*px,screenY*py,sw*view.zoom*px,sh*view.zoom*py,0,0,out.width,out.height);}
       // Compose vector annotations at output resolution, never into source image pixels.
       const screenScale=scale/view.zoom;
       ctx.lineWidth=2*screenScale;ctx.font=`${14*screenScale}px sans-serif`;
       for(const mark of annotationsRef.current){
        const x=(mark.x-view.visible.x)/view.area.width*c.width*scale,y=(mark.y-view.visible.y)/view.area.height*c.height*scale;
        const w=mark.width/view.area.width*c.width*scale,h=mark.height/view.area.height*c.height*scale;
        ctx.lineWidth=4*screenScale;ctx.strokeStyle='#101820b0';ctx.strokeRect(x,y,w,h);ctx.lineWidth=2*screenScale;ctx.strokeStyle=mark.color;ctx.fillStyle=mark.color;ctx.strokeRect(x,y,w,h);
        ctx.fillText(mark.label,x+4*screenScale,Math.max(16*screenScale,y+16*screenScale));
       }
       await api('/viewer/view',{...view,sessionId:sessionId.current,png:out.toDataURL('image/png')});if(!stopped)setLiveStatus('현재 화면 공유 중');
     }catch{if(!stopped)setLiveStatus('화면 연결 재시도 중');}finally{pending=false;if(!visibleRef.current)void api('/viewer/view/hidden',{sessionId:sessionId.current}).catch(()=>{});}
   };
   const timer=setInterval(()=>void publish(),1500);return()=>{stopped=true;clearInterval(timer);};
 },[api,visible]);
 function clearSelection(){start.current=null;pan.current=null;roiEdited.current=false;setShowSelection(false);setExtraRois([]);}
 function inspectCrop(crop:CropResult){setInspection(crop);const region=crop.roi;if(preview&&viewport.current){setOffset({x:viewport.current.clientWidth/2-(region.x+region.width/2-preview.area.x)/preview.area.width*preview.width*zoom,y:viewport.current.clientHeight/2-(region.y+region.height/2-preview.area.y)/preview.area.height*preview.height*zoom});}}
 function removeDraftRegion(index:number){const remaining=draftRegions.filter((_,i)=>i!==index);if(!remaining.length){clearSelection();return;}setExtraRois(remaining.slice(0,-1));setRoi(remaining[remaining.length-1]);}
 function point(e:React.PointerEvent<HTMLDivElement>){const rect=canvas.current!.getBoundingClientRect(),area=preview!.area;return{x:area.x+Math.max(0,Math.min(area.width,Math.floor((e.clientX-rect.left)/rect.width*area.width))),y:area.y+Math.max(0,Math.min(area.height,Math.floor((e.clientY-rect.top)/rect.height*area.height))) };}
 function alignSelection(next:ROI){if(!image)return;try{setShowSelection(true);setRoi(alignCfaRoi(image.spec,next));setError("");}catch(e){setError(String(e));}}
 function move(e:React.PointerEvent<HTMLDivElement>){
   if(preview&&canvas.current&&!pan.current){const b=canvas.current.getBoundingClientRect();const next=e.clientX>=b.left&&e.clientX<b.right&&e.clientY>=b.top&&e.clientY<b.bottom?point(e):null;setCursor(old=>old?.x===next?.x&&old?.y===next?.y?old:next);}else setCursor(null);
   if(pan.current&&viewport.current){setOffset({x:pan.current.left+e.clientX-pan.current.x,y:pan.current.top+e.clientY-pan.current.y});return;}if(!start.current||!image)return;if(Math.hypot(e.clientX-start.current.clientX,e.clientY-start.current.clientY)<3)return;if(!start.current.staged){start.current.staged=true;setInspection(null);setExtraRois(start.current.additive&&showSelection?[...extraRois,roi]:[]);}const p=point(e),x=Math.min(p.x,start.current.x),y=Math.min(p.y,start.current.y);alignSelection({x,y,width:Math.max(1,Math.abs(p.x-start.current.x)),height:Math.max(1,Math.abs(p.y-start.current.y))});}
 async function upload(){if(!file)return;setBusy(true);setError("");try{
   let bytes:Blob=file,meta={name:file.name,spec:{...spec}};
   if(/\.(png|jpe?g|webp)$/i.test(file.name)){
     const decoded=await createImageBitmap(file);if(decoded.width*decoded.height>64*1024*1024){decoded.close();throw new Error("RGB 업로드는 최대 64M pixels입니다.");}
     const c=document.createElement("canvas");c.width=decoded.width;c.height=decoded.height;const ctx=c.getContext("2d")!;ctx.drawImage(decoded,0,0);decoded.close();bytes=new Blob([ctx.getImageData(0,0,c.width,c.height).data]);meta.spec={...spec,format:"rgba8",width:c.width,height:c.height,offset:0,stride:0};
   } else if(/\.bmp$/i.test(file.name))meta.spec.format="bmp";
   if(bytes.size>256*1024*1024)throw new Error("파일은 최대 256MB입니다.");
   const response=await fetch("/api/viewer/images",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/octet-stream","X-Image-Metadata":encodeURIComponent(JSON.stringify(meta))},body:bytes});const result=await response.json();if(!response.ok)throw new Error(result.error);await refresh();setSelected("");setImageId(result.id);
 }catch(e){setError(String(e));}finally{setBusy(false);}}
 async function applyPixelSettings(){
  if(!image||image.spec.format!=='raw'||busy||sendingCrops)return;
  const context=contextKey;setBusy(true);setError('');
  try {
   const updated=await api<ImageRecord>(`/viewer/images/${image.id}/reinterpret`,{pattern:spec.pattern,bitDepth:spec.bitDepth,group:spec.group,alignment:spec.alignment});
   await refresh();
   if(contextRef.current===context){setSelected('');setImageId(updated.id);captureRequest.current=null;setChosenCrops([]);setInspection(null);setSentCrops(null);clearSelection();}
  }catch(e){setError(String(e));}finally{setBusy(false);}
 }
 async function action(endpoint:string,body:unknown){setBusy(true);setError("");try{const result=await api<CropRequest>(endpoint,body);await refresh();return result;}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function capture(next:ROI){if(!image||!active||!showSelection||!nativeReady||captureBusy.current)return;const context=contextKey;stateEpoch.current++;captureBusy.current=true;setBusy(true);setError("");try{
   const aligned=alignCfaRoi(image.spec,next);const regions=[...extraRois,next].map(r=>alignCfaRoi(image.spec,r));setRoi(aligned);
   let target=request||captureRequest.current;
   if(!target){target=await api<CropRequest>("/viewer/requests",{imageId:image.id,prompt:"사용자가 선택한 크롭 영역",show:false});if(contextRef.current===context)captureRequest.current=target;setState(current=>({...current,requests:[...current.requests,target!]}));}
   const id=crypto.randomUUID();const updated=await api<CropRequest>(`/viewer/requests/${target.id}/crops`,{id,rois:regions,description:batchDescription,purpose:cropPurpose});
   stateEpoch.current++;setState(current=>({...current,requests:current.requests.map(r=>r.id===updated.id?updated:r)}));
   if(contextRef.current===context){setChosenCrops(old=>[...new Set([...old,`${target!.id}:${id}`])]);setSideOpen(true);setInspection(null);clearSelection();}
 }catch(e){if(contextRef.current===context)setError(String(e));}finally{captureBusy.current=false;setBusy(false);}}
 function finish(e:React.PointerEvent<HTMLDivElement>){if(pan.current){pan.current=null;return;}const origin=start.current;start.current=null;if(!origin||!image)return;if(Math.hypot(e.clientX-origin.clientX,e.clientY-origin.clientY)<3){if(!origin.additive)clearSelection();return;}const p=point(e);alignSelection({x:Math.min(p.x,origin.x),y:Math.min(p.y,origin.y),width:Math.max(1,Math.abs(p.x-origin.x)),height:Math.max(1,Math.abs(p.y-origin.y))});}
 async function download(requestId:string,crop:CropResult,kind:string){try{const response=await fetch(`/api/viewer/requests/${requestId}/files/${kind}${crop.id?`?cropId=${crop.id}`:""}`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error("다운로드 실패");const url=URL.createObjectURL(await response.blob());const a=document.createElement("a");a.href=url;a.download=crop.paths[kind as keyof CropResult["paths"]]?.split("/").pop()||kind;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(String(e));}}
 const importForm=<details className="viewer-import" open={!state.images.length}><summary>Open image · BMP / PNG / JPEG / RAW</summary><input aria-label="Image file" type="file" accept=".bmp,.png,.jpg,.jpeg,.webp,.raw,.bin" onChange={e=>setFile(e.target.files?.[0]||null)}/><div className="viewer-fields">
 {(["width","height","bitDepth","offset","stride"] as const).map(key=><label key={key}>{({width:"Width",height:"Height",bitDepth:"Bit depth",offset:"Header bytes",stride:"Row stride (0 = auto)"})[key]}<input type="number" min={key==='bitDepth'?8:undefined} max={key==='bitDepth'?16:undefined} aria-label={`RAW ${key}`} value={spec[key]} onChange={e=>{const value=Number(e.target.value);if(key==='bitDepth'&&(!Number.isInteger(value)||value<8||value>16))return;setSpec({...spec,[key]:value});}}/></label>)}
 <label>RAW layout<select value={spec.group} onChange={e=>setSpec({...spec,group:Number(e.target.value)})}><option value={1}>Bayer (1×1)</option><option value={2}>Tetra (2×2)</option><option value={4}>TetraSquare (4×4)</option></select></label><label>Pixel order<select value={spec.pattern} onChange={e=>setSpec({...spec,pattern:e.target.value})}>{["RGGB","GRBG","GBRG","BGGR"].map(p=><option key={p}>{p}</option>)}</select></label><label>16bit LE alignment<select value={spec.alignment} onChange={e=>setSpec({...spec,alignment:e.target.value as Spec["alignment"]})}><option value="lsb">LSB aligned</option><option value="msb">MSB aligned</option></select></label><button disabled={busy||!file} onClick={upload}>Open image</button></div><small>RAW 설정은 헤더가 없는 16bit little-endian 컨테이너에 적용됩니다. RGB 파일은 크기를 자동으로 읽습니다.</small></details>;
 return <section className="viewer work-board" aria-label="Image Viewer" onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();clearSelection();setInspection(null);}}}>
 <header className="viewer-toolbar viewer-toolbar-compact">
 <span className="viewer-title-icon" title="Image Viewer"><FileImage size={18}/></span><select className="viewer-image-select" disabled={busy} aria-label="Viewer image" value={image?.id||""} onChange={e=>{setSelected("");setImageId(e.target.value);}}><option value="">이미지 선택</option>{state.images.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>
 {image&&<><select className="viewer-render-select" aria-label="Preview mode" value={mode} onChange={e=>setMode(e.target.value)}><option value="color">{image.spec.format==="raw"?"Cell average":"RGB"}</option><option value="gray">Grayscale</option>{image.spec.format==="raw"&&<><option value="cfa">Bayer / Tetra · CFA colors</option><option value="simple">Simple ISP · Demosaic + Gamma</option></>}</select><div className="viewer-zoom-controls"><button className="viewer-icon-button zoom-step" title="축소" aria-label="축소" onClick={()=>zoomCenter(Math.max(.1,zoom/1.5))}><Minus size={15}/></button><span title="원본 픽셀 기준 확대율">{Math.round(zoom*(preview?preview.width/preview.area.width:1)*100)}%</span><button className="viewer-icon-button zoom-step" title="확대" aria-label="확대" onClick={()=>zoomCenter(Math.min(512,zoom*1.5))}><Plus size={15}/></button><button className="viewer-icon-button" title="원본 픽셀 1:1" aria-label="원본 픽셀 1:1" onClick={()=>{if(preview)zoomCenter(preview.area.width/preview.width);}}>1:1</button><button className="viewer-icon-button" title="화면에 맞추기" aria-label="화면에 맞추기" onClick={fitPreview}><Scan size={16}/></button></div>
 <button className="viewer-icon-button viewer-pixel-toggle" title="충분히 확대하면 원본 픽셀 값 표시" aria-label="원본 픽셀 값 표시" aria-pressed={pixelValues} onClick={()=>setPixelValues(v=>!v)}><Hash size={16}/></button>
 <details className="viewer-settings"><summary title="렌더링 설정 · 강조" aria-label="렌더링 설정 · 강조"><SlidersHorizontal size={17}/></summary><div className="viewer-settings-body">{mode==="simple"&&image.spec.format==="raw"&&<label>Gamma<input aria-label="Simple ISP gamma" type="number" min="0.1" max="5" step="0.1" value={gamma} onChange={e=>{const v=Number(e.target.value);if(v>=.1&&v<=5)setGamma(v);}}/></label>}<button disabled={!showSelection||highlights.length>=20} onClick={()=>setHighlights(h=>[...h,{...roi,label:`영역 ${h.length+1}`}])}>선택 영역 강조</button><button disabled={!highlights.length} onClick={()=>setHighlights([])}>강조 지우기</button><div className="viewer-levels"><label>Black<input type="number" value={levels.black} onChange={e=>setLevels({...levels,black:Number(e.target.value)})}/></label><label>White<input type="number" value={levels.white} onChange={e=>setLevels({...levels,white:Number(e.target.value)})}/></label><button onClick={()=>setDisplayLevels(levels)}>Apply preview</button></div></div></details>
 <button className="viewer-crops-toggle" title="크롭 패널 열기 / 접기" aria-label="크롭 패널 열기 / 접기" aria-expanded={sideOpen} aria-controls="viewer-crops-panel" onClick={()=>setSideOpen(v=>!v)}><Crop size={16}/><span>{showSelection?`${draftRegions.length} 선택`:chosenItems.length?`${chosenItems.length} 준비`:cropItems.length}</span></button></>}
 <button className="viewer-icon-button" onClick={onExpand} title={expanded?"Viewer 원래 크기로":"Viewer 최대화"} aria-label={expanded?"Viewer 원래 크기로":"Viewer 최대화"} aria-pressed={expanded}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
<details className="viewer-settings viewer-pixel-settings" onToggle={e=>{if(e.currentTarget.open&&image?.spec.format==='raw')setSpec(old=>({...old,pattern:image.spec.pattern,bitDepth:image.spec.bitDepth,group:image.spec.group,alignment:image.spec.alignment}));}}><summary title={`픽셀 특성 설정 · ${spec.pattern} · ${spec.bitDepth}bit`} aria-label="픽셀 특성 설정"><Grid2X2 size={17}/></summary><div className="viewer-settings-body"><strong>RAW 픽셀 특성</strong><small>기본값 자동 저장 · 로드된 RAW에는 적용 버튼 사용</small><label>Pixel order<select aria-label="기본 Pixel order" value={spec.pattern} onChange={e=>setSpec(old=>({...old,pattern:e.target.value}))}>{['GRBG','RGGB','GBRG','BGGR'].map(value=><option key={value}>{value}</option>)}</select></label><label>Input bit depth<select aria-label="기본 Input bit depth" value={spec.bitDepth} onChange={e=>setSpec(old=>({...old,bitDepth:Number(e.target.value)}))}>{Array.from({length:9},(_,i)=>i+8).map(value=><option key={value} value={value}>{value} bit</option>)}</select></label><label>RAW layout<select aria-label="기본 RAW layout" value={spec.group} onChange={e=>setSpec(old=>({...old,group:Number(e.target.value)}))}><option value={1}>Bayer</option><option value={2}>Tetra (2×2)</option><option value={4}>TetraSquare (4×4)</option></select></label><label>16-bit LE alignment<select aria-label="기본 RAW alignment" value={spec.alignment} onChange={e=>setSpec(old=>({...old,alignment:e.target.value as Spec['alignment']}))}><option value="lsb">LSB aligned</option><option value="msb">MSB aligned</option></select></label>{image&&<small>현재 이미지: {image.spec.format==='raw'?`${image.spec.pattern} · ${image.spec.bitDepth}bit · group ${image.spec.group}`:'RGB'}<br/>아래 적용 버튼으로 다시 표시합니다. 기존 크롭·에이전트 요청은 이전 이미지 규격으로 보존됩니다.</small>}<button onClick={()=>setSpec(old=>({...old,pattern:'GRBG',bitDepth:12,group:1,alignment:'lsb'}))}>기본값 복원 · GRBG / 12bit</button>{image?.spec.format==='raw'&&<button disabled={busy||sendingCrops} onClick={()=>void applyPixelSettings()}>현재 이미지에 적용</button>}{image&&image.spec.format!=='raw'&&<small>현재 이미지는 RGB입니다. RAW 설정은 새로 여는 RAW에 적용됩니다.</small>}{pixelPreferenceError&&<small role="alert">{pixelPreferenceError}</small>}</div></details> </header>
 {error&&<div className="viewer-error" role="alert"><span>{/session token/i.test(error)?"서버 연결이 바뀌었습니다. 새로 연결해주세요.":error}</span>{/session token/i.test(error)&&<button title="서버에 다시 연결" aria-label="서버에 다시 연결" onClick={()=>location.reload()}><RefreshCw size={15}/></button>}<button title="오류 닫기" aria-label="오류 닫기" onClick={()=>setError("")}><X size={15}/></button></div>}
 {image&&<>

 {request?.origin==='agent'&&request.status!=='cancelled'&&!request.delivery&&<div className="viewer-agent-crop-request" role="status"><strong>에이전트가 크롭을 요청했습니다</strong><span>{request.prompt}</span><small>영역 선택 → 추가 → 전달을 누르면 에이전트가 결과를 받습니다.</small><button disabled={busy||sendingCrops} onClick={()=>action(`/viewer/requests/${request.id}/cancel`,{})}>요청 취소</button></div>}
 <div className={`viewer-content ${sideOpen?"crops-open":"crops-closed"} ${sidePinned?"crops-pinned":"crops-overlay"}`} style={{"--viewer-side-width":`${sideWidth}px`} as CSSProperties}><div className="viewer-image-column"><div className="viewer-canvas" ref={viewport} tabIndex={0} aria-label="이미지 영역" onContextMenu={e=>{if(!(e.target as HTMLElement).closest(".viewer-info-float,.viewer-selection-float"))e.preventDefault();}} onPointerDown={e=>{if((e.target as HTMLElement).closest('.viewer-info-float,.viewer-selection-float'))return;if(!preview)return;e.currentTarget.focus({preventScroll:true});if(e.button===0&&!e.shiftKey&&e.target===e.currentTarget){clearSelection();return;}if(e.button===1||e.button===2){pan.current={x:e.clientX,y:e.clientY,left:offset.x,top:offset.y};e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);return;}if(!active||busy||!nativeReady||e.button!==0||e.target!==canvas.current)return;if(e.shiftKey&&showSelection&&extraRois.length>=31){setError("한 묶음은 최대 32개 영역입니다.");return;}start.current={...point(e),clientX:e.clientX,clientY:e.clientY,additive:e.shiftKey,staged:false};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={move} onPointerLeave={()=>setCursor(null)} onPointerUp={finish} onLostPointerCapture={()=>{if(start.current)clearSelection();pan.current=null;}} onPointerCancel={()=>{if(start.current)clearSelection();pan.current=null;}}>{preview?<canvas ref={canvas} aria-label="Crop selection canvas" width={preview.width} height={preview.height} style={{width:preview.width*zoom,height:preview.height*zoom,left:offset.x,top:offset.y,opacity:nativeReady&&Math.min(preview.width/preview.area.width,preview.height/preview.area.height)*zoom>=1?0:1}}/>:<p>미리보기 준비 중…</p>}{preview&&<NativeImage image={image} preview={preview} zoom={zoom} offset={offset} viewportRef={viewport} token={token} mode={mode} black={displayLevels.black} white={displayLevels.white} gamma={gamma} active={visible} cursor={cursor} onReady={setNativeReady}/>}{preview&&<PixelValues image={image} preview={preview} zoom={zoom} offset={offset} viewportRef={viewport} token={token} enabled={pixelValues}/>}{preview&&<svg className="viewer-annotations" aria-hidden="true" width="100%" height="100%">{annotations.map((mark,i)=>{
 const x=offset.x+(mark.x-preview.area.x)/preview.area.width*preview.width*zoom;
 const y=offset.y+(mark.y-preview.area.y)/preview.area.height*preview.height*zoom;
 const width=mark.width/preview.area.width*preview.width*zoom,height=mark.height/preview.area.height*preview.height*zoom;
 return <g key={i} data-roi-index={i}><rect x={x} y={y} width={width} height={height} fill="none" stroke="#101820b0" strokeWidth={4} vectorEffect="non-scaling-stroke"/><rect x={x} y={y} width={width} height={height} fill="none" stroke={mark.color} strokeWidth={2} vectorEffect="non-scaling-stroke"/><text x={x+4} y={Math.max(16,y+16)} fill={mark.color} fontSize={14} fontFamily="sans-serif">{mark.label}</text></g>;
 })}</svg>}<details className="viewer-info-float"><summary title="이미지 정보 · 에이전트 안내" aria-label="이미지 정보 · 에이전트 안내"><Info size={16}/><span>정보{command?.message||request?" · 안내":""}</span></summary><div><span>{image.spec.width} × {image.spec.height} · {image.spec.bitDepth}bit {image.spec.format==="raw"?`· ${image.spec.pattern} · group ${image.spec.group}`:"RGB"}</span> {command?.message&&<div className="viewer-request"><strong>에이전트 안내 · {command.message}</strong></div>}{request&&<div className="viewer-request"><strong>{request.status} · {request.prompt}</strong></div>}<details className="viewer-open-settings"><summary>이미지 열기 조건</summary><dl><dt>파일</dt><dd>{image.name}</dd><dt>크기 / 형식</dt><dd>{image.spec.width} × {image.spec.height} · {image.spec.format}</dd>{image.spec.format==='raw'&&<><dt>저장 / 유효 비트</dt><dd>16-bit little-endian · {image.spec.bitDepth}-bit · {image.spec.alignment.toUpperCase()} aligned</dd><dt>CFA 배열</dt><dd>{image.spec.pattern} · {image.spec.group===1?'Bayer':image.spec.group===2?'Tetra':'TetraSquare'} ({image.spec.group}×{image.spec.group})</dd><dt>헤더 / 행 간격</dt><dd>{image.spec.offset} bytes / {image.spec.stride} bytes</dd><dt>CFA 시작 위상</dt><dd>({image.spec.originX||0}, {image.spec.originY||0})</dd></>}<dt>현재 렌더링</dt><dd>{image.spec.format!=='raw'?'RGB':mode==='simple'?'Simple ISP':mode==='cfa'?'CFA colors':mode==='gray'?'Grayscale':'Cell average'}</dd><dt>Black / White</dt><dd>{displayLevels.black} / {displayLevels.white}</dd>{mode==='simple'&&image.spec.format==='raw'&&<><dt>Gamma</dt><dd>{gamma}</dd><dt>Demosaic</dt><dd>동일 색 {image.spec.group}×{image.spec.group} 평균 → 위상별 bilinear 보간 → 감마. WB / CCM 없음.</dd></>}</dl><small>파일 등록 시 적용한 해석 설정입니다. 파일 자체에서 검증한 센서 메타데이터는 아닙니다.</small></details> <details className="viewer-help"><summary>좌표 / 미리보기 안내</summary>
 <small>휠로 마우스 위치를 중심으로 확대·축소합니다. Esc 또는 × 버튼으로 크롭 선택을 취소합니다. 이미지나 여백을 클릭해도 해제됩니다. 오른쪽 버튼 + 드래그로 이미지를 이동합니다. Shift + 드래그는 현재 묶음에 영역을 추가합니다. 일반 드래그는 새 묶음을 시작합니다. 가운데 버튼으로도 이동할 수 있습니다. 좌표는 원본 픽셀 기준, 좌상단 (0, 0)입니다. CFA colors는 원본 픽셀의 R/G/B 채널만 표시합니다. 전체 프레임에서 확대·이동할 수 있습니다. 축소 상태는 전체 미리보기이며, 100% 이상 확대하면 RAW/BMP 원본 타일을 WebGL2로 표시합니다. 원본 타일 로딩 중에는 새 크롭을 확정할 수 없습니다. 픽셀 값과 크롭 좌표는 원본 기준입니다. Simple ISP는 동일 색 그룹 평균 → 보간 → 감마(기본 2.2) 미리보기이며 색 보정·화이트밸런스는 하지 않습니다. RAW 크롭 값은 변경하지 않습니다. RAW는 드래그와 숫자 입력 모두 완전한 CFA 셀로 정렬합니다. 숫자 입력은 포커스를 옮기면 정렬되며 가장자리의 불완전한 셀은 제외됩니다. end 좌표는 영역에 포함되지 않습니다.</small></details></div></details><div className="viewer-selection-float viewer-crop-session" aria-live="polite">
 <div className="crop-session-heading"><span>{showSelection?`그린 영역 ${draftRegions.length}개 · 아직 저장 안 됨`:chosenItems.length?`전달 준비 ${chosenItems.length}개 항목 · ${chosenRegionCount}개 영역`:inspection?'저장된 크롭 확인 중 · 파란색 테두리':sentCrops?`${sentCrops.count}개 항목 ${sentCrops.status==='consumed'?'에이전트 확인 완료':sentCrops.status==='superseded'?'이전 전달':'전달됨'}`:'드래그로 크롭 · Shift로 영역 추가'}</span><button title="크롭 작업 패널" aria-label="크롭 작업 패널" onClick={()=>setSideOpen(v=>!v)}><Crop size={15}/></button></div>
 {showSelection&&<DraftRegions regions={draftRegions} bitmap={bitmap.current} area={preview?.area} onRemove={removeDraftRegion}/>}
 {!showSelection&&chosenItems.length>0&&<div className="crop-selected-strip" aria-label="전달할 크롭 미리보기">{chosenItems.map(item=><button key={cropKey(item)} title={`${cropRegions(item.crop).length}개 영역 · ${item.crop.description||'설명 없음'}`} onClick={()=>inspectCrop(item.crop)}><SavedCropThumbnail requestId={item.requestId} crop={item.crop} token={token}/><span>{cropItems.indexOf(item)+1} · {cropRegions(item.crop).length}영역</span></button>)}</div>}
 {(showSelection||inspection)&&<div className="crop-session-actions">{showSelection&&<button disabled={busy||!preview||!active||!nativeReady} title="선택 영역 크롭 추가" aria-label="선택 영역 크롭 추가" onClick={()=>void capture(roi)}><Plus size={15}/> 크롭 추가 ({draftRegions.length})</button>}<button title="그린 영역 / 확인 표시 지우기" aria-label="이미지 크롭 선택 취소" onClick={()=>{clearSelection();setInspection(null);}}><X size={15}/> 표시 지우기</button></div>}
 </div></div>
</div>
 <div className="viewer-side-resizer" role="separator" aria-label="크롭 패널 너비 조절" aria-orientation="vertical" aria-valuemin={180} aria-valuemax={600} aria-valuenow={sideWidth} tabIndex={0} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setSideWidth(w=>Math.max(180,Math.min(600,w+(e.key==='ArrowLeft'?20:-20))));}}} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();sideDrag.current={x:e.clientX,width:e.currentTarget.nextElementSibling!.getBoundingClientRect().width};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(sideDrag.current)setSideWidth(Math.max(180,Math.min(600,sideDrag.current.width+sideDrag.current.x-e.clientX)));}} onPointerUp={()=>{sideDrag.current=null;}} onPointerCancel={()=>{sideDrag.current=null;}} onLostPointerCapture={()=>{sideDrag.current=null;}}/>
 <aside id="viewer-crops-panel" className="viewer-crop-list viewer-crop-workspace" aria-label="크롭 목록" hidden={!sideOpen}>
 <div className="viewer-drawer-heading"><strong>크롭 작업</strong><button className="viewer-icon-button" title={sidePinned?'크롭 패널 고정 해제':'크롭 패널 고정'} aria-label="크롭 패널 고정" aria-pressed={sidePinned} onClick={()=>setSidePinned(v=>!v)}>{sidePinned?<PinOff size={15}/>:<Pin size={15}/>}</button><button className="viewer-icon-button" title="크롭 패널 접기" aria-label="크롭 패널 접기" onClick={()=>setSideOpen(false)}><X size={15}/></button></div>
 <div className="crop-current-state"><strong>{showSelection?`저장 전 ${draftRegions.length}개 영역`:`전달 준비 ${chosenItems.length}개 항목`}</strong>{showSelection?<button disabled={busy||!preview||!active||!nativeReady} onClick={()=>void capture(roi)}><Plus size={14}/> 크롭 추가</button>:<small>{chosenRegionCount}개 영역</small>}</div>
 <div className="crop-workspace-scroll" inert={clearingHistory}>
 {chosenItems.length>0&&<section aria-label="이번에 전달할 크롭">{chosenItems.map(item=><CropCard key={cropKey(item)} crop={item.crop} requestId={item.requestId} index={cropItems.indexOf(item)} token={token} chosen={true} onChoose={(shift,toggle)=>chooseCrop(cropItems.indexOf(item),shift,toggle)} api={api} onSaved={refresh} onInspect={()=>inspectCrop(item.crop)} onDownload={kind=>void download(item.requestId,item.crop,kind)}/>)}</section>}
 {!chosenItems.length&&!showSelection&&<p className="crop-workspace-hint">이미지를 드래그하고 <strong>크롭 추가</strong>를 누르세요. Shift+드래그로 여러 영역을 한 항목에 묶을 수 있습니다.</p>}
 {showSelection&&<details className="crop-coordinates-editor"><summary>선택 좌표 편집 · {image.spec.format==='raw'?`${2*image.spec.group}×${2*image.spec.group} CFA 정렬`:'원본 픽셀'}</summary><div className="viewer-toolbar viewer-roi">{(['x','y','width','height'] as const).map(key=><label key={key}>{key}<input disabled={!active||busy} aria-label={`Crop ${key}`} type="number" value={roi[key]} onChange={e=>{roiEdited.current=true;setRoi({...roi,[key]:Number(e.target.value)});}} onBlur={()=>{if(roiEdited.current){roiEdited.current=false;alignSelection(roi);}}}/></label>)}</div></details>}
 <details className="crop-history" open={historyOpen} onToggle={e=>setHistoryOpen(e.currentTarget.open)}><summary>이전 크롭 <span>{historyItems.length}</span><button className="crop-history-clear" aria-label="이전 크롭 비우기" title="현재 이미지의 이전 크롭과 관련 파일 삭제 · 이번 전달 선택은 유지" disabled={busy||sendingCrops||!historyItems.length} onClick={e=>{e.preventDefault();e.stopPropagation();void clearCropHistory();}}><Trash2 size={13}/>{clearingHistory?'비우는 중…':'비우기'}</button></summary>{historyOpen&&<><small>체크하면 이번 전달에 포함됩니다. 눈 아이콘은 영역만 확인합니다.</small>{historyItems.slice().reverse().map(item=><CropCard key={cropKey(item)} crop={item.crop} requestId={item.requestId} index={cropItems.indexOf(item)} token={token} chosen={false} onChoose={(shift,toggle)=>chooseCrop(cropItems.indexOf(item),shift,toggle)} api={api} onSaved={refresh} onInspect={()=>inspectCrop(item.crop)} onDownload={kind=>void download(item.requestId,item.crop,kind)}/>)}</>}</details>
 <details className="crop-advanced"><summary>요청 · 이미지 · 현재 화면</summary><label className="viewer-request-select">크롭 요청<select disabled={busy||sendingCrops} aria-label="Crop request" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">직접 선택</option>{state.requests.slice().reverse().map(r=><option key={r.id} value={r.id}>{r.status} · {r.prompt.slice(0,65)}</option>)}</select></label>{request&&<p>{request.prompt}</p>}{request?.status==='pending'&&<button disabled={busy} onClick={()=>action(`/viewer/requests/${request.id}/cancel`,{})}>요청 취소</button>}{importForm}<section className="viewer-share"><strong>현재 View</strong><small role="status">{liveStatus}</small><p>“지금 보고 있는 부분을 봐줘”라고 요청하세요. 현재 화면은 크롭 전달과 별도로 공유됩니다.</p></section></details>
 </div>
 <div className="crop-delivery-composer"><label className="crop-purpose-label">작업<select aria-label="크롭 전달 목적" value={cropPurpose} disabled={sendingCrops||busy} onChange={e=>setCropPurpose(e.target.value as CropPurpose)}>{(Object.keys(purposeLabels) as CropPurpose[]).map(purpose=><option key={purpose} value={purpose}>{purposeLabels[purpose]}</option>)}</select></label><textarea aria-label="선택한 크롭 공통 설명" rows={2} maxLength={12000} disabled={sendingCrops||busy} value={batchDescription} placeholder={cropPurpose==='white_balance'?'예: 이 중립 영역들로 R/G/B gain을 계산해줘.':cropPurpose==='input'?'예: 이 영역들을 테스트 입력으로 등록해줘.':'이 영역으로 무엇을 해줄까요?'} onChange={e=>setBatchDescription(e.target.value)}/>
 <div className="crop-delivery-actions"><button className="crop-send-button" disabled={sendingCrops||busy||!chosenItems.length||showSelection} onClick={()=>void sendCrops()}><Send size={14}/>{sendingCrops?'전달 중…':`에이전트에게 전달 (${chosenItems.length})`}</button><button className="viewer-icon-button" aria-label="이번 전달 선택 비우기" title="이번 전달 선택 비우기 · 저장된 항목은 유지" disabled={sendingCrops||!chosenItems.length} onClick={()=>{setChosenCrops([]);setInspection(null);cropAnchor.current=null;}}><X size={15}/></button></div>
 {showSelection&&<small className="crop-unsaved-hint">그린 영역을 먼저 크롭에 추가하세요.</small>}
 {sentCrops&&<small className="crop-delivery-receipt" role="status">마지막 전달 · {sentCrops.count}개 · {new Date(sentCrops.sentAt).toLocaleTimeString()}<br/>{sentCrops.status==='consumed'?'에이전트 확인 완료':sentCrops.status==='superseded'?'새 전달로 교체됨':'전달됨 · 에이전트 확인 대기'}</small>}
 </div></aside></div>
 </>}
 {!image&&<div className="viewer-empty-content">{state.requests.length>0&&<label className="viewer-request-select">크롭 요청<select disabled={busy} aria-label="Crop request" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">크롭 요청 선택</option>{state.requests.slice().reverse().map(r=><option key={r.id} value={r.id}>{r.status} · {r.prompt.slice(0,65)}</option>)}</select></label>}{importForm}<div className="sdd-empty">이미지를 열거나 에이전트의 크롭 요청을 선택하세요.</div></div>}
 </section>;
}
