import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";

test("Windows install manifest survives repeat install and removes only owned files",{skip:process.platform!=="win32"},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"isp-installer-"));
 try {
  fs.mkdirSync(path.join(dir,"versions/test"),{recursive:true});
  fs.writeFileSync(path.join(dir,"versions/test/ISPBlockMaker.exe"),"fixture");
  fs.writeFileSync(path.join(dir,"keep.txt"),"user content");
  fs.writeFileSync(path.join(dir,"distribution.json"),JSON.stringify({app:"versions/test",version:"test"}));
  fs.writeFileSync(path.join(dir,"package-files.json"),JSON.stringify(["versions/test/ISPBlockMaker.exe","bin/isp-block-maker.cmd","installed-files.json","distribution.json","package-files.json","install.ps1","uninstall.ps1"]));
  for(const name of ["install.ps1","uninstall.ps1"])fs.copyFileSync(path.resolve("scripts",name),path.join(dir,name));
  const run=name=>execFileSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(dir,name),"-NoRegistration"],{windowsHide:true,timeout:20000});
  run("install.ps1");run("install.ps1");
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,"installed-files.json"),"utf8").replace(/^\uFEFF/,""));
  assert.ok(manifest.every(item=>typeof item==="string"));assert.equal(manifest.length,new Set(manifest).size);
  run("uninstall.ps1");assert.equal(fs.existsSync(path.join(dir,"versions/test/ISPBlockMaker.exe")),false);assert.equal(fs.readFileSync(path.join(dir,"keep.txt"),"utf8"),"user content");
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
