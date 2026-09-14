import {useEffect,useRef,useState} from "react";
import {alignCfaRoi} from "../server/cfa-roi.mjs";
import type {Api} from "./types";

type Spec={format:"raw"|"bmp"|"rgba8";width:number;height:number;bitDepth:number;alignment:"lsb"|"msb";pattern:string;group:number;offset:number;stride:number;originX?:number;originY?:number};
type ImageRecord={id:string;name:string;spec:Spec};
type ROI={x:number;y:number;width:number;height:number};
type CropResult={id?:string;description?:string;roi:ROI;paths:{crop:string;preview:string;metadata:string};output:{cfaOrigin?:{x:number;y:number}}};
type CropRequest={id:string;imageId:string;prompt:string;status:string;result?:CropResult;crops?:CropResult[]};
function CropCard({crop,requestId,index,api,onSaved,onSelect,onDownload}:{crop:CropResult;requestId:string;index:number;api:Api;onSaved:()=>Promise<void>;onSelect:()=>void;onDownload:(kind:string)=>void}){
 const [text,setText]=useState(crop.description||""),[saving,setSaving]=useState(false),[error,setError]=useState("");
 const base=useRef(crop.description||""),inFlight=useRef(false);
 useEffect(()=>{if(text===base.current){setText(crop.description||"");base.current=crop.description||"";}},[crop.description]);
 async function save(){if(inFlight.current||text===base.current)return;inFlight.current=true;setSaving(true);setError("");const next=text;try{await api(`/viewer/requests/${requestId}/crops/${crop.id||requestId}`,{description:next,previousDescription:base.current},"PATCH");base.current=next;await onSaved();}catch(e){setError(String(e));}finally{inFlight.current=false;setSaving(false);}}
 useEffect(()=>{if(saving||error||text===base.current)return;const timer=setTimeout(()=>void save(),700);return()=>clearTimeout(timer);},[text,saving,error]);
 return <article className="viewer-crop-card"><button onClick={onSelect}>ROI {index+1} · 영역 보기</button><code>x {crop.roi.x}, y {crop.roi.y}<br/>{crop.roi.width} × {crop.roi.height} · end ({crop.roi.x+crop.roi.width}, {crop.roi.y+crop.roi.height})</code><textarea aria-label={`ROI ${index+1} 설명`} placeholder="이 영역에 대한 설명…" rows={3} maxLength={12000} value={text} onChange={e=>{setText(e.target.value);setError("");}} onBlur={()=>void save()}/><small>{saving?"저장 중…":text===base.current?"저장됨":"자동 저장 대기…"}</small>{error&&<><p role="alert">{error}</p><button onClick={()=>void save()}>저장 재시도</button></>}<div><button onClick={()=>onDownload("crop")}>크롭 파일</button><button onClick={()=>onDownload("metadata")}>좌표 / 설명</button></div></article>;
}
type State={images:ImageRecord[];requests:CropRequest[]};
const initial:Spec={format:"raw",width:4000,height:3000,bitDepth:12,alignment:"lsb",pattern:"GRBG",group:1,offset:0,stride:0};

export function Viewer({api,token,requestId,onExpand}:{api:Api;token:string;requestId:string;onExpand:()=>void}){
 const [state,setState]=useState<State>({images:[],requests:[]}),[imageId,setImageId]=useState(""),[selected,setSelected]=useState(requestId);
 const [spec,setSpec]=useState(initial),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [roi,setRoi]=useState<ROI>({x:0,y:0,width:1,height:1}),[mode,setMode]=useState("color"),[zoom,setZoom]=useState(1);
 const captureBusy=useRef(false);
 const [gamma,setGamma]=useState(2.2),[viewOrigin,setViewOrigin]=useState({x:0,y:0});
 const [levels,setLevels]=useState({black:0,white:4095}),[displayLevels,setDisplayLevels]=useState(levels);
 const [preview,setPreview]=useState<{width:number;height:number;area:ROI;url:string}|null>(null);
 const canvas=useRef<HTMLCanvasElement>(null),viewport=useRef<HTMLDivElement>(null),start=useRef<{x:number;y:number;clientX:number;clientY:number}|null>(null),bitmap=useRef<HTMLImageElement|null>(null);
 const redraw=useRef(()=>{});redraw.current=draw;
 const request=state.requests.find(r=>r.id===selected),image=state.images.find(i=>i.id===(request?.imageId||imageId));
 const active=request?.status!=="cancelled";
 const cropItems=state.requests.filter(r=>r.imageId===image?.id).flatMap(r=>(r.crops||(r.result?[r.result]:[])).map(crop=>({crop,requestId:r.id})));
 function fitPreview(){if(preview&&viewport.current)setZoom(Math.min(viewport.current.clientWidth/preview.width,viewport.current.clientHeight/preview.height));}
 async function refresh(){const next=await api<State>("/viewer");setState(next);}
 useEffect(()=>{let alive=true;const load=()=>api<State>("/viewer").then(s=>{if(alive)setState(s);}).catch(e=>{if(alive)setError(String(e));});void load();const timer=setInterval(load,2500);return()=>{alive=false;clearInterval(timer);};},[api]);
 useEffect(()=>{setSelected(requestId);},[requestId]);
 useEffect(()=>{
   if(!image)return;if(image.spec.format!=="raw")setMode("color");setViewOrigin({x:0,y:0});try{setRoi(alignCfaRoi(image.spec,{x:0,y:0,width:image.spec.width,height:image.spec.height}));}catch(e){setError(String(e));}const next={black:0,white:2**image.spec.bitDepth-1};setLevels(next);setDisplayLevels(next);setPreview(null);
 },[image?.id]);
 useEffect(()=>{if(request?.result)setRoi(request.result.roi);},[request?.id,request?.status]);
 useEffect(()=>{
   if(!image)return;let alive=true;setError("");
   api<{width:number;height:number;area:ROI;url:string}>(`/viewer/images/${image.id}/preview?mode=${mode}&black=${displayLevels.black}&white=${displayLevels.white}&gamma=${gamma}&viewX=${viewOrigin.x}&viewY=${viewOrigin.y}`).then(p=>{if(alive)setPreview(p);}).catch(e=>{if(alive)setError(String(e));});
   return()=>{alive=false;};
 },[api,image?.id,mode,displayLevels.black,displayLevels.white,gamma,viewOrigin.x,viewOrigin.y]);
 useEffect(()=>{if(!preview)return;const img=new Image();img.onload=()=>{bitmap.current=img;redraw.current();};img.src=preview.url;setZoom(Math.min(1,(viewport.current?.clientWidth||preview.width)/preview.width));return()=>{img.onload=null;};},[preview]);
 function draw(){const c=canvas.current,ctx=c?.getContext("2d");if(!ctx||!c||!bitmap.current||!image)return;ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(bitmap.current,0,0,c.width,c.height);const area=preview?.area||{x:0,y:0,width:image.spec.width,height:image.spec.height};const sx=c.width/area.width,sy=c.height/area.height;ctx.imageSmoothingEnabled=false;ctx.strokeStyle="#62ffb7";ctx.lineWidth=2;ctx.fillStyle="#62ffb730";ctx.fillRect((roi.x-area.x)*sx,(roi.y-area.y)*sy,roi.width*sx,roi.height*sy);ctx.strokeRect((roi.x-area.x)*sx,(roi.y-area.y)*sy,roi.width*sx,roi.height*sy);}
 useEffect(draw,[roi,preview,image?.id]);
 function point(e:React.PointerEvent<HTMLCanvasElement>){const rect=e.currentTarget.getBoundingClientRect(),area=preview!.area;return{x:area.x+Math.max(0,Math.min(area.width,Math.floor((e.clientX-rect.left)/rect.width*area.width))),y:area.y+Math.max(0,Math.min(area.height,Math.floor((e.clientY-rect.top)/rect.height*area.height))) };}
 function alignSelection(next:ROI){if(!image)return;try{setRoi(alignCfaRoi(image.spec,next));setError("");}catch(e){setError(String(e));}}
 function move(e:React.PointerEvent<HTMLCanvasElement>){if(!start.current||!image)return;const p=point(e),x=Math.min(p.x,start.current.x),y=Math.min(p.y,start.current.y);alignSelection({x,y,width:Math.max(1,Math.abs(p.x-start.current.x)),height:Math.max(1,Math.abs(p.y-start.current.y))});}
 async function upload(){if(!file)return;setBusy(true);setError("");try{
   let bytes:Blob=file,meta={name:file.name,spec:{...spec}};
   if(/\.(png|jpe?g|webp)$/i.test(file.name)){
     const decoded=await createImageBitmap(file);if(decoded.width*decoded.height>64*1024*1024){decoded.close();throw new Error("RGB 업로드는 최대 64M pixels입니다.");}
     const c=document.createElement("canvas");c.width=decoded.width;c.height=decoded.height;const ctx=c.getContext("2d")!;ctx.drawImage(decoded,0,0);decoded.close();bytes=new Blob([ctx.getImageData(0,0,c.width,c.height).data]);meta.spec={...spec,format:"rgba8",width:c.width,height:c.height,offset:0,stride:0};
   } else if(/\.bmp$/i.test(file.name))meta.spec.format="bmp";
   if(bytes.size>256*1024*1024)throw new Error("파일은 최대 256MB입니다.");
   const response=await fetch("/api/viewer/images",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/octet-stream","X-Image-Metadata":encodeURIComponent(JSON.stringify(meta))},body:bytes});const result=await response.json();if(!response.ok)throw new Error(result.error);await refresh();setSelected("");setImageId(result.id);
 }catch(e){setError(String(e));}finally{setBusy(false);}}
 async function action(endpoint:string,body:unknown){setBusy(true);setError("");try{const result=await api<CropRequest>(endpoint,body);await refresh();return result;}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function capture(next:ROI){if(!image||!active||captureBusy.current)return;captureBusy.current=true;setBusy(true);setError("");try{
   const aligned=alignCfaRoi(image.spec,next);setRoi(aligned);
   let target=request;
   if(!target){target=await api<CropRequest>("/viewer/requests",{imageId:image.id,prompt:"사용자가 선택한 크롭 영역",show:false});setState(current=>({...current,requests:[...current.requests,target!]}));setSelected(target.id);}
   const updated=await api<CropRequest>(`/viewer/requests/${target.id}/crops`,{id:crypto.randomUUID(),roi:aligned});
   setState(current=>({...current,requests:current.requests.map(r=>r.id===updated.id?updated:r)}));await refresh();
 }catch(e){setError(String(e));}finally{captureBusy.current=false;setBusy(false);}}
 function finish(e:React.PointerEvent<HTMLCanvasElement>){const origin=start.current;start.current=null;if(!origin||!image)return;if(Math.hypot(e.clientX-origin.clientX,e.clientY-origin.clientY)<3)return;const p=point(e);void capture({x:Math.min(p.x,origin.x),y:Math.min(p.y,origin.y),width:Math.max(1,Math.abs(p.x-origin.x)),height:Math.max(1,Math.abs(p.y-origin.y))});}
 async function download(requestId:string,crop:CropResult,kind:string){try{const response=await fetch(`/api/viewer/requests/${requestId}/files/${kind}${crop.id?`?cropId=${crop.id}`:""}`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error("다운로드 실패");const url=URL.createObjectURL(await response.blob());const a=document.createElement("a");a.href=url;a.download=crop.paths[kind as keyof CropResult["paths"]]?.split("/").pop()||kind;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(String(e));}}
 return <section className="viewer work-board"><header className="viewer-toolbar"><h2>Image Viewer</h2><button onClick={onExpand}>Expand viewer</button><select disabled={busy} aria-label="Viewer image" value={image?.id||""} onChange={e=>{setSelected("");setImageId(e.target.value);}}><option value="">이미지 선택</option>{state.images.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select><select disabled={busy} aria-label="Crop request" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">크롭 요청 선택</option>{state.requests.slice().reverse().map(r=><option key={r.id} value={r.id}>{r.status} · {r.prompt.slice(0,65)}</option>)}</select></header>
 <details className="viewer-import" open={!state.images.length}><summary>Open image · BMP / PNG / JPEG / RAW</summary><input aria-label="Image file" type="file" accept=".bmp,.png,.jpg,.jpeg,.webp,.raw,.bin" onChange={e=>setFile(e.target.files?.[0]||null)}/><div className="viewer-fields">
 {(["width","height","bitDepth","offset","stride"] as const).map(key=><label key={key}>{({width:"Width",height:"Height",bitDepth:"Bit depth",offset:"Header bytes",stride:"Row stride (0 = auto)"})[key]}<input type="number" aria-label={`RAW ${key}`} value={spec[key]} onChange={e=>setSpec({...spec,[key]:Number(e.target.value)})}/></label>)}
 <label>RAW layout<select value={spec.group} onChange={e=>setSpec({...spec,group:Number(e.target.value)})}><option value={1}>Bayer (1×1)</option><option value={2}>Tetra (2×2)</option><option value={4}>TetraSquare (4×4)</option></select></label><label>Pixel order<select value={spec.pattern} onChange={e=>setSpec({...spec,pattern:e.target.value})}>{["RGGB","GRBG","GBRG","BGGR"].map(p=><option key={p}>{p}</option>)}</select></label><label>16bit LE alignment<select value={spec.alignment} onChange={e=>setSpec({...spec,alignment:e.target.value as Spec["alignment"]})}><option value="lsb">LSB aligned</option><option value="msb">MSB aligned</option></select></label><button disabled={busy||!file} onClick={upload}>Open image</button></div><small>RAW 설정은 헤더가 없는 16bit little-endian 컨테이너에 적용됩니다. RGB 파일은 크기를 자동으로 읽습니다.</small></details>
 {error&&<p role="alert">{error}</p>}
 {image&&<><div className="viewer-toolbar"><span>{image.spec.width} × {image.spec.height} · {image.spec.bitDepth}bit {image.spec.format==="raw"?`· ${image.spec.pattern} · group ${image.spec.group}`:"RGB"}</span><select aria-label="Preview mode" value={mode} onChange={e=>setMode(e.target.value)}><option value="color">Cell average</option><option value="gray">Grayscale</option>{image.spec.format==="raw"&&<><option value="cfa">Bayer / Tetra · CFA colors</option><option value="simple">Simple ISP · Demosaic + Gamma</option></>}</select>{mode==="simple"&&image.spec.format==="raw"&&<label>Gamma<input aria-label="Simple ISP gamma" type="number" min="0.1" max="5" step="0.1" value={gamma} onChange={e=>{const v=Number(e.target.value);if(v>=.1&&v<=5)setGamma(v);}}/></label>}{mode==="cfa"&&image.spec.format==="raw"&&<>{(["x","y"] as const).map(k=><label key={k}>View {k}<input type="number" min="0" max={(k==="x"?image.spec.width:image.spec.height)-1} value={viewOrigin[k]} onChange={e=>{const v=Number(e.target.value);if(Number.isInteger(v)&&v>=0&&v<(k==="x"?image.spec.width:image.spec.height))setViewOrigin(o=>({...o,[k]:v}));}}/></label>)}</>}<button onClick={()=>setZoom(z=>Math.max(.1,z/1.5))}>−</button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(z=>Math.min(8,z*1.5))}>+</button><button onClick={fitPreview}>Fit</button><details className="viewer-tone"><summary>표시 레벨</summary><div><label>Black<input type="number" value={levels.black} onChange={e=>setLevels({...levels,black:Number(e.target.value)})}/></label><label>White<input type="number" value={levels.white} onChange={e=>setLevels({...levels,white:Number(e.target.value)})}/></label><button onClick={()=>setDisplayLevels(levels)}>Apply preview</button></div></details></div>
 {request&&<div className="viewer-request"><strong>{request.status} · {request.prompt}</strong></div>}
 <div className="viewer-content"><div className="viewer-image-column"><div className="viewer-canvas" ref={viewport}>{preview?<canvas ref={canvas} aria-label="Crop selection canvas" width={preview.width} height={preview.height} style={{width:preview.width*zoom,height:preview.height*zoom}} onPointerDown={e=>{if(!active||busy||e.button!==0)return;start.current={...point(e),clientX:e.clientX,clientY:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={move} onPointerUp={finish} onLostPointerCapture={()=>{start.current=null;}} onPointerCancel={()=>{start.current=null;}}/>:<p>미리보기 준비 중…</p>}</div>
 <div className="viewer-toolbar viewer-roi">{(["x","y","width","height"] as const).map(key=><label key={key}>{key}<input disabled={!active||busy} aria-label={`Crop ${key}`} type="number" value={roi[key]} onChange={e=>setRoi({...roi,[key]:Number(e.target.value)})} onBlur={()=>alignSelection(roi)}/></label>)}<span>{image.spec.format==="raw"?`CFA alignment required · ${2*image.spec.group}×${2*image.spec.group}`:"RGB pixel selection"}</span>
 <button disabled={busy||!preview||!active} onClick={()=>void capture(roi)}>좌표로 영역 추가</button>{request?.status==="pending"&&<button disabled={busy} onClick={()=>action(`/viewer/requests/${request.id}/cancel`,{})}>Cancel request</button>}<small>{busy?"크롭 저장 중…":"드래그를 놓으면 오른쪽에 자동 추가됩니다."}</small></div></div>
 <aside className="viewer-crop-list" aria-label="크롭 목록"><h3>크롭 영역 <span>{cropItems.length}</span></h3>{!cropItems.length&&<p>이미지에서 드래그해 영역을 추가하세요. 여러 영역을 모으고 각각 설명을 남길 수 있습니다.</p>}{cropItems.map(({crop,requestId:owner},index)=><CropCard key={`${owner}:${crop.id||owner}`} crop={crop} requestId={owner} index={index} api={api} onSaved={refresh} onSelect={()=>{setRoi(crop.roi);if(mode==="cfa")setViewOrigin({x:crop.roi.x,y:crop.roi.y});}} onDownload={kind=>void download(owner,crop,kind)}/>)}</aside></div>
 <details className="viewer-help"><summary>좌표 / 미리보기 안내</summary>
 <small>좌표는 원본 픽셀 기준, 좌상단 (0, 0)입니다. CFA colors는 원본 픽셀의 R/G/B 채널만 표시합니다. 최대 1200×1200 원본 영역이며 View x/y로 이동합니다. Simple ISP는 동일 색 그룹 평균 → 보간 → 감마(기본 2.2) 미리보기이며 색 보정·화이트밸런스는 하지 않습니다. RAW 크롭 값은 변경하지 않습니다. RAW는 드래그와 숫자 입력 모두 완전한 CFA 셀로 정렬합니다. 숫자 입력은 포커스를 옮기면 정렬되며 가장자리의 불완전한 셀은 제외됩니다. end 좌표는 영역에 포함되지 않습니다.</small></details></>}
 {!image&&<div className="sdd-empty">이미지를 열거나 에이전트의 크롭 요청을 선택하세요.</div>}
 </section>;
}
