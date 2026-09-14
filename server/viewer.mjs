import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import {z} from "zod";
import {openImage,preview,cropImage} from "./viewer-image.mjs";

export function installViewer(app,{current,present}) {
  const id=value=>z.string().uuid().parse(value);
  const folder=()=>path.join(current().workspace,".isp","viewer");
  const read=name=>{const file=path.join(folder(),name+".json");return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):[];};
  const write=(name,value)=>{fs.mkdirSync(folder(),{recursive:true});const file=path.join(folder(),name+".json");fs.writeFileSync(file+".tmp",JSON.stringify(value));fs.renameSync(file+".tmp",file);};
  const findImage=value=>{const image=read("images").find(i=>i.id===id(value));if(!image)throw new Error("이미지를 찾을 수 없습니다.");return image;};
  const load=image=>openImage(fs.readFileSync(path.join(folder(),image.id+".bin")),image.spec);
  const register=(bytes,input)=>{
    if(!bytes.length||bytes.length>256*1024*1024)throw new Error("이미지는 최대 256MB입니다.");
    const images=read("images");if(images.length>=200)throw new Error("Viewer 이미지 한도(200개)에 도달했습니다.");
    const decoded=openImage(bytes,input.spec);
    const image={id:crypto.randomUUID(),name:z.string().min(1).max(200).parse(input.name),spec:decoded.spec,sha256:crypto.createHash("sha256").update(bytes).digest("hex"),createdAt:new Date().toISOString()};
    fs.mkdirSync(folder(),{recursive:true});fs.writeFileSync(path.join(folder(),image.id+".bin"),bytes);
    write("images",[...images,image]);return image;
  };
  const findRequest=value=>{const request=read("requests").find(r=>r.id===id(value));if(!request)throw new Error("크롭 요청을 찾을 수 없습니다.");return request;};
  app.get("/api/viewer",(req,res)=>res.json({images:read("images"),requests:read("requests")}));
  app.post("/api/viewer/images",express.raw({type:"application/octet-stream",limit:"256mb"}),(req,res)=>{
    const input=JSON.parse(decodeURIComponent(req.headers["x-image-metadata"]||"{}"));
    if(!Buffer.isBuffer(req.body))throw new Error("이미지 바이너리가 필요합니다.");
    res.status(201).json(register(req.body,input));
  });
  app.post("/api/viewer/images/import",(req,res)=>{
    const workspace=fs.realpathSync(current().workspace);
    const file=fs.realpathSync(path.resolve(workspace,z.string().min(1).parse(req.body.path)));
    const relative=path.relative(workspace,file);
    if(relative.startsWith(".."+path.sep)||relative===".."||path.isAbsolute(relative))throw new Error("에이전트 파일은 현재 workspace 안에 있어야 합니다. 외부 파일은 Viewer에서 업로드하세요.");
    if(!fs.statSync(file).isFile()||fs.statSync(file).size>256*1024*1024)throw new Error("파일 크기/형식을 확인하세요.");
    res.status(201).json(register(fs.readFileSync(file),{name:req.body.name||path.basename(file),spec:req.body.spec}));
  });
  app.get("/api/viewer/images/:id/preview",(req,res)=>{
    const image=findImage(req.params.id);
    const mode=z.enum(["gray","color","cfa","simple"]).parse(req.query.mode||"color");
    const output=preview(load(image),{mode,gamma:Number(req.query.gamma??2.2),viewX:Number(req.query.viewX??0),viewY:Number(req.query.viewY??0),black:Number(req.query.black||0),white:req.query.white===undefined?2**image.spec.bitDepth-1:Number(req.query.white)});
    res.json({width:output.width,height:output.height,area:output.area,url:"data:image/png;base64,"+output.png.toString("base64")});
  });
  app.post("/api/viewer/requests",(req,res)=>{
    const input=z.object({imageId:z.string().uuid(),prompt:z.string().min(1).max(4000),blockId:z.string().optional(),show:z.boolean().default(true)}).parse(req.body);
    findImage(input.imageId);
    if(input.blockId&&!current().state.blocks.some(b=>b.id===input.blockId))throw new Error("블록을 찾을 수 없습니다.");
    const requests=read("requests");if(requests.length>=1000)throw new Error("크롭 요청 한도(1000개)에 도달했습니다.");
    const request={...input,id:crypto.randomUUID(),status:"pending",createdAt:new Date().toISOString(),revision:current().state.revision};
    write("requests",[...requests,request]);
    res.status(201).json({...request,delivered:input.show?present(request.id,input.prompt):0});
  });
  app.get("/api/viewer/requests/:id",(req,res)=>res.json(findRequest(req.params.id)));
  app.get("/api/viewer/requests/:id/files/:kind",(req,res)=>{
    const request=findRequest(req.params.id),kind=z.enum(["crop","preview","metadata"]).parse(req.params.kind);
    if(!request.result)throw new Error("아직 제출된 크롭이 없습니다.");
    const file=path.resolve(current().workspace,request.result.paths[kind]);
    if(!file.startsWith(path.join(folder(),"results",request.id)+path.sep))throw new Error("잘못된 결과 경로입니다.");
    res.download(file,path.basename(file),{dotfiles:"allow"});
  });
  app.post("/api/viewer/requests/:id/show",(req,res)=>{const request=findRequest(req.params.id);res.json({delivered:present(request.id,request.prompt)});});
  app.post("/api/viewer/requests/:id/cancel",(req,res)=>{
    const request=findRequest(req.params.id);if(request.status!=="pending")return res.status(409).json({error:"이미 완료된 요청입니다."});
    request.status="cancelled";request.completedAt=new Date().toISOString();write("requests",read("requests").map(r=>r.id===request.id?request:r));res.json(request);
  });
  app.post("/api/viewer/requests/:id/submit",(req,res)=>{
    const request=findRequest(req.params.id);if(request.status!=="pending")return res.status(409).json({error:"이미 완료된 요청입니다. 새 크롭 요청을 만드세요."});
    const image=findImage(request.imageId),decoded=load(image);
    const roi=z.object({x:z.number().int(),y:z.number().int(),width:z.number().int(),height:z.number().int()}).parse(req.body);
    const crop=cropImage(decoded,roi),resultDir=path.join(folder(),"results",request.id);
    fs.mkdirSync(resultDir,{recursive:true});
    const local=file=>path.relative(current().workspace,path.join(resultDir,file)).split(path.sep).join("/");
    const result={roi,coordinateSystem:"zero-based source pixels; x/y inclusive; x+width/y+height exclusive",source:{imageId:image.id,sha256:image.sha256,spec:image.spec},output:crop.spec,paths:{crop:local("crop."+crop.extension),preview:local("preview.png"),metadata:local("metadata.json")},sha256:crypto.createHash("sha256").update(crop.bytes).digest("hex")};
    fs.writeFileSync(path.join(resultDir,"crop."+crop.extension),crop.bytes);
    fs.writeFileSync(path.join(resultDir,"preview.png"),preview(decoded,{roi}).png);
    fs.writeFileSync(path.join(resultDir,"metadata.json"),JSON.stringify(result,null,2));
    request.status="submitted";request.completedAt=new Date().toISOString();request.result=result;
    write("requests",read("requests").map(r=>r.id===request.id?request:r));res.json(request);
  });
}
