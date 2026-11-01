import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createDriveOAuthSetup,savePrivateEnv,parsePrivateEnv,DRIVE_SCOPE} from '../scripts/drive-oauth.mjs';

const origin='http://127.0.0.1:4583';
const owner='owner@contoh.test',client={client_id:'123-gate.apps.googleusercontent.com',client_secret:'fake-client-secret-for-test'};
const json=data=>new Response(JSON.stringify(data));
function setup({scope=DRIVE_SCOPE,email=owner,permissions=[{type:'user'}],available=true}={}) {
 const calls=[],saved=[];let now=0;
 const handler=createDriveOAuthSetup({client,parentFolderId:'approved-parent-0001',expectedOwnerEmail:owner,save:async patch=>saved.push(patch),clock:()=>now,request:async(url,init={})=>{
  calls.push({url,init});
  if(url.includes('/token')){assert.ok(init.body.get('code_verifier').length>=43);return json({access_token:'fake-access-value',refresh_token:'fake-refresh-value',scope});}
  if(url.includes('/about?'))return json({user:{emailAddress:email},storageQuota:{limit:available?'1000000000':'0',usage:'1000'}});
  if(init.method==='POST'){assert.equal(JSON.parse(init.body).mimeType,'application/vnd.google-apps.folder');return json({id:'private-created-folder-0001'});}
  return json({id:'private-created-folder-0001',mimeType:'application/vnd.google-apps.folder',permissions});
 }});
 return{handler,calls,saved,expire:()=>now=10*60000+1};
}
const request=(route,init={})=>new Request(origin+route,{...init,headers:{Host:'127.0.0.1:4583',...init.headers}});
async function start(x){const page=await(await x.handler(request('/'))).text(),csrf=page.match(/name="csrf" value="([^"]+)"/)[1];const response=await x.handler(request('/start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf})}));assert.equal(response.status,303);const url=new URL(response.headers.get('location'));assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('scope'),DRIVE_SCOPE);assert.equal(url.searchParams.get('include_granted_scopes'),'false');assert.equal(url.searchParams.get('code_challenge_method'),'S256');return{state:url.searchParams.get('state'),cookie:response.headers.get('set-cookie').split(';')[0]};}
const callback=(x,flow,state=flow.state)=>x.handler(request('/oauth/callback?code=fake-code-value&state='+encodeURIComponent(state),{headers:{Cookie:flow.cookie}}));
test('OAuth rejects foreign origins, invalid state, missing cookie, replay and expired setup without leaking tokens',async()=>{
 const x=setup(),flow=await start(x);
 assert.equal((await x.handler(request('/start',{method:'POST',headers:{Origin:'https://foreign.test','Content-Type':'application/x-www-form-urlencoded'},body:'csrf=wrong'}))).status,403);
 assert.equal((await callback(x,flow,'é'.repeat(64))).status,403);assert.equal(x.calls.length,0);
 assert.equal((await x.handler(request('/oauth/callback?code=fake&state='+flow.state))).status,403);
 x.expire();assert.equal((await callback(x,flow)).status,403);assert.equal(x.saved.length,0);
});
test('OAuth refuses broad Drive scopes before reading or creating user files',async()=>{
 const x=setup({scope:'https://www.googleapis.com/auth/drive'}),flow=await start(x),result=await callback(x,flow);
 assert.equal(result.status,400);assert.equal(x.calls.length,1);assert.equal(x.saved.length,0);
 const html=await result.text();for(const secret of ['fake-refresh-value','fake-access-value',client.client_secret,'fake-code-value'])assert.ok(!html.includes(secret));
});
test('OAuth refuses another Google account or unverified available storage before creating a folder',async()=>{
 for(const config of [{email:'other@contoh.test'},{available:false}]){const x=setup(config),flow=await start(x);assert.equal((await callback(x,flow)).status,400);assert.equal(x.calls.length,2);assert.equal(x.saved.length,0);}
});
test('OAuth saves only narrow, owner-matched tokens on the server and binds the approved parent folder',async()=>{
 const x=setup(),flow=await start(x),result=await callback(x,flow);assert.equal(result.status,303);assert.equal(result.headers.get('location'),'/connected');
 assert.equal(x.saved.length,1);assert.equal(x.saved[0].GATE_DRIVE_PARENT_FOLDER_ID,'approved-parent-0001');assert.equal(x.saved[0].GATE_DRIVE_FOLDER_ID,'private-created-folder-0001');assert.equal(x.saved[0].GATE_DRIVE_REFRESH_TOKEN,'fake-refresh-value');
 assert.equal((await callback(x,flow)).status,403);
 const html=await(await x.handler(request('/connected'))).text();for(const secret of ['fake-refresh-value','fake-access-value',client.client_secret])assert.ok(!html.includes(secret));
});
test('OAuth does not persist credentials if the created folder is publicly shared',async()=>{
 const x=setup({permissions:[{type:'anyone'}]}),flow=await start(x);assert.equal((await callback(x,flow)).status,400);assert.equal(x.saved.length,0);
});
test('private env writes retain unrelated configuration and refuse to replace existing tokens',async()=>{
 const root=path.resolve('scratch/oauth-tests');await mkdir(root,{recursive:true});const dir=await mkdtemp(path.join(root,'case-')),file=path.join(dir,'.env.backend.local');
 try{await savePrivateEnv(file,{GATE_DRIVE_CLIENT_ID:'fake-id',GATE_DRIVE_REFRESH_TOKEN:'fake-quoted-"token'});const values=parsePrivateEnv(await readFile(file,'utf8'));assert.equal(values.GATE_DRIVE_REFRESH_TOKEN,'fake-quoted-"token');await assert.rejects(savePrivateEnv(file,{GATE_DRIVE_REFRESH_TOKEN:'replacement'}),/tidak ditimpa/);assert.equal(parsePrivateEnv(await readFile(file,'utf8')).GATE_DRIVE_CLIENT_ID,'fake-id');}
 finally{const relative=path.relative(root,path.resolve(dir));if(relative.startsWith('..')||path.isAbsolute(relative)||!relative.startsWith('case-'))throw Error('Unexpected fixture cleanup target');await rm(dir,{recursive:true,force:true});}
});
