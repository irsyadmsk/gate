import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {ACTORS,createBoardingSeed} from './fixtures/gate-boarding-seed.mjs';
const load=async entry=>import('data:text/javascript;base64,'+Buffer.from(buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'esm',write:false}).outputFiles[0].text).toString('base64'));
const core=await load('packages/gate/src/index.ts'),{nativeGateHandler}=await load('supabase/functions/_shared/gate-console-handler.ts');
const actor=name=>ACTORS.find(a=>a.username===name),now=new Date('2026-10-29T03:00:00Z');
const command=(type,data,id='workspace-command-0001')=>({type,data,id});
const apply=(s,name,type,data,id)=>core.applyBoardingCommand(s,actor(name),command(type,data,id),now,ACTORS).state;

test('admin grants and revokes Gate-only guard access, requires reason/version and cannot alter administrators',()=>{
 let s=createBoardingSeed(now);
 assert.throws(()=>apply(s,'satpam','guard.access',{accountId:'gtk-baru',enabled:true,version:0,reason:'Uji'}),/berwenang/);
 assert.throws(()=>apply(s,'admin','guard.access',{accountId:'gtk-baru',enabled:true,version:0,reason:''}),/Alasan/);
 s=apply(s,'admin','guard.access',{accountId:'gtk-baru',enabled:true,version:0,reason:'Petugas tambahan'});
 assert.ok(core.boardingSnapshot(s,actor('gtkbaru'),ACTORS,now).actor.roles.includes('guard'));
 assert.throws(()=>apply(s,'admin','guard.access',{accountId:'gtk-baru',enabled:false,version:0,reason:'Selesai'},'workspace-revoke-stale'),/berubah/);
 s=apply(s,'admin','guard.access',{accountId:'gtk-baru',enabled:false,version:1,reason:'Penugasan selesai'},'workspace-revoke-0001');
 assert.ok(!core.boardingSnapshot(s,actor('gtkbaru'),ACTORS,now).actor.roles.includes('guard'));
 assert.throws(()=>apply(s,'gtkbaru','entry.add',{kind:'incident',title:'Palsu',note:'Ditolak'},'workspace-forged-0001'),/berwenang/);
 assert.throws(()=>apply(s,'admin','guard.access',{accountId:'admin-uji',enabled:false,version:0,reason:'Palsu'},'workspace-self-0001'),/administrator/);
 assert.equal(s.audit.filter(a=>a.action.includes('Hak satpam')).length,2);
});
test('revocation invalidates a still signed-in guard on lookup, printing and snapshot',()=>{
 let s=createBoardingSeed(now);s=apply(s,'admin','guard.access',{accountId:'satpam-pagi',enabled:false,version:0,reason:'Pencabutan segera'});
 assert.throws(()=>core.findCredential(s,actor('satpam'),s.people[0].token),/berwenang/);
 assert.throws(()=>core.printableCards(s,actor('satpam'),['student-1']),/aktif/);
 assert.throws(()=>core.boardingSnapshot(s,actor('satpam'),ACTORS,now),/dicabut/);
 assert.equal(s.movements.length,2);assert.equal(s.entries.length,1);
});
test('handover carries a frozen journal into the selected account and starts the receiving duty',()=>{
 let s=createBoardingSeed(now);
 s=apply(s,'satpam','handover.offer',{dutyId:'duty-pagi',toId:'satpam-siang',checks:core.HANDOVER_CHECKS,note:'Lampu perlu ditindaklanjuti'},'workspace-handover-0001');
 assert.throws(()=>apply(s,'satpam2','duty.checkin',{gate:'Gerbang utama'},'workspace-bypass-handover'),/serah terima/);
 const h=s.handovers[0],before=JSON.stringify(h.summary);
 assert.ok(h.summary.outside.some(p=>p.id==='student-3'));assert.equal(h.summary.entries[0].title,'Lampu sisi gerbang perlu diperiksa');
 s=apply(s,'satpam','entry.resolve',{entryId:'entry-lamp',note:'Sudah diperbaiki'},'workspace-resolve-0001');
 assert.equal(JSON.stringify(s.handovers[0].summary),before);
 assert.throws(()=>apply(s,'satpam','handover.receive',{handoverId:h.id,checked:true},'workspace-wrong-receiver'),/penerima/);
 s=apply(s,'satpam2','handover.receive',{handoverId:h.id,checked:true},'workspace-receive-0001');
 assert.equal(s.duties.find(d=>d.id==='duty-pagi').status,'closed');
 assert.equal(s.duties.find(d=>d.id==='duty-siang').status,'active');assert.ok(s.handovers[0].receivedAt);
});
test('presence distinguishes resident GTK, commuters and unverified students across midnight',()=>{
 const s=createBoardingSeed(now),p=s.people.find(p=>p.id==='staff-2');s.movements=[{...s.movements[1],personId:p.id,at:'2026-10-28T03:00:00Z'}];
 assert.equal(core.gatePresence(p,s.movements,now).key,'inside');
 assert.equal(core.gatePresence({...p,residence:'commuter'},s.movements,now).key,'unknown');
 assert.equal(core.gatePresence(s.people[0],s.movements,now).key,'unknown');
});
test('guards can print issued cards without receiving tokens in the operational snapshot',()=>{
 const s=createBoardingSeed(now),view=core.boardingSnapshot(s,actor('satpam'),ACTORS,now);
 assert.ok(view.people.every(p=>!p.token));assert.ok(core.printableCards(s,actor('satpam'),['staff-1'])[0].token);
 assert.throws(()=>core.printableCards(s,actor('gtk'),['staff-1']),/aktif/);
 s.people[0].active=false;assert.throws(()=>core.printableCards(s,actor('satpam'),['student-1']),/aktif/);
});
test('handover, incident, shift and activity reports retain return events',()=>{
 let s=createBoardingSeed(now);s=apply(s,'satpam','handover.offer',{dutyId:'duty-pagi',toId:'satpam-siang',checks:core.HANDOVER_CHECKS,note:'Laporan'},'workspace-report-handover');
 const view=core.boardingSnapshot(s,actor('satpam'),ACTORS,now);
 for(const kind of ['handover','shifts','incidents','activity'])assert.ok(core.boardingReport(view,kind,'2026-10-29','2026-10-29').rows.length);
 const history={...view,movements:[{...s.movements[0],at:'2026-10-28T02:00:00Z',returnedAt:now.toISOString()}]};
 assert.equal(core.boardingReport(history,'movements','2026-10-29','2026-10-29').rows.length,1);
});
function setup(provider) {
 let state=createBoardingSeed(now);let id=0;
 const store={read:async()=>structuredClone(state),directory:async()=>ACTORS,identity:async auth=>{const user=actor(auth.slice(7));if(!user)throw {status:401};return user;},rate:async()=>true,commit:async(revision,next)=>{if(revision!==state.revision)return false;state=structuredClone(next);return true;}};
 return {handler:nativeGateHandler(store,false,provider),publicHandler:nativeGateHandler(store,true,provider),get:()=>state,change:s=>state=s};
}
const call=async(handler,body,user='satpam')=>{const r=await handler(new Request('https://gate.irsyads.com/functions/v1/gate-console',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://gate.irsyads.com',...(user?{Authorization:'Bearer '+user}:{})},body:JSON.stringify(body)}));return{status:r.status,body:await r.json()};};
const jpeg=Buffer.from([255,216,255,192,0,17,8,0,1,0,1,3,1,17,0,2,17,0,3,17,0,255,217]);
test('photo API fails closed without storage and denies anonymous, public and staff requests',async()=>{
 const x=setup();assert.equal((await call(x.handler,{op:'storage.info'})).body.ready,false);
 assert.equal((await call(x.handler,{op:'photo.upload',reference:'photo-reference-0001'})).status,503);
 assert.equal((await call(x.handler,{op:'storage.info'},'')).status,401);
 assert.equal((await call(x.handler,{op:'storage.info'},'gtk')).status,403);
 assert.notEqual((await call(x.publicHandler,{op:'photo.upload',reference:'photo-reference-0001'})).status,200);
});
test('photo upload persists provider ID before sending, reuses it after lost responses, and never exposes Drive IDs',async()=>{
 let generated=0,uploaded=0,fail=true;const objects=new Map();
 const provider={name:'Fake private storage',ready:true,newId:async()=>{generated++;return 'drive-file-0000001';},upload:async(id,bytes)=>{uploaded++;objects.set(id,bytes);if(fail){fail=false;throw Error('lost acknowledgement');}},read:async id=>objects.get(id)};
 const x=setup(provider),body={op:'photo.upload',entryId:'entry-lamp',reference:'photo-reference-0001',base64:jpeg.toString('base64')};
 assert.equal((await call(x.handler,body)).status,503);assert.equal(x.get().photos[0].status,'uploading');
 assert.equal((await call(x.handler,body)).status,200);assert.equal(generated,1);assert.equal(objects.size,1);assert.equal(uploaded,2);
 assert.equal((await call(x.handler,body)).status,200);assert.equal(uploaded,2);
 const snapshot=(await call(x.handler,{op:'snapshot'})).body;assert.equal(snapshot.photos[0].fileId,'');assert.equal(snapshot.photos[0].digest,'');
 assert.equal(x.get().audit.filter(a=>a.action==='Foto kejadian disimpan').length,1);
 assert.equal((await call(x.handler,{op:'photo.read',reference:body.reference})).body.base64,body.base64);
 x.change(apply(x.get(),'admin','guard.access',{accountId:'satpam-pagi',enabled:false,version:0,reason:'Dicabut'}));
 assert.equal((await call(x.handler,{op:'photo.read',reference:body.reference})).status,403);
});
test('card printing returns tokens only to authorized roles and is audited idempotently',async()=>{
 const x=setup(),body={op:'cards.print',ids:['staff-1'],reference:'print-reference-0001'};
 assert.equal((await call(x.handler,body,'gtk')).status,403);
 const result=await call(x.handler,body);assert.equal(result.status,200);assert.ok(result.body.people[0].token);
 await call(x.handler,body);assert.equal(x.get().audit.filter(a=>a.action==='Kartu disiapkan untuk cetak').length,1);
});
