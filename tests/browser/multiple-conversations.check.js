async page => {
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
 const chats=ids.map((id,i)=>({id,provider:'claude',title:['Running fixture','Waiting fixture','Completed fixture','Failed fixture'][i],items:[],busy:i<2,status:['inProgress','inProgress','completed','failed'][i],phase:'working',blockId:''}));
 const state={connected:false,account:null,models:[],chats,requests:[{id:'approval',method:'tool',params:{chatId:ids[1]}}],error:''};
 const calls=[];
 await page.route('**/api/interaction/events',route=>route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({state,updates:[]})+'\n\n'}));
 await page.route('**/api/interaction/send',async route=>{const body=route.request().postDataJSON();calls.push(body);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:body.chatId})});});
 let stops=0;await page.route('**/api/interaction/interrupt',async route=>{stops++;await route.fulfill({status:200,contentType:'application/json',body:'{}'});});
 await page.reload();await page.setViewportSize({width:1700,height:1000});
 await page.getByRole('button',{name:'＋ 채팅 추가',exact:true}).click();
 await page.locator('.conversation-status-list button').filter({hasText:'Completed fixture'}).click();
 await page.locator('.conversation-pane').first().locator('.current-conversation').click();
 await page.locator('.conversation-status-list button').filter({hasText:'Failed fixture'}).click();
 const frames=page.locator('iframe.cloudcli-frame');
 const first=frames.nth(0).contentFrame(),second=frames.nth(1).contentFrame();
 await first.locator('textarea').fill('independent first');await second.locator('textarea').fill('independent second');
 if(await first.locator('textarea').inputValue()!=='independent first')throw Error('Drafts crossed');
 await first.locator('textarea').press('Enter');await second.locator('textarea').press('Enter');
 await page.waitForTimeout(300);
 if(calls.length!==2 || calls[0].chatId!==ids[3] || calls[1].chatId!==ids[2])throw Error('Incorrect send routing');
 const labels=await page.locator('.conversation-status-list .conversation-status').allTextContents();
 for(const label of ['실행 중','응답 대기','완료','오류'])if(!labels.includes(label))throw Error('Missing '+label);
 await page.screenshot({path:'output/playwright/multiple-conversations.png'});
 await page.getByRole('button',{name:'대화 창 2 닫기',exact:true}).click();
 if(stops)throw Error('Closing stopped work');
 const result={labels,independentSendRouting:true,closeDoesNotStop:true,remainingPanes:await frames.count()};
 await page.unroute('**/api/interaction/events');await page.unroute('**/api/interaction/send');await page.unroute('**/api/interaction/interrupt');await page.reload();
 return result;
}
