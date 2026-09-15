const dialog=document.querySelector('#lightbox');
for(const button of document.querySelectorAll('[data-image]'))button.addEventListener('click',()=>{const img=button.querySelector('img');dialog.querySelector('img').src=button.dataset.image;dialog.querySelector('img').alt=img.alt;dialog.showModal();});
dialog.querySelector('.close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
for(const button of document.querySelectorAll('[data-copy]'))button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(button.dataset.copy);button.textContent='복사됨';document.querySelector('#copy-status').textContent='명령어를 복사했습니다.';setTimeout(()=>button.textContent='복사',1800);}catch{document.querySelector('#copy-status').textContent='복사할 수 없습니다. 명령어를 선택해 직접 복사해주세요.';button.textContent='직접 선택';}});
