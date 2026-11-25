import {useEffect,useRef,useState} from 'react';
type Mode='windows'|'unix';
const read=(id:string):Mode=>{try{return localStorage.getItem('isp-terminal-keyboard:'+id)==='unix'?'unix':'windows';}catch{return 'windows';}};
export function useTerminalKeyboard(id:string){
 const [mode,setMode]=useState<Mode>(()=>read(id));
 const current=useRef(mode);current.current=mode;
 useEffect(()=>setMode(read(id)),[id]);
 return {mode,change:(value:string)=>{const next:Mode=value==='unix'?'unix':'windows';setMode(next);current.current=next;try{localStorage.setItem('isp-terminal-keyboard:'+id,next);}catch{}},deleteWord:()=>current.current==='unix'?'\u0017':'\b'};
}
