import {z} from "zod";
import {deflateSync,crc32} from "node:zlib";
import {alignCfaRoi} from "./cfa-roi.mjs";

export const imageSpec = z.object({
  format:z.enum(["raw","bmp","rgba8"]), width:z.number().int().positive().max(65536).optional(),height:z.number().int().positive().max(65536).optional(),
  bitDepth:z.number().int().min(8).max(16).default(12),alignment:z.enum(["lsb","msb"]).default("lsb"),
  pattern:z.enum(["RGGB","GRBG","GBRG","BGGR"]).default("GRBG"),group:z.union([z.literal(1),z.literal(2),z.literal(4)]).default(1),
  offset:z.number().int().nonnegative().default(0),stride:z.number().int().nonnegative().default(0),
  originX:z.number().int().min(0).max(7).default(0),originY:z.number().int().min(0).max(7).default(0),
});
function dimensions(w,h){if(!w||!h||w<1||h<1||w>65536||h>65536||w*h>128*1024*1024)throw new Error("이미지 크기는 1–128M pixels, 축당 최대 65536 범위여야 합니다.");}
export function openImage(bytes,input){
  const spec=imageSpec.parse(input);
  let {width:w,height:h}=spec;
  let sample,rgba;
  if(spec.format==="bmp") {
    if(bytes.length<54||bytes.toString("ascii",0,2)!=="BM"||bytes.readUInt32LE(14)<40)throw new Error("지원하지 않는 BMP 헤더입니다.");
    w=bytes.readInt32LE(18);const signedHeight=bytes.readInt32LE(22);h=Math.abs(signedHeight);
    dimensions(w,h);if(w<0||bytes.readUInt16LE(26)!==1)throw new Error("잘못된 BMP 크기/planes입니다.");
    const bits=bytes.readUInt16LE(28),offset=bytes.readUInt32LE(10),stride=Math.ceil(w*bits/32)*4;
    if(![8,24,32].includes(bits)||bytes.readUInt32LE(30)!==0)throw new Error("BMP는 비압축 8bit palette 또는 24/32bit RGB만 지원합니다.");
    const paletteStart=14+bytes.readUInt32LE(14);
    if(offset<paletteStart||offset+stride*h>bytes.length)throw new Error("BMP 파일이 잘렸거나 pixel offset이 잘못됐습니다.");
    if(bits===8&&offset<paletteStart+4*(bytes.readUInt32LE(46)||256))throw new Error("BMP 팔레트가 잘못됐습니다.");
    rgba=(x,y)=>{const pos=offset+(signedHeight>0?h-1-y:y)*stride;const p=bits===8?paletteStart+bytes[pos+x]*4:pos+x*(bits/8);if(bits===8&&p+4>offset)throw new Error("잘못된 palette index");return [bytes[p+2],bytes[p+1],bytes[p],255];};
    spec.bitDepth=8;
  } else {
    dimensions(w,h);
    const pixelBytes=spec.format==="raw"?2:4;
    const stride=spec.stride||w*pixelBytes;
    if(stride<w*pixelBytes||spec.offset+stride*(h-1)+w*pixelBytes>bytes.length)throw new Error("크기·stride·offset에 비해 파일 데이터가 부족합니다.");
    spec.stride=stride;
    if(spec.format==="raw") sample=(x,y)=>{let v=bytes.readUInt16LE(spec.offset+y*stride+x*2);return spec.alignment==="msb"?v>>>(16-spec.bitDepth):v&((1<<spec.bitDepth)-1);};
    else {spec.bitDepth=8;rgba=(x,y)=>Array.from(bytes.subarray(spec.offset+y*stride+x*4,spec.offset+y*stride+x*4+4));}
  }
  return {bytes,spec:{...spec,width:w,height:h},sample,rgba};
}
export function channelAt(spec,x,y){return spec.pattern[(Math.floor((y+(spec.originY||0))/spec.group)%2)*2+Math.floor((x+(spec.originX||0))/spec.group)%2];}
export function encodePng(width,height,rgba){
  function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc]);}
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const scan=Buffer.alloc((width*4+1)*height);
  for(let y=0;y<height;y++)rgba.copy(scan,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(scan)),chunk("IEND",Buffer.alloc(0))]);
}
export function preview(image,{mode="color",black=0,white=(2**image.spec.bitDepth)-1,gamma=2.2,viewX=0,viewY=0,roi}={}){
  if(!Number.isFinite(black)||!Number.isFinite(white)||white<=black)throw new Error("White level은 black level보다 커야 합니다.");
  if(!["gray","color","cfa","simple"].includes(mode))throw new Error("잘못된 preview mode");
  if(!Number.isFinite(gamma)||gamma<0.1||gamma>5)throw new Error("Gamma는 0.1–5 범위여야 합니다.");
  const s=image.spec;
  let area=roi||{x:0,y:0,width:s.width,height:s.height};
  if(mode==="cfa"&&image.sample&&!roi){
    if(!Number.isInteger(viewX)||!Number.isInteger(viewY)||viewX<0||viewY<0||viewX>=s.width||viewY>=s.height)throw new Error("CFA view 좌표가 범위를 벗어났습니다.");
    area={x:viewX,y:viewY,width:Math.min(1200,s.width-viewX),height:Math.min(1200,s.height-viewY)};
  }
  const scale=Math.min(1,1200/Math.max(area.width,area.height));const w=Math.max(1,Math.round(area.width*scale)),h=Math.max(1,Math.round(area.height*scale));const out=Buffer.alloc(w*h*4);
  const level=v=>Math.round(Math.max(0,Math.min(1,(v-black)/(white-black)))*255);
  const groupCache=new Map();
  const groupValue=(gx,gy)=>{
    const key=gy*65544+gx;
    if(s.group>1&&groupCache.has(key))return groupCache.get(key);
    let sum=0,count=0;
    for(let yy=Math.max(0,gy*s.group-s.originY);yy<Math.min(s.height,(gy+1)*s.group-s.originY);yy++)
      for(let xx=Math.max(0,gx*s.group-s.originX);xx<Math.min(s.width,(gx+1)*s.group-s.originX);xx++){sum+=image.sample(xx,yy);count++;}
    const value=count?sum/count:0;
    if(s.group>1)groupCache.set(key,value);
    return value;
  };
  // Bilinear interpolation of the four CFA phase planes. Tetra groups are binned first.
  const plane=(sx,sy,px,py)=>{
    const gx=(sx+s.originX-(s.group-1)/2)/s.group,gy=(sy+s.originY-(s.group-1)/2)/s.group;
    const bx=px+2*Math.floor((gx-px)/2),by=py+2*Math.floor((gy-py)/2),tx=(gx-bx)/2,ty=(gy-by)/2;
    const maxX=Math.floor((s.width-1+s.originX)/s.group),maxY=Math.floor((s.height-1+s.originY)/s.group);
    const minX=Math.floor(s.originX/s.group),minY=Math.floor(s.originY/s.group);
    const clampPhase=(v,min,max,p)=>{const lo=min+((p-min%2+2)%2),hi=max-((max%2-p+2)%2);return hi<lo?null:Math.max(lo,Math.min(hi,v));};
    let result=0;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
      const x=clampPhase(bx+dx*2,minX,maxX,px),y=clampPhase(by+dy*2,minY,maxY,py);
      result+=(x===null||y===null?image.sample(sx,sy):groupValue(x,y))*(dx?tx:1-tx)*(dy?ty:1-ty);
    }
    return result;
  };
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const sx=area.x+Math.min(area.width-1,Math.floor(x/scale)),sy=area.y+Math.min(area.height-1,Math.floor(y/scale));let pixel;
    if(image.rgba)pixel=image.rgba(sx,sy);
    else if(mode==="gray"){const v=level(image.sample(sx,sy));pixel=[v,v,v,255];}
    else if(mode==="cfa") {const c=channelAt(s,sx,sy),v=level(image.sample(sx,sy));pixel=[c==="R"?v:0,c==="G"?v:0,c==="B"?v:0,255];}
    else if(mode==="simple") {
      const channels={R:0,G:0,B:0};
      for(let p=0;p<4;p++)channels[s.pattern[p]]+=plane(sx,sy,p%2,Math.floor(p/2))/(s.pattern[p]==="G"?2:1);
      const tone=v=>Math.round(255*Math.pow(Math.max(0,Math.min(1,(v-black)/(white-black))),1/gamma));
      pixel=[tone(channels.R),tone(channels.G),tone(channels.B),255];
    }
    else {
      // Preview only: average each same-colour group in the surrounding CFA cell.
      const period=2*s.group,bx=Math.floor((sx+s.originX)/period)*period-s.originX,by=Math.floor((sy+s.originY)/period)*period-s.originY;
      const sums={R:0,G:0,B:0},counts={R:0,G:0,B:0};
      for(let yy=Math.max(0,by);yy<Math.min(by+period,s.height);yy++)for(let xx=Math.max(0,bx);xx<Math.min(bx+period,s.width);xx++){const c=channelAt(s,xx,yy);sums[c]+=image.sample(xx,yy);counts[c]++;}
      pixel=[level(counts.R?sums.R/counts.R:image.sample(sx,sy)),level(counts.G?sums.G/counts.G:image.sample(sx,sy)),level(counts.B?sums.B/counts.B:image.sample(sx,sy)),255];
    }
    out.set(pixel,(y*w+x)*4);
  }
  return {width:w,height:h,area,png:encodePng(w,h,out)};
}
export function cropImage(image,roi){
  const s=image.spec;
  for(const key of ["x","y","width","height"])if(!Number.isInteger(roi[key]))throw new Error("ROI는 원본 픽셀 기준 정수여야 합니다.");
  if(roi.x<0||roi.y<0||roi.width<1||roi.height<1||roi.x+roi.width>s.width||roi.y+roi.height>s.height)throw new Error("ROI가 이미지 범위를 벗어났습니다.");
  if(s.format==="raw") {
    const aligned=alignCfaRoi(s,roi);
    if(["x","y","width","height"].some(key=>aligned[key]!==roi[key]))throw new Error(`RAW 크롭은 ${2*s.group}×${2*s.group} CFA 셀에 정렬해야 합니다. 시작점과 끝점에서 ${s.pattern} pixel order를 유지하세요.`);
    const bytes=Buffer.alloc(roi.width*roi.height*2);
    for(let y=0;y<roi.height;y++){const start=s.offset+(roi.y+y)*s.stride+roi.x*2;image.bytes.copy(bytes,y*roi.width*2,start,start+roi.width*2);}
    const originX=(s.originX+roi.x)%(2*s.group),originY=(s.originY+roi.y)%(2*s.group);
    return {bytes,extension:"raw",spec:{...s,width:roi.width,height:roi.height,stride:roi.width*2,offset:0,originX,originY,cfaOrigin:{x:originX,y:originY}}};
  }
  const bytes=Buffer.alloc(roi.width*roi.height*4);
  for(let y=0;y<roi.height;y++)for(let x=0;x<roi.width;x++)bytes.set(image.rgba(roi.x+x,roi.y+y),(y*roi.width+x)*4);
  return {bytes:encodePng(roi.width,roi.height,bytes),extension:"png",spec:{format:"png",width:roi.width,height:roi.height,bitDepth:8}};
}
