import {useEffect,useState} from 'react';
import type {Api} from './types';
export function ChatImage({src,alt,api}:{src?:string;alt?:string;api:Api}){
 const [url,setUrl]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let alive=true;setUrl('');setError('');
  if(!src){setError('이미지 경로가 없습니다.');return;}
  if(src.startsWith('/artifacts/')||/^https?:\/\//i.test(src))setUrl(src);
  else if(/^[a-z][a-z\d+.-]*:/i.test(src)&&!/^([a-z]:[\\/]|file:)/i.test(src))setError('지원하지 않는 이미지 주소입니다.');
  else void api<{url:string}>('/interaction/image',{path:src}).then(r=>{if(alive)setUrl(r.url);}).catch(()=>{if(alive)setError('이미지를 불러오지 못했습니다. 워크스페이스 내부의 PNG/JPEG/GIF/WebP/BMP 파일인지 확인하세요.');});
  return()=>{alive=false;};
 },[src,api]);
 if(error)return <span role="status" className="chat-image-error">{alt||'이미지'} — {error}</span>;
 return url?<img src={url} alt={alt||'이미지'} loading="lazy" style={{maxWidth:'100%',height:'auto'}} onError={()=>setError('이미지 주소에 접근할 수 없습니다.')}/>:<span>이미지 불러오는 중…</span>;
}
