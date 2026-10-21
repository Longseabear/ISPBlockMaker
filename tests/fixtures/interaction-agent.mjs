import {createInterface} from 'node:readline';
const emit=o=>process.stdout.write(JSON.stringify(o)+'\n');
let thread='test-thread',turn=0;
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line),p=m.params||{},ok=result=>emit({id:m.id,result});
 if(m.method==='initialize')ok({});
 else if(m.method==='account/read')ok({account:{type:'chatgpt'}});
 else if(m.method==='model/list')ok({data:[{id:'test',model:'test',displayName:'Test'}]});
 else if(['thread/start','thread/resume'].includes(m.method)){if(p.sandbox!=='workspace-write'||p.approvalPolicy!=='on-request')throw Error('Unsafe policy');ok({thread:{id:thread}});}
 else if(m.method==='turn/start'){
  turn++;const text=p.input[0].text;ok({turn:{id:String(turn)}});
  emit({method:'turn/started',params:{threadId:thread,turn:{id:String(turn)}}});
  if(text==='approve'){emit({id:900,method:'item/commandExecution/requestApproval',params:{threadId:thread,turnId:String(turn),command:'echo test',availableDecisions:['accept','decline','cancel']}});return;}
  if(text==='wait')return;
  emit({method:'item/agentMessage/delta',params:{threadId:thread,itemId:'a'+turn,delta:'Hello '}});emit({method:'item/agentMessage/delta',params:{threadId:thread,itemId:'a'+turn,delta:'world'}});
  emit({method:'item/completed',params:{threadId:thread,item:{id:'a'+turn,type:'agentMessage',text:'Hello world'}}});
  emit({method:'turn/completed',params:{threadId:thread,turn:{id:String(turn),status:'completed'}}});
 }
 else if(m.method==='turn/interrupt'){ok({});emit({method:'turn/completed',params:{threadId:thread,turn:{id:String(turn),status:'interrupted'}}});}
 else if(m.id===900&&m.result){emit({method:'serverRequest/resolved',params:{threadId:thread,requestId:900}});emit({method:'turn/completed',params:{threadId:thread,turn:{id:String(turn),status:'completed'}}});}
});
