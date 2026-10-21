import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Authenticated callers can display raster images inside this workspace only.
export function readChatImage(workspace,source){
 if(typeof source!=='string'||source.length>8192)throw Error('Invalid image path');
 let name=source;
 if(name.startsWith('file:'))name=fileURLToPath(name);
 else {try{name=decodeURIComponent(name);}catch{}}
 if(name.startsWith('/artifacts/'))throw Error('Use the registered artifact URL');
 const root=fs.realpathSync(workspace),file=fs.realpathSync(path.resolve(root,name));
 const relative=path.relative(root,file);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('워크스페이스 밖의 이미지는 Image Viewer로 가져와주세요.');
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>20*1024*1024)throw Error('이미지는 20MB 이하 파일이어야 합니다.');
 const b=fs.readFileSync(file);
 const mime=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':/^GIF8[79]a$/.test(b.subarray(0,6).toString())?'image/gif':b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'?'image/webp':b.subarray(0,2).toString()==='BM'?'image/bmp':null;
 if(!mime)throw Error('PNG, JPEG, GIF, WebP, BMP 이미지만 채팅에 표시할 수 있습니다.');
 return {url:`data:${mime};base64,${b.toString('base64')}`};
}
