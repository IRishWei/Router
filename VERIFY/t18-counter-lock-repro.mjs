// Exercises the actual external recorder source; no Host, model or old profile.
import assert from 'node:assert/strict';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const notes='C:/Users/a1500/AppData/Local/Temp/router-implementation/implement-spec-go-20261009';
const round=process.argv[2]; assert(/^(red|green)\d$/.test(round));
const home=join(notes,'t18-counter-lock-'+round); await mkdir(home);
const sourceBytes=await readFile(join(notes,'t18-fixture-final.mjs'));
const source=sourceBytes.toString('utf8');
const start=source.indexOf('function createRecorder(home) {');
const end=source.indexOf('\nfunction failureFor(',start); assert(start>=0&&end>start);
const recorder=new Function('readFile','writeFile','rename','join','assert','delay','return '+source.slice(start,end))(readFile,writeFile,rename,join,assert,delay)(home);
const counter=join(home,'t18-controlled-counts.json'),ready=join(home,'ready'),release=join(home,'release');
await writeFile(counter,JSON.stringify({realModelRequests:0,requests:[],toolExecutions:[],nativeSeams:[],toolRestrictions:[]},null,2),{flag:'wx'});
const child=spawn('powershell.exe',['-NoProfile','-File',join(notes,'t18-counter-lock-holder.ps1'),'-CounterPath',counter,'-ReadyPath',ready,'-ReleasePath',release],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let out='',err='';child.stdout.on('data',value=>out+=value);child.stderr.on('data',value=>err+=value);
const completion=new Promise(resolve=>child.on('close',code=>resolve(code)));
const deadline=Date.now()+5000; let locked=false;
while(Date.now()<deadline){try{await readFile(ready);locked=true;break;}catch{await delay(5);}}
assert(locked);
const timer=setTimeout(()=>writeFile(release,'release').catch(()=>{}),40);
let failure=null;
try { await recorder('nativeSeams',{marker:'exactly-one-record'}); }
catch(error){failure={code:error.code??null,syscall:error.syscall??null,path:error.path??null,dest:error.dest??null,message:error.message};}
finally { clearTimeout(timer);await writeFile(release,'release');assert.equal(await completion,0); }
const actual=JSON.parse(await readFile(counter,'utf8'));
const passed=!failure&&actual.nativeSeams.length===1&&actual.nativeSeams[0].marker==='exactly-one-record';
const receipt={round,passed,sourceSha256:createHash('sha256').update(sourceBytes).digest('hex').toUpperCase(),failure,actualRecords:actual.nativeSeams.length,childExit:0,productionModelRequests:0,out,err};
await writeFile(join(notes,'t18-counter-lock-'+round+'.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify(receipt));
assert(passed,'The actual external recorder lost the event while the target file was briefly open without delete-sharing');
