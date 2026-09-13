export type GpuSync={status:"unrecorded"|"unavailable"|"changed"|"match";details:string[]};
export type GpuExtension={sync?:GpuSync;id:string;name:string;description:string;fragment:string;hash?:string;file?:string;blockId?:string;parameters:{name:string;label:string;min:number;max:number;step:number;default:number;blockId?:string;parameter?:string}[]};
export const builtin:GpuExtension={id:'builtin-preview',name:'Image adjustment · 기본 미리보기',description:'WebGL2 RGBA8 이미지 미리보기. 현재 그래프의 자동 실행이 아닙니다. 프로젝트 확장을 선택하면 해당 GPU 구현을 사용합니다.',parameters:[{name:'gain',label:'Gain',min:0,max:3,step:.01,default:1},{name:'gamma',label:'Gamma',min:.1,max:3,step:.01,default:1}],fragment:`#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float gain;
uniform float gamma;
out vec4 color;
void main(){vec3 c=texelFetch(u_image,ivec2(gl_FragCoord.xy),0).rgb;color=vec4(pow(clamp(c*gain,0.0,1.0),vec3(1.0/gamma)),1.0);}`};
export function renderGpu(canvas:HTMLCanvasElement,input:HTMLCanvasElement,extension:GpuExtension,values:Record<string,number>){
 const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true,antialias:false});if(!gl)throw new Error('WebGL2를 사용할 수 없습니다. 브라우저 GPU 지원을 확인하세요.');if(gl.isContextLost())throw new Error('GPU context가 손실되었습니다. 탭을 다시 여세요.');
 canvas.width=input.width;canvas.height=input.height;
 const shaders:WebGLShader[]=[];let program:WebGLProgram|null=null,texture:WebGLTexture|null=null,vao:WebGLVertexArrayObject|null=null;
 try{
 const compile=(type:number,source:string)=>{const s=gl.createShader(type)!;shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'Shader compile failed');return s;};
 const vertex=compile(gl.VERTEX_SHADER,`#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`),fragment=compile(gl.FRAGMENT_SHADER,extension.fragment);
 program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Shader link failed');gl.useProgram(program);
 vao=gl.createVertexArray();gl.bindVertexArray(vao);texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,input);
 gl.uniform1i(gl.getUniformLocation(program,'u_image'),0);gl.uniform2f(gl.getUniformLocation(program,'u_resolution'),input.width,input.height);for(const p of extension.parameters)gl.uniform1f(gl.getUniformLocation(program,p.name),values[p.name]??p.default);
 gl.viewport(0,0,input.width,input.height);gl.disable(gl.DITHER);gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(input.width*input.height*4);gl.readPixels(0,0,input.width,input.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.getError()!==gl.NO_ERROR)throw new Error('GPU 처리 중 오류가 발생했습니다.');return pixels;
 }finally{if(texture)gl.deleteTexture(texture);if(program)gl.deleteProgram(program);if(vao)gl.deleteVertexArray(vao);shaders.forEach(s=>gl.deleteShader(s));}
}
export function synthetic(){const c=document.createElement('canvas');c.width=384;c.height=256;const ctx=c.getContext('2d')!,data=ctx.createImageData(c.width,c.height);let seed=12345;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const v=Math.round(255*Math.max(0,Math.min(1,(x<c.width/2?.25:.7)+((seed/4294967296)-.5)*.16)));const i=(y*c.width+x)*4;data.data.set([v,v,v,255],i);}ctx.putImageData(data,0,0);return c;}
