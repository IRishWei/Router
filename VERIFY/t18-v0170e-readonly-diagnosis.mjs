import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const notes='C:/Users/a1500/AppData/Local/Temp/router-implementation/implement-spec-go-20261009';
const home='C:/Users/a1500/AppData/Local/Temp/router-implementation/t18-v0170e-controlled-home';
const paths={state:home+'/router/desktop/state.json',counter:home+'/t18-controlled-counts.json',pending:home+'/t18-controlled-counts.pending.json'};
const captured={};for(const [key,path]of Object.entries(paths))captured[key]=await readFile(path);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
const state=JSON.parse(captured.state),counter=JSON.parse(captured.counter),pending=JSON.parse(captured.pending);
const task=state.tasks.at(-1);
const receipt={label:'t18-v0170e',scope:'Read-only diagnosis after immutable failed-controlled capture; no Host or model.',files:Object.fromEntries(Object.entries(captured).map(([key,bytes])=>[key,{path:paths[key],bytes:bytes.length,sha256:digest(bytes)}])),
 task:{id:task.id,sessionId:task.sessionId,lifecycle:task.lifecycle,pauseReason:task.pauseReason,recovery:task.recovery,calls:task.calls.map(call=>({id:call.id,purpose:call.purpose,status:call.status,failureCode:call.failureCode,usage:call.usage,dispatchStarted:call.dispatchStarted}))},
 currentRequests:counter.requests.length,pendingRequests:pending.requests.length,currentSeams:counter.nativeSeams.length,pendingSeams:pending.nativeSeams.length,
 uncommittedPendingRequest:{model:pending.requests.at(-1).model,purpose:pending.requests.at(-1).purpose,mode:pending.requests.at(-1).mode,sessionId:pending.requests.at(-1).sessionId},
 interpretation:'Complete pending JSON with one uncommitted request and an EPERM in the same recorder queue supports a final rename failure. Separate deterministic filesystem repro identifies the failing syscall; the original transient lock holder is unknown.',productionModelRequests:0,originalBytesUnchanged:true};
for(const[key,path]of Object.entries(paths))assert.deepEqual(await readFile(path),captured[key]);
await writeFile(notes+'/t18-v0170e-readonly-diagnosis.json',JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify({readOnly:true,originalBytesUnchanged:true,currentRequests:receipt.currentRequests,pendingRequests:receipt.pendingRequests,productionModelRequests:0}));
