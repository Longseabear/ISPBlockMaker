import test from 'node:test';
import assert from 'node:assert/strict';
import {newerVersion,releaseInfo,queryRelease,updateFailure} from '../server/app-updates.mjs';
test('stable release version comparison and trusted installer links',()=>{
 assert.equal(newerVersion('0.1.9','v0.1.10'),true);
 assert.equal(newerVersion('0.2.0','v0.1.99'),false);
 assert.equal(newerVersion('0.1.22','v0.1.22'),false);
 assert.equal(newerVersion('0.1.22','v0.2.0-beta'),false);
 const release={tag_name:'v0.2.0',assets:[{name:'ISPBlockMaker-Setup.exe',browser_download_url:'https://github.com/Longseabear/ISPBlockMaker/releases/download/v0.2.0/ISPBlockMaker-Setup.exe'}]};
 assert.equal(releaseInfo('0.1.22',release).available,true);
 assert.ok(releaseInfo('0.1.22',release).downloadUrl);
 release.assets[0].browser_download_url='https://example.com/installer.exe';
 assert.equal(releaseInfo('0.1.22',release).downloadUrl,null);
 assert.throws(()=>releaseInfo('0.1.22',{...release,prerelease:true}));
});
test('Windows transport failure falls back without weakening release URL validation',async()=>{
 let nativeCalls=0;const release={tag_name:'v0.1.28',assets:[{name:'ISPBlockMaker-Setup.exe',browser_download_url:'https://evil.invalid/setup.exe'}]};
 const result=await queryRelease('0.1.27',{platform:'win32',fetchRelease:async()=>{throw Object.assign(Error('fetch failed'),{cause:{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'}});},nativeRelease:async()=>{nativeCalls++;return release;}});
 assert.equal(nativeCalls,1);assert.equal(result.available,true);assert.equal(result.downloadUrl,null);
 await assert.rejects(queryRelease('0.1.27',{platform:'win32',fetchRelease:async()=>({ok:false,status:403}),nativeRelease:async()=>{throw Error('must not call');}}),/제한/);
 await assert.rejects(queryRelease('0.1.27',{platform:'win32',fetchRelease:async()=>{throw Object.assign(Error('fetch failed'),{cause:{code:'ENOTFOUND'}});},nativeRelease:async()=>{throw Error('failed');}}),/DNS/);
 assert.match(updateFailure({cause:{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'}}),/인증서/);
 assert.match(updateFailure({name:'TimeoutError'}),/시간/);
});
