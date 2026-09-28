import {useEffect,useRef,useState,type RefObject} from 'react';
import {validPixelSamples,visiblePixelGrid,type PixelImage,type PixelPoint,type PixelPreview,type PixelSamples} from './viewer-pixels';
import './pixel-values.css';

type Props={image:PixelImage;preview:PixelPreview;zoom:number;offset:PixelPoint;viewportRef:RefObject<HTMLDivElement|null>;token:string;enabled:boolean};

/** An unscaled viewport canvas avoids creating an enormous canvas at high zoom. */
export function PixelValues({image,preview,zoom,offset,viewportRef,token,enabled}:Props){
  const canvas=useRef<HTMLCanvasElement>(null);
  const [viewport,setViewport]=useState({width:0,height:0});
  const [response,setResponse]=useState<{key:string;data?:PixelSamples;error?:string}|null>(null);
  useEffect(()=>{
    const element=viewportRef.current;if(!element)return;
    const measure=()=>setViewport(old=>old.width===element.clientWidth&&old.height===element.clientHeight?old:{width:element.clientWidth,height:element.clientHeight});
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[viewportRef]);
  const grid=enabled?visiblePixelGrid(image,preview,zoom,offset,viewport):null;
  const area=grid?.area;
  const key=area?`${image.id}:${area.x},${area.y},${area.width},${area.height}`:'';
  useEffect(()=>{
    if(!area||!key||!token){setResponse(null);return;}
    const controller=new AbortController();
    // Debounce camera movement. Every request contains at most 4,096 source samples.
    const timer=setTimeout(()=>{
      const query=new URLSearchParams(Object.entries(area).map(([name,value])=>[name,String(value)]));
      void fetch(`/api/viewer/images/${encodeURIComponent(image.id)}/pixels?${query}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
        .then(async result=>{
          const data:unknown=await result.json();
          if(!result.ok)throw new Error(typeof data==='object'&&data&&'error' in data?String(data.error):`Pixel values: HTTP ${result.status}`);
          if(!validPixelSamples(data,image,area))throw new Error('원본 픽셀 값 응답을 확인할 수 없습니다.');
          if(!controller.signal.aborted)setResponse({key,data});
        }).catch(error=>{if(!controller.signal.aborted)setResponse({key,error:String(error)});});
    },100);
    return()=>{clearTimeout(timer);controller.abort();};
  },[key,token]);
  const data=response?.key===key?response.data:undefined;
  const error=response?.key===key?response.error:undefined;
  useEffect(()=>{
    const element=canvas.current;if(!element)return;
    const scale=Math.min(window.devicePixelRatio||1,2,4096/Math.max(1,viewport.width),4096/Math.max(1,viewport.height),Math.sqrt(4_194_304/Math.max(1,viewport.width*viewport.height)));
    element.width=Math.max(1,Math.round(viewport.width*scale));element.height=Math.max(1,Math.round(viewport.height*scale));
    const ctx=element.getContext('2d');if(!ctx||!grid||!data)return;
    ctx.scale(element.width/viewport.width,element.height/viewport.height);
    const {cellWidth:cw,cellHeight:ch}=grid;
    const fontSize=data.channels===1?Math.max(9,Math.min(42,cw*.18,ch*.24)):Math.max(9,Math.min(32,cw/5.5,ch/4.7));
    ctx.font=`600 ${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=1;
    for(let row=0;row<data.area.height;row++)for(let col=0;col<data.area.width;col++){
      const sourceX=data.area.x+col,sourceY=data.area.y+row;
      const x=offset.x+(sourceX-preview.area.x)*cw,y=offset.y+(sourceY-preview.area.y)*ch;
      const centerX=x+cw/2,centerY=y+ch/2,index=(row*data.area.width+col)*data.channels;
      ctx.strokeStyle='rgba(238,246,250,.24)';ctx.strokeRect(x,y,cw,ch);
      const lines=data.channels===1?[String(data.values[index])]:data.values.slice(index,index+3).map(String);
      // RAW always shows one sensor sample, even in a color-rendered preview.
      // A small text shadow keeps white digits readable without covering the pixel.
      ctx.fillStyle='#ffffff';ctx.shadowColor='rgba(0,0,0,.7)';ctx.shadowBlur=2;
      for(let line=0;line<lines.length;line++){
        ctx.fillText(lines[line],centerX,centerY+(line-(lines.length-1)/2)*fontSize*1.2,cw-4);
      }
      ctx.shadowBlur=0;
    }
  },[data,viewport.width,viewport.height,grid?.cellWidth,grid?.cellHeight,offset.x,offset.y,preview.area.x,preview.area.y,image.spec]);
  if(!enabled)return null;
  return <><canvas ref={canvas} className="viewer-pixel-values" aria-hidden="true" style={{width:viewport.width,height:viewport.height,left:0,top:0,pointerEvents:'none'}}/>{grid&&<span className={`viewer-pixel-status ${error?'is-error':''}`} role="status">{error?'픽셀 값 읽기 실패':data?(image.spec.format==='raw'?'원본 RAW 값':'원본 RGB 값'):'픽셀 값 읽는 중…'}</span>}</>;
}
