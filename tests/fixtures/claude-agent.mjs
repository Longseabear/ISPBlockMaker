import fs from 'node:fs';
const args=process.argv.slice(2);
if(args.includes('--settings')||args.includes('--model')||args.includes('--permission-mode')||args.includes('--bare'))throw Error('Settings overridden');
const config=JSON.parse(fs.readFileSync('.claude/settings.json','utf8'));
let prompt='';process.stdin.on('data',d=>prompt+=d);process.stdin.on('end',()=>{
 const emit=o=>process.stdout.write(JSON.stringify(o)+'\n');
 emit({type:'system',session_id:'test-claude'});
 emit({type:'stream_event',event:{type:'message_start',message:{id:'answer'}}});
 emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'partial'}}});
 emit({type:'assistant',message:{id:'answer',content:[{type:'text',text:config.model+':'+prompt+':'+args.includes('--resume')}]}});
 emit({type:'result',is_error:false,permission_denials:[{tool_name:'Bash'}]});
});
