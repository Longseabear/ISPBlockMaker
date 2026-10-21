export const imageInputError=value=>/does not support image input|image input.*not supported|does not support images/i.test(String(value||''));
export function recoverImageSession(chat){
 if(chat.busy)throw Error('실행을 중지한 뒤 세션을 복구하세요.');
 if(chat.provider!=='claude'||!imageInputError(chat.error))throw Error('이미지 입력 오류가 발생한 Claude 대화만 복구할 수 있습니다.');
 if(chat.threadId)chat.previousSessionIds=[...(chat.previousSessionIds||[]),chat.threadId].slice(-10);
 // Only prior user text is carried forward. Never replay SDK messages/tool results.
 chat.recoveryContext=chat.items.filter(i=>i.type==='userMessage').slice(-6).map(i=>String(i.text||'').replace(/data:image\/[^\s)"']+/gi,'[image omitted]').slice(0,2000)).join('\n').slice(-10000);
 chat.threadId=null;chat.runtimeOptions=null;chat.error='';chat.status='idle';chat.inputMode='text';
 chat.notice='이미지가 포함된 이전 엔진 세션을 분리했습니다. 화면 기록과 작업 파일은 유지됩니다. 최근 사용자 요청의 텍스트만 새 세션에 전달합니다. 다시 요청을 보내세요.';
}
export function denyImageRead(tool,input){return tool==='Read'&&/\.(png|jpe?g|webp|gif|bmp|tiff?|ico|avif|heic)(?:[?#].*)?$/i.test(String(input?.file_path||''));}
