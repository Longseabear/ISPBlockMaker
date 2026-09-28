import {useEffect,useRef,useState,type RefObject} from 'react';
import {visibleTiles,paddedTile} from './viewer-tiles';
import {createTileRenderer,type SensorSpec,type TileTexture} from './viewer-gl';
import type {Rect,Point} from './viewer-camera';
type Props={image:{id:string;spec:SensorSpec};preview:{width:number;height:number;area:Rect};zoom:number;offset:Point;viewportRef:RefObject<HTMLDivElement|null>;token:string;mode:string;black:number;white:number;gamma:number;active:boolean;cursor:Point|null;onReady:(ready:boolean)=>void};
export function NativeImage(p:Props){
 const canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<ReturnType<typeof createTileRenderer>|null>(null),cache=useRef(new Map<string,TileTexture>());
 const [size,setSize]=useState({width:0,height:0}),[revision,setRevision]=useState(0),[epoch,setEpoch]=useState(0),[error,setError]=useState('');
 const tiles=visibleTiles(p.preview.area,p.preview,p.zoom,p.offset,size),key=tiles.map(t=>`${t.x},${t.y}`).join(';');
 const needsNative=p.active&&tiles.length>0;
 const [probe,setProbe]=useState<{key:string;values:number[]}|null>(null);
 const probeKey=p.cursor?`${p.image.id}:${p.cursor.x},${p.cursor.y}`:'';
 useEffect(()=>{if(!probeKey||!p.cursor||!p.active)return;const controller=new AbortController(),point=p.cursor;
  const timer=setTimeout(()=>{void fetch(`/api/viewer/images/${p.image.id}/pixels?x=${point.x}&y=${point.y}&width=1&height=1`,{headers:{Authorization:`Bearer ${p.token}`},signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('Pixel unavailable');const data=await r.json();if(!controller.signal.aborted&&data.imageId===p.image.id&&data.area?.x===point.x&&data.area?.y===point.y&&Array.isArray(data.values)&&data.values.length===(p.image.spec.format==='raw'?1:3))setProbe({key:probeKey,values:data.values});}).catch(()=>{});},80);
  return()=>{clearTimeout(timer);controller.abort();};
 },[probeKey,p.active,p.token]);
 const probeText=p.cursor?` · (${p.cursor.x}, ${p.cursor.y}) ${probe?.key===probeKey?(p.image.spec.format==='raw'?probe.values[0]+' DN':probe.values.map((v,i)=>'RGB'[i]+':'+v).join(' ')):'…'}`:'';

 useEffect(()=>{const v=p.viewportRef.current;if(!v)return;const update=()=>setSize({width:v.clientWidth,height:v.clientHeight});update();const observer=new ResizeObserver(update);observer.observe(v);return()=>observer.disconnect();},[p.viewportRef]);
 useEffect(()=>{
  const c=canvas.current!;setError('');
  try{renderer.current=createTileRenderer(c);}catch(e){setError(String(e));}
  const lost=(e:Event)=>{e.preventDefault();setError('GPU 연결이 끊겼습니다. 복구 중…');p.onReady(false);};
  const restored=()=>setEpoch(v=>v+1);c.addEventListener('webglcontextlost',lost);c.addEventListener('webglcontextrestored',restored);setRevision(v=>v+1);
  return()=>{c.removeEventListener('webglcontextlost',lost);c.removeEventListener('webglcontextrestored',restored);for(const t of cache.current.values())renderer.current?.remove(t);cache.current.clear();renderer.current?.dispose();renderer.current=null;};
 },[p.image.id,p.token,epoch]);
 useEffect(()=>{
  if(!needsNative||!renderer.current)return;
  if(tiles.length>64){setError('원본 타일 범위가 큽니다. 조금 더 확대해 주세요.');return;}
  const controller=new AbortController(),wanted=new Set(tiles.map(t=>`${t.x},${t.y}`)),missing=tiles.filter(t=>!cache.current.has(`${t.x},${t.y}`));
  setError('');if(!missing.length)return;
  const timer=setTimeout(()=>{
   let next=0;
   const worker=async()=>{while(next<missing.length&&!controller.signal.aborted){const core=missing[next++],area=paddedTile(core,p.image.spec),id=`${core.x},${core.y}`;
    try{const query=new URLSearchParams(Object.entries(area).map(([k,v])=>[k,String(v)]));const response=await fetch(`/api/viewer/images/${p.image.id}/tile?${query}`,{headers:{Authorization:`Bearer ${p.token}`},signal:controller.signal});
     if(!response.ok)throw Error(response.status===404?'원본 타일 API가 없습니다. 서버를 재시작해 주세요.':`원본 타일 HTTP ${response.status}`);
     const metadata=JSON.parse(response.headers.get('X-Tile-Metadata')||'null'),raw=p.image.spec.format==='raw';
     if(!metadata||metadata.imageId!==p.image.id||metadata.encoding!==(raw?'r16le':'rgba8')||Object.entries(area).some(([k,v])=>metadata.area?.[k]!==v))throw Error('원본 타일 응답이 일치하지 않습니다.');
     const bytes=await response.arrayBuffer();if(controller.signal.aborted||!renderer.current)return;
     while(cache.current.size>=64){const victim=[...cache.current.keys()].find(k=>!wanted.has(k));if(!victim)break;renderer.current.remove(cache.current.get(victim)!);cache.current.delete(victim);}
     cache.current.set(id,renderer.current.upload(bytes,area,core,raw));setRevision(v=>v+1);
    }catch(e){if(!controller.signal.aborted)setError(String(e));}
   }};
   void Promise.all(Array.from({length:Math.min(4,missing.length)},worker));
  },80);
  return()=>{clearTimeout(timer);controller.abort();};
 },[key,needsNative,p.image.id,p.token,epoch]);
 useEffect(()=>{
  const ready=!needsNative||(!error&&tiles.length<=64&&tiles.every(t=>cache.current.has(`${t.x},${t.y}`)));
  try{renderer.current?.draw(needsNative?tiles.map(t=>cache.current.get(`${t.x},${t.y}`)).filter((t):t is TileTexture=>!!t):[],p.image.spec,{...size,offset:p.offset,scale:{x:p.preview.width/p.preview.area.width*p.zoom,y:p.preview.height/p.preview.area.height*p.zoom},mode:p.mode,black:p.black,white:p.white,gamma:p.gamma});p.onReady(ready&&(!needsNative||!!renderer.current));}
  catch(e){setError(String(e));p.onReady(false);}
 },[revision,key,needsNative,error,size,p.offset,p.zoom,p.mode,p.black,p.white,p.gamma]);
 const complete=tiles.every(t=>cache.current.has(`${t.x},${t.y}`));
 return <><canvas ref={canvas} className="viewer-native-image" aria-hidden="true" style={{position:'absolute',pointerEvents:'none',left:0,top:0,width:size.width,height:size.height,display:needsNative?'block':'none'}}/>{(needsNative||p.cursor)&&<span className="viewer-native-status" role="status" style={{position:'absolute',left:8,top:8,pointerEvents:'none',fontSize:12,color:error?'#ffc0b8':'#d3ffe8',background:'#14221cdd',padding:'3px 7px',borderRadius:4}}>{needsNative?(error||(!complete?'원본 타일 로딩 중 · 크롭 대기':'원본 픽셀 · WebGL2')):'전체 미리보기'}{probeText}{error&&<button style={{pointerEvents:'auto',marginLeft:6}} onClick={()=>setEpoch(v=>v+1)}>다시 시도</button>}</span>}</>;
}
