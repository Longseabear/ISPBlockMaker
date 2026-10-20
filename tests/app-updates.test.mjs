import test from 'node:test';
import assert from 'node:assert/strict';
import {newerVersion,releaseInfo} from '../server/app-updates.mjs';
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
