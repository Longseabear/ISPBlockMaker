export type PixelPoint={x:number;y:number};
export type PixelRect=PixelPoint&{width:number;height:number};
export type PixelImage={id:string;spec:{format:string;width:number;height:number;bitDepth:number;pattern?:string;group?:number;originX?:number;originY?:number}};
export type PixelPreview={width:number;height:number;area:PixelRect};
export type PixelGrid={area:PixelRect;cellWidth:number;cellHeight:number};
export type PixelSamples={imageId:string;area:PixelRect;channels:1|3;values:number[];sampleType:'raw'|'rgb'};

export const MAX_PIXEL_SAMPLES=4096;

/** Request physical source pixels, never pixels of the downsampled preview. */
export function visiblePixelGrid(image:PixelImage,preview:PixelPreview,zoom:number,offset:PixelPoint,viewport:{width:number;height:number}):PixelGrid|null {
  const {area}=preview;
  if(![image.spec.width,image.spec.height,preview.width,preview.height,area.width,area.height,zoom,viewport.width,viewport.height].every(v=>Number.isFinite(v)&&v>0)||![area.x,area.y,offset.x,offset.y].every(Number.isFinite))return null;
  const cellWidth=preview.width*zoom/area.width,cellHeight=preview.height*zoom/area.height;
  const digits=Math.ceil(Math.max(1,image.spec.bitDepth)*Math.LOG10E*Math.LN2);
  const minimum=image.spec.format==='raw'?Math.max(24,digits*5.5+4):38;
  if(Math.min(cellWidth,cellHeight)<minimum)return null;
  const left=Math.max(0,area.x,area.x-offset.x/cellWidth),top=Math.max(0,area.y,area.y-offset.y/cellHeight);
  const right=Math.min(image.spec.width,area.x+area.width,area.x+(viewport.width-offset.x)/cellWidth);
  const bottom=Math.min(image.spec.height,area.y+area.height,area.y+(viewport.height-offset.y)/cellHeight);
  if(right<=left||bottom<=top)return null;
  const x=Math.floor(left),y=Math.floor(top),width=Math.ceil(right)-x,height=Math.ceil(bottom)-y;
  if(width*height>MAX_PIXEL_SAMPLES)return null;
  return{area:{x,y,width,height},cellWidth,cellHeight};
}

export function cfaPixelChannel(spec:PixelImage['spec'],x:number,y:number):'R'|'G'|'B'|null {
  const group=spec.group||1,pattern=spec.pattern||'';
  const row=Math.floor((y+(spec.originY||0))/group)%2,col=Math.floor((x+(spec.originX||0))/group)%2;
  const channel=pattern[row*2+col];
  return channel==='R'||channel==='G'||channel==='B'?channel:null;
}

/** Reject mismatched/stale or oversized payloads before allocating a draw grid. */
export function validPixelSamples(value:unknown,image:PixelImage,area:PixelRect):value is PixelSamples {
  if(!value||typeof value!=='object')return false;
  const data=value as PixelSamples,channels=image.spec.format==='raw'?1:3;
  return data.imageId===image.id&&data.channels===channels&&data.sampleType===(channels===1?'raw':'rgb')&&
    !!data.area&&(['x','y','width','height'] as const).every(key=>data.area[key]===area[key])&&
    area.width*area.height<=MAX_PIXEL_SAMPLES&&Array.isArray(data.values)&&data.values.length===area.width*area.height*channels&&
    data.values.every(v=>Number.isInteger(v)&&v>=0&&v<=(channels===1?2**image.spec.bitDepth-1:255));
}
