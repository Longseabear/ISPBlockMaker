import type {Rect} from './viewer-camera';
export type SensorSpec={format:string;width:number;height:number;group:number;pattern:string;originX?:number;originY?:number};
export type TileTexture={texture:WebGLTexture;area:Rect;core:Rect;raw:boolean};
const fragment=`#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D rawImage;
uniform sampler2D rgbImage;
uniform vec2 canvasSize,ratio,offset,scale;
uniform ivec2 tileOrigin,sourceSize,phase;
uniform ivec4 core;
uniform ivec4 pattern;
uniform int groupSize,mode,isRaw;
uniform float blackLevel,whiteLevel,gammaValue;
out vec4 color;
float sampleAt(ivec2 p){p=clamp(p,ivec2(0),sourceSize-1);return float(texelFetch(rawImage,p-tileOrigin,0).r);}
int channel(ivec2 p){ivec2 g=(p+phase)/groupSize;return pattern[(g.y%2)*2+g.x%2];}
float level(float v){return clamp((v-blackLevel)/(whiteLevel-blackLevel),0.0,1.0);}
float groupAt(ivec2 g){float sum=0.0,count=0.0;ivec2 start=g*groupSize-phase;
 for(int y=0;y<4;y++)for(int x=0;x<4;x++){ivec2 p=start+ivec2(x,y);if(x<groupSize&&y<groupSize&&all(greaterThanEqual(p,ivec2(0)))&&all(lessThan(p,sourceSize))){sum+=sampleAt(p);count+=1.0;}}
 return count>0.0?sum/count:0.0;
}
float planeAt(ivec2 p,ivec2 parity){
 vec2 g=(vec2(p+phase)-float(groupSize-1)/2.0)/float(groupSize);
 ivec2 base=parity+2*ivec2(floor((g-vec2(parity))/2.0));vec2 t=(g-vec2(base))/2.0;
 ivec2 mn=phase/groupSize,mx=(sourceSize-1+phase)/groupSize;
 ivec2 lo=mn+((parity-mn%2+2)%2),hi=mx-((mx%2-parity+2)%2);float result=0.0;
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 q=clamp(base+ivec2(x,y)*2,lo,max(lo,hi));float v=any(lessThan(hi,lo))?sampleAt(p):groupAt(q);result+=v*(x==0?1.0-t.x:t.x)*(y==0?1.0-t.y:t.y);}return result;
}
void main(){
 vec2 screen=vec2(gl_FragCoord.x,canvasSize.y-gl_FragCoord.y)/ratio;
 ivec2 p=ivec2(floor((screen-offset)/scale));
 if(any(lessThan(p,core.xy))||any(greaterThanEqual(p,core.xy+core.zw)))discard;
 if(isRaw==0){color=texelFetch(rgbImage,p-tileOrigin,0);return;}
 vec3 value=vec3(0.0);
 if(mode==0){value[channel(p)]=level(sampleAt(p));}
 else if(mode==1){value=vec3(level(sampleAt(p)));}
 else if(mode==3){for(int i=0;i<4;i++){int c=pattern[i];value[c]+=planeAt(p,ivec2(i%2,i/2))/(c==1?2.0:1.0);}value=pow(clamp((value-vec3(blackLevel))/(whiteLevel-blackLevel),0.0,1.0),vec3(1.0/gammaValue));}
 else {ivec2 start=((p+phase)/(groupSize*2))*(groupSize*2)-phase;vec3 counts=vec3(0.0);
  for(int y=0;y<8;y++)for(int x=0;x<8;x++){ivec2 q=start+ivec2(x,y);if(x<groupSize*2&&y<groupSize*2&&all(greaterThanEqual(q,ivec2(0)))&&all(lessThan(q,sourceSize))){int c=channel(q);value[c]+=sampleAt(q);counts[c]+=1.0;}}
  for(int c=0;c<3;c++)value[c]=level(counts[c]>0.0?value[c]/counts[c]:sampleAt(p));
 }
 color=vec4(value,1.0);
}`;
export function createTileRenderer(canvas:HTMLCanvasElement){
 const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,preserveDrawingBuffer:true,premultipliedAlpha:false});
 if(!gl)throw Error('WebGL2를 사용할 수 없습니다. 정확한 확대를 위해 브라우저 GPU 설정을 확인하세요.');
 const shaders:WebGLShader[]=[];
 const compile=(kind:number,source:string)=>{const shader=gl.createShader(kind)!;shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)||'Shader compile failed');return shader;};
 const program=gl.createProgram()!;
 try{gl.attachShader(program,compile(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}'));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)||'Shader link failed');}
 catch(e){gl.deleteProgram(program);shaders.forEach(s=>gl.deleteShader(s));throw e;}
 shaders.forEach(s=>gl.deleteShader(s));const vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.useProgram(program);gl.disable(gl.DITHER);gl.disable(gl.BLEND);
 const location=(name:string)=>gl.getUniformLocation(program,name);
 gl.uniform1i(location('rawImage'),0);gl.uniform1i(location('rgbImage'),1);
 const texture=(raw:boolean,width:number,height:number,data:Uint16Array|Uint8Array)=>{const t=gl.createTexture()!;gl.activeTexture(raw?gl.TEXTURE0:gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,raw?gl.R16UI:gl.RGBA8,width,height,0,raw?gl.RED_INTEGER:gl.RGBA,raw?gl.UNSIGNED_SHORT:gl.UNSIGNED_BYTE,data);return t;};
 const dummyRaw=texture(true,1,1,new Uint16Array(1)),dummyRgb=texture(false,1,1,new Uint8Array(4));
 return {
  upload(bytes:ArrayBuffer,area:Rect,core:Rect,raw:boolean):TileTexture{
   if(bytes.byteLength!==area.width*area.height*(raw?2:4))throw Error('Invalid tile byte count');
   let data:Uint16Array|Uint8Array=new Uint8Array(bytes);
   if(raw){const words=new Uint16Array(bytes.byteLength/2),view=new DataView(bytes);for(let i=0;i<words.length;i++)words[i]=view.getUint16(i*2,true);data=words;}
   return{texture:texture(raw,area.width,area.height,data),area,core,raw};
  },
  draw(tiles:TileTexture[],spec:SensorSpec,view:{width:number;height:number;offset:{x:number;y:number};scale:{x:number;y:number};mode:string;black:number;white:number;gamma:number}){
   if(gl.isContextLost())throw Error('WebGL context lost');
   const dpr=Math.min(window.devicePixelRatio||1,2,4096/Math.max(1,view.width,view.height));
   const w=Math.max(1,Math.round(view.width*dpr)),h=Math.max(1,Math.round(view.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
   gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);gl.bindVertexArray(vao);
   gl.uniform2f(location('canvasSize'),w,h);gl.uniform2f(location('ratio'),w/view.width,h/view.height);gl.uniform2f(location('offset'),view.offset.x,view.offset.y);gl.uniform2f(location('scale'),view.scale.x,view.scale.y);
   gl.uniform2i(location('sourceSize'),spec.width,spec.height);gl.uniform2i(location('phase'),spec.originX||0,spec.originY||0);gl.uniform1i(location('groupSize'),spec.group||1);gl.uniform4iv(location('pattern'),new Int32Array([...spec.pattern].map(c=>'RGB'.indexOf(c))));
   gl.uniform1i(location('mode'),({cfa:0,gray:1,color:2,simple:3} as Record<string,number>)[view.mode]);gl.uniform1f(location('blackLevel'),view.black);gl.uniform1f(location('whiteLevel'),view.white);gl.uniform1f(location('gammaValue'),view.gamma);
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,dummyRaw);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,dummyRgb);
   gl.enable(gl.SCISSOR_TEST);
   for(const t of tiles){
    const left=Math.max(0,Math.floor((view.offset.x+t.core.x*view.scale.x)*w/view.width)),right=Math.min(w,Math.ceil((view.offset.x+(t.core.x+t.core.width)*view.scale.x)*w/view.width));
    const top=Math.max(0,Math.floor((view.offset.y+t.core.y*view.scale.y)*h/view.height)),bottom=Math.min(h,Math.ceil((view.offset.y+(t.core.y+t.core.height)*view.scale.y)*h/view.height));
    if(right<=left||bottom<=top)continue;gl.scissor(left,h-bottom,right-left,bottom-top);
    gl.activeTexture(t.raw?gl.TEXTURE0:gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,t.texture);gl.uniform1i(location('isRaw'),t.raw?1:0);gl.uniform2i(location('tileOrigin'),t.area.x,t.area.y);gl.uniform4i(location('core'),t.core.x,t.core.y,t.core.width,t.core.height);gl.drawArrays(gl.TRIANGLES,0,3);
   }
   gl.disable(gl.SCISSOR_TEST);
   if(gl.getError()!==gl.NO_ERROR)throw Error('GPU tile rendering failed');
  },
  remove(tile:TileTexture){gl.deleteTexture(tile.texture);},
  dispose(){gl.deleteTexture(dummyRaw);gl.deleteTexture(dummyRgb);gl.deleteVertexArray(vao);gl.deleteProgram(program);}
 };
}
