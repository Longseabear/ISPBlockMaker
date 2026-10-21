import crypto from 'node:crypto';
export class ClaudePrompts {
 constructor(requests){this.requests=requests;this.pending=new Map();}
 ask(chat,tool,input,{signal}={}){
  if(signal?.aborted)return Promise.resolve({behavior:'deny',message:'Request cancelled',interrupt:true});
  const id=crypto.randomUUID(),questions=tool==='AskUserQuestion'?(input.questions||[]).map((q,i)=>({...q,id:String(i)})):undefined;
  return new Promise(resolve=>{
   const finish=result=>{signal?.removeEventListener('abort',abort);this.requests.delete(id);this.pending.delete(id);resolve(result);};
   const abort=()=>finish({behavior:'deny',message:'Request cancelled',interrupt:true});
   this.pending.set(id,{chatId:chat.id,input,questions,finish});
   this.requests.set(id,{id,provider:'claude',method:questions?'claude/requestUserInput':'claude/requestApproval',params:{chatId:chat.id,threadId:chat.threadId,tool,cwd:chat.workspace,reason:`Claude Code · ${tool}`,input:questions?undefined:input,questions,availableDecisions:['accept','decline','cancel']}});
   signal?.addEventListener('abort',abort,{once:true});
  });
 }
 answer({id,decision,answers}){
  const p=this.pending.get(String(id));if(!p)throw Error('이미 처리되었거나 만료된 요청입니다.');
  if(decision==='decline'||decision==='cancel'){p.finish({behavior:'deny',message:'User declined',...(decision==='cancel'?{interrupt:true}:{})});return;}
  if(p.questions){
   if(!answers||p.questions.some(q=>!answers[q.id]?.length||answers[q.id].some(v=>!v.trim())))throw Error('모든 질문에 답변하세요.');
   if(p.questions.some(q=>!q.multiSelect&&answers[q.id].length!==1))throw Error('이 질문은 한 개의 답변만 선택할 수 있습니다.');
   const values=Object.fromEntries(p.questions.map(q=>[q.question,answers[q.id].join(', ')]));
   p.finish({behavior:'allow',updatedInput:{...p.input,answers:values}});
  }else{if(decision!=='accept')throw Error('승인 또는 거절을 선택하세요.');p.finish({behavior:'allow',updatedInput:p.input});}
 }
 cancelChat(chatId){for(const p of [...this.pending.values()])if(p.chatId===chatId)p.finish({behavior:'deny',message:'Session ended',interrupt:true});}
}
