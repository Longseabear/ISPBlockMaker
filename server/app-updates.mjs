export const releasesUrl='https://github.com/Longseabear/ISPBlockMaker/releases/latest';
export function newerVersion(current,latest){
 const parse=value=>/^v?(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
 const a=parse(current),b=parse(latest);if(!a||!b)return false;
 for(let i=0;i<3;i++){if(a[i]!==b[i])return b[i]>a[i];}return false;
}
export function releaseInfo(current,release){
 if(release.draft||release.prerelease||typeof release.tag_name!=='string')throw Error('안정 릴리스 정보를 확인할 수 없습니다.');
 const asset=release.assets?.find(a=>a.name==='ISPBlockMaker-Setup.exe');
 const url=asset?.browser_download_url;
 const downloadUrl=typeof url==='string'&&/^https:\/\/github\.com\/Longseabear\/ISPBlockMaker\/releases\/download\/[^/]+\/ISPBlockMaker-Setup\.exe$/.test(url)?url:null;
 return {current,latest:release.tag_name,available:newerVersion(current,release.tag_name),releasesUrl,downloadUrl};
}
export function installAppUpdates(app,current){
 let cached,pending,expires=0;
 app.get('/api/app-update',async(req,res)=>{
  try{
   if(!cached||Date.now()>expires){
    pending ||= (async()=>{const r=await fetch('https://api.github.com/repos/Longseabear/ISPBlockMaker/releases/latest',{headers:{Accept:'application/vnd.github+json','User-Agent':'ISPBlockMaker'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('릴리스 조회 실패 ('+r.status+')');const value=releaseInfo(current,await r.json());cached=value;expires=Date.now()+15*60*1000;return value;})().finally(()=>{pending=null;});
    await pending;
   }
   res.json(cached);
  }catch(error){res.status(502).json({error:error.message});}
 });
}
