import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {deleteArtifacts} from "../server/artifact-delete.mjs";

test("artifact deletion removes only owned files and metadata, rolls back persistence failures",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"isp-delete-"));
 try {
  let records=[{id:"a",file:"a.html"},{id:"b",file:"b.png"}];
  fs.writeFileSync(path.join(dir,"a.html"),"embedded data");fs.writeFileSync(path.join(dir,"b.png"),"keep");
  const store={get:()=>({artifacts:records}),removeArtifacts:ids=>{records=records.filter(a=>!ids.includes(a.id));}};
  assert.throws(()=>deleteArtifacts({...store,removeArtifacts:()=>{throw Error("disk");}},dir,["a"]),/disk/);
  assert.equal(fs.readFileSync(path.join(dir,"a.html"),"utf8"),"embedded data");
  assert.throws(()=>deleteArtifacts(store,dir,["missing"]),/削|대상/);
  assert.deepEqual(deleteArtifacts(store,dir,["a"]),{deletedIds:["a"],cleanupPending:[]});
  assert.equal(fs.existsSync(path.join(dir,"a.html")),false);assert.equal(records.length,1);
  assert.equal(fs.readFileSync(path.join(dir,"b.png"),"utf8"),"keep");
  records.push({id:"unsafe",file:"../outside"});assert.throws(()=>deleteArtifacts(store,dir,["unsafe"]),/경로/);
 } finally {for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);}
});
