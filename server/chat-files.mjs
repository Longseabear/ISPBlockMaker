import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Read-only previews for file links in chat. Resolve real paths to reject junction escapes.
export async function readChatFile(workspace,source){
 if(typeof source!=='string'||!source||source.length>8192)throw Error('Invalid file path');
 let name=source.startsWith('file:')?fileURLToPath(source):source;
 try{name=decodeURIComponent(name);}catch{}
 const root=await fs.realpath(workspace),file=await fs.realpath(path.resolve(root,name));
 const relative=path.relative(root,file);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('워크스페이스 내부 파일만 열 수 있습니다.');
 const stat=await fs.stat(file);
 if(!stat.isFile()||stat.size>1024*1024)throw Error('미리보기는 1MB 이하 텍스트 파일을 지원합니다.');
 const bytes=await fs.readFile(file);if(bytes.includes(0))throw Error('바이너리 파일은 해당 뷰어에서 열어주세요.');
 return {path:relative,content:bytes.toString('utf8')};
}
