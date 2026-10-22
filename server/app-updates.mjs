import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const latestApi='https://api.github.com/repos/Longseabear/ISPBlockMaker/releases/latest';
export async function windowsRelease(){
 const command="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); $ProgressPreference='SilentlyContinue'; try { $r=Invoke-RestMethod -Uri '"+latestApi+"' -Headers @{Accept='application/vnd.github+json';'User-Agent'='ISPBlockMaker'} -TimeoutSec 12; ConvertTo-Json -InputObject $r -Depth 12 -Compress } catch { $s=0; if($_.Exception.Response){$s=[int]$_.Exception.Response.StatusCode}; ConvertTo-Json -Compress -InputObject @{updateError=$true;status=$s} }";
 const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const {stdout}=await promisify(execFile)(exe,['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:15000,maxBuffer:2*1024*1024,encoding:'utf8'});
 const value=JSON.parse(stdout.replace(/^\uFEFF/,''));if(value.updateError)throw Object.assign(Error('Windows network request failed'),{status:value.status});return value;
}
export function updateFailure(error){
 const code=error.cause?.code||error.code||error.name;
 if(error.status===403||error.status===429)return 'GitHub 조회가 제한되었습니다. API 요청 한도 또는 회사망 접근 정책을 확인하거나 아래 릴리스 페이지를 이용하세요.';
 if(error.status===407)return '프록시 인증이 필요합니다. Windows 네트워크/프록시 설정을 확인하세요.';
 if(error.status)return `GitHub 릴리스 조회 실패 (HTTP ${error.status}). 아래 릴리스 페이지에서 직접 확인할 수 있습니다.`;
 if(/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code))return 'GitHub HTTPS 인증서를 확인하지 못했습니다. 회사 인증서/프록시 설정을 확인하거나 아래 릴리스 페이지를 이용하세요.';
 if(/TIMEOUT|Timeout|Abort/.test(code))return 'GitHub 연결 시간이 초과되었습니다. 네트워크를 확인하고 다시 시도하거나 아래 릴리스 페이지를 이용하세요.';
 if(/ENOTFOUND|EAI_AGAIN/.test(code))return 'GitHub 주소를 찾지 못했습니다. DNS 또는 회사망 접근 설정을 확인하세요.';
 return '서버에서 GitHub에 연결하지 못했습니다. 네트워크·프록시를 확인하거나 아래 릴리스 페이지에서 직접 확인하세요.';
}
export async function queryRelease(current,{fetchRelease=fetch,platform=process.platform,nativeRelease=windowsRelease}={}){
 let release;
 try{const r=await fetchRelease(latestApi,{headers:{Accept:'application/vnd.github+json','User-Agent':'ISPBlockMaker'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Object.assign(Error('GitHub response'),{status:r.status});release=await r.json();}
 catch(error){
  // Only retry transport failures through Windows trust/proxy settings; never disable TLS verification.
  if(platform==='win32'&&!error.status){try{release=await nativeRelease();}catch(nativeError){throw Error(updateFailure(nativeError.status?nativeError:error));}}
  else throw Error(updateFailure(error));
 }
 return releaseInfo(current,release);
}
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
    pending ||= queryRelease(current).then(value=>{cached=value;expires=Date.now()+15*60*1000;return value;}).finally(()=>{pending=null;});
    await pending;
   }
   res.json(cached);
  }catch(error){res.status(502).json({error:error.message});}
 });
}
