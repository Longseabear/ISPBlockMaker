import {useEffect,useState} from 'react';
import {ImageLightbox} from '@/modules/chat/transcript/ChatMessageImages';
import {request} from './bridge';
// Displaying a workspace image never sends image bytes to the language model.
export function MarkdownImage({src,alt}:{src?:string;alt?:string}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[open,setOpen]=useState(false);
 useEffect(()=>{let alive=true;setUrl('');setError('');if(!src)return;
  if(/^https?:\/\//i.test(src)||src.startsWith('/artifacts/'))setUrl(src);
  else void request('image',{path:src}).then(result=>{if(alive)setUrl(result.url);}).catch(e=>{if(alive)setError(e.message);});
  return()=>{alive=false;};
 },[src]);
 if(error)return <span role="alert">{alt||'이미지'}: {error}</span>;
 return <>{url?<img src={url} alt={alt||'이미지'} role="button" tabIndex={0} className="max-w-full cursor-zoom-in rounded-lg" onClick={()=>setOpen(true)} onKeyDown={e=>{if(e.key==='Enter')setOpen(true);}}/>:<span>이미지 불러오는 중…</span>}{open&&<ImageLightbox src={url} alt={alt||'이미지'} onClose={()=>setOpen(false)}/>}</>;
}
