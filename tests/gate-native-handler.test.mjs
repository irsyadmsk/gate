import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { ACTORS, createBoardingSeed } from './fixtures/gate-boarding-seed.mjs';
const code=buildSync({entryPoints:['supabase/functions/_shared/gate-console-handler.ts'],bundle:true,format:'esm',platform:'node',write:false}).outputFiles[0].text;
const {nativeGateHandler}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const token='GTK-'+'a'.repeat(32);
function setup(publicAccess=false){
 let state=createBoardingSeed();let saves=0,collide=false;const store={
  read:async()=>structuredClone(state),directory:async()=>ACTORS,
  identity:async(auth)=>{const a=ACTORS.find(a=>a.username===auth.slice(7));if(!a)throw {status:401};return a;},rate:async()=>true,
  commit:async(revision,next)=>{if(collide){collide=false;state.revision++;return false;}if(revision!==state.revision)return false;state=structuredClone(next);saves++;return true;}
 };return {handler:nativeGateHandler(store,publicAccess),store,state:()=>state,saves:()=>saves,collide:()=>{collide=true;}};
}
const call=async(h,body,user='satpam',extra={})=>{const r=await h(new Request('https://example.test/functions/v1/gate-console',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://gate.irsyads.com',...(user?{Authorization:'Bearer '+user}:{}),...extra},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
test('native API: origin asing, anonymous dan token palsu ditolak',async()=>{
 const {handler}=setup();assert.equal((await call(handler,{op:'snapshot'},'satpam',{Origin:'https://asing.test'})).status,403);
 assert.equal((await call(handler,{op:'snapshot'},'')).status,401);assert.equal((await call(handler,{op:'snapshot'},'palsu')).status,401);
});
test('native API: role payload tidak memberi admin dan snapshot satpam tidak berisi token',async()=>{
 const {handler}=setup();const r=await call(handler,{op:'snapshot'});assert.ok(r.data.people.every(p=>!p.token));
 const command={id:'native-forged-001',type:'gtk.create',data:{roles:['admin'],name:'Fake'}};
 assert.equal((await call(handler,{op:'command',command})).status,403);
});
test('native API: CAS gagal dibaca ulang; retry respons hilang tidak menggandakan pergerakan',async()=>{
 const x=setup();x.collide();const command={id:'native-quick-0001',type:'staff.quick',data:{token,direction:'out',gate:'Gerbang utama'}};
 assert.equal((await call(x.handler,{op:'command',command})).status,200);const count=x.state().movements.length;
 assert.equal((await call(x.handler,{op:'command',command})).data.duplicate,true);assert.equal(x.state().movements.length,count);assert.equal(x.saves(),1);
});
test('native API: QR ditahan tetap menyimpan receipt, sehingga retry terlambat tidak membalik status',async()=>{
 const x=setup();const first={id:'native-quick-first',type:'staff.quick',data:{token,direction:'out',gate:'Gerbang utama'}};
 await call(x.handler,{op:'command',command:first});
 const opposite={id:'native-quick-held',type:'staff.quick',data:{token,direction:'in',gate:'Gerbang utama'}};
 assert.equal((await call(x.handler,{op:'command',command:opposite})).data.duplicate,true);
 assert.ok(x.state().receipts['satpam-pagi:native-quick-held']);assert.equal(x.saves(),2);
});
test('native API publik: hanya opsi penerima yang terbuka; command/snapshot tidak dapat dipanggil',async()=>{
 const {handler}=setup(true);const r=await call(handler,{op:'options'},'');assert.ok(r.data.hosts.every(h=>Object.keys(h).sort().join(',')==='id,name'));assert.equal(r.data.people,undefined);
 assert.equal((await call(handler,{op:'command',command:{type:'settings.save'}},'admin')).status,404);
 assert.equal((await call(handler,{op:'snapshot'},'admin')).status,404);
});
test('native API publik: register retry tidak ganda, status butuh rahasia dan cancel tidak menghapus riwayat',async()=>{
 const x=setup(true),secret='1'.repeat(64),reference=crypto.randomUUID();
 const body={op:'register',reference,secret,input:{name:'Tamu Sintetis',category:'Tamu lembaga',origin:'Contoh',phone:'',host:'pengasuh-a',purpose:'Koordinasi',plannedAt:new Date().toISOString(),vehicle:'',groupSize:1,note:'',consent:true}};
 const first=await call(x.handler,body,'');assert.equal(first.status,201);
 assert.equal((await call(x.handler,body,'')).status,200);assert.equal(x.state().visits.filter(v=>v.id===reference).length,1);
 assert.equal((await call(x.handler,{op:'status',secret:'2'.repeat(64)},'')).status,404);
 assert.equal((await call(x.handler,{op:'cancel',secret},'')).data.status,'cancelled');assert.ok(x.state().visits.some(v=>v.id===reference));
 const saved=x.saves();assert.equal((await call(x.handler,{op:'cancel',secret},'')).data.status,'cancelled');assert.equal(x.saves(),saved);
});
test('native API: baca pos menjalankan retensi walau tidak ada pendaftaran publik baru',async()=>{
 const x=setup();x.state().visits[0].expiresAt=new Date(Date.now()-86400000).toISOString();
 const response=await call(x.handler,{op:'snapshot'});assert.equal(response.status,200);assert.equal(response.data.visits.length,0);assert.equal(x.state().visits.length,0);assert.equal(x.saves(),1);
});
test('native API: pembatasan persistensi menahan penyalahgunaan tanpa memproses tindakan',async()=>{
 const x=setup();x.store.rate=async()=>false;assert.equal((await call(x.handler,{op:'snapshot'})).status,429);assert.equal(x.saves(),0);
});
