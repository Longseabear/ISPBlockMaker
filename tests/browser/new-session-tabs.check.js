async page => {
 const chats=[],calls=[];
 await page.route('**/api/interaction/events',route=>route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({state:{connected:false,preferredProvider:'codex',account:null,models:[],requests:[],chats,error:''},updates:[]})+'\n\n'}));
 await page.route('**/api/interaction/send',async route=>{
  const body=route.request().postDataJSON();calls.push(body);
  const id=body.chatId||('session-'+(calls.length));if(!body.chatId)chats.push({id,title:body.text,items:[],provider:'codex',blockId:'',busy:false,status:'completed'});
  await route.fulfill({json:{id}});
 });
 await page.reload();await page.getByRole('button',{name:'Interaction mode'}).click();
 const tabs=page.locator('.open-chat-tabs>div'), visible=page.locator('.conversation-pane:visible'),input=()=>visible.locator('iframe').contentFrame().locator('textarea');
 const add=page.getByRole('button',{name:'＋ 새 대화',exact:true});
 await input().fill('first draft');await add.click();if(await tabs.count()!==2||await visible.count()!==1)throw Error('New chat replaced or split old tab');
 await input().fill('second draft');
 for(const [index,value] of [[0,'first draft'],[1,'second draft']]){
  await tabs.nth(index).locator('button').first().click();
  if(await input().inputValue()!==value)throw Error('Lost draft: '+value);
  await input().press('Enter');
  await tabs.nth(index).getByText(value,{exact:true}).waitFor({timeout:10000});
 }
 if(calls.length!==2||calls.some(c=>c.chatId))throw Error('New chat reused an existing session');
 await page.reload();await tabs.nth(1).getByText('second draft',{exact:true}).waitFor();
 for(const [index,title] of [[0,'first draft'],[1,'second draft']]){
  await tabs.nth(index).locator('button').first().click();await input().fill('continue '+title);await input().press('Enter');
  await page.waitForFunction(()=>!document.querySelector('.conversation-pane:not([style*="display: none"]) iframe').contentDocument.querySelector('textarea').value);
 }
 if(calls[2]?.chatId!=='session-1'||calls[3]?.chatId!=='session-2')throw Error('Follow-up went to wrong session');
 await page.getByRole('button',{name:'분할 열기',exact:true}).click();if(await visible.count()!==2)throw Error('Split view broken');
 await tabs.last().locator('button').last().click();if(await tabs.count()!==2||await visible.count()!==1)throw Error('Closing split lost a session');
 return {sessions:chats.length,independentDrafts:true,restored:true,followUpIds:calls.slice(2).map(c=>c.chatId)};
}
