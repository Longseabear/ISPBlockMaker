async page => {
 const ids=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
 const chats=ids.map((id,i)=>({id,provider:'claude',title:'Restore '+i,items:[],busy:false,status:'completed',blockId:'',queue:i?[]:[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',text:'Retained follow-up',state:'queued'}],queuePaused:!i,queueReason:'서버 재시작 후 재개를 눌러주세요'}));
 const state={connected:false,account:null,models:[],chats,requests:[],error:''};
 await page.route('**/api/interaction/events',r=>r.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({state,updates:[]})+'\n\n'}));
 await page.reload();await page.getByRole('button',{name:'＋ 채팅 추가',exact:true}).click();
 await page.locator('.conversation-status-list button').filter({hasText:'Restore 1'}).click();
 await page.locator('.conversation-pane').first().locator('.current-conversation').click();
 await page.locator('.conversation-status-list button').filter({hasText:'Restore 0'}).click();
 await page.reload();await page.locator('.conversation-pane').nth(1).waitFor();
 const titles=await page.locator('.current-conversation strong').allTextContents();
 if(!titles[0].includes('Restore 0')||!titles[1].includes('Restore 1'))throw Error('Pane selections not restored: '+titles);
 const queue=page.locator('iframe.cloudcli-frame').first().contentFrame().getByRole('region',{name:'대기 지시'});
 await queue.getByText('Retained follow-up',{exact:false}).waitFor();
 if(!await queue.getByRole('button',{name:'재개',exact:true}).isVisible())throw Error('Resume absent');
 await page.screenshot({path:'output/playwright/queue-restore.png'});
 await page.getByRole('button',{name:'대화 창 2 닫기',exact:true}).click();
 await page.unroute('**/api/interaction/events');await page.reload();
 return {panesRestored:titles,queueVisible:true,resumeVisible:true};
}
