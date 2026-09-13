import test from "node:test";
import assert from "node:assert/strict";
import { requestDocument, sddInstructions } from "../server/documents.mjs";

test("SDD requests preserve work, deduplicate pending jobs, and allow a new completed version", () => {
  let state = {revision: 5, globalWork: {userRequests: [{id:"other", text:"keep me",status:"pending"}], jobs: []}};
  const store = {get:()=>state,global:(work,rev)=>{assert.equal(rev,state.revision);return state={...state,revision:rev+1,globalWork:work};}};
  requestDocument(store); requestDocument(store);
  assert.equal(state.globalWork.userRequests.length,2);
  assert.equal(state.globalWork.userRequests[0].text,"keep me");
  const request=state.globalWork.userRequests[1];
  assert.equal(request.text,sddInstructions);
  request.status="consumed";
  state.globalWork.jobs.push({sourceRequestId:request.id,status:"in_progress"});
  requestDocument(store); assert.equal(state.revision,6);
  state.globalWork.jobs[0].status="done";
  requestDocument(store); assert.equal(state.globalWork.userRequests.length,3);
});
