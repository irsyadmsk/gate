import test from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';
const source=buildSync({entryPoints:['supabase/functions/_shared/gate-photo-drive.ts'],bundle:true,platform:'node',format:'esm',write:false}).outputFiles[0].text;
const {googleDrivePhotos}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const config={clientId:'test-client',clientSecret:'test-secret',refreshToken:'test-refresh',folderId:'private-folder-0001'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('Drive refuses a storage folder outside the approved parent before allocating a file',async()=>{
 const calls=[];const provider=googleDrivePhotos({...config,parentId:'approved-parent-0001'},async(url)=>{calls.push(String(url));return String(url).includes('/token')?json({access_token:'fake',expires_in:3600}):json({mimeType:'application/vnd.google-apps.folder',parents:['unexpected-parent'],capabilities:{canAddChildren:true},permissions:[{type:'user'}]});});
 await assert.rejects(provider.newId(),e=>e.status===503&&e.message.includes('tujuan Gate'));
 assert.equal(calls.length,2);assert.ok(!calls.some(url=>url.includes('generateIds')));
});
test('Drive refuses a folder shared with anyone before allocating or uploading a file',async()=>{
 const calls=[];const provider=googleDrivePhotos(config,async(url,init)=>{calls.push(String(url));return String(url).includes('/token')?json({access_token:'fake',expires_in:3600}):json({mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true},permissions:[{type:'anyone'}]});});
 await assert.rejects(provider.newId(),e=>e.status===503&&e.message.includes('privat'));
 assert.equal(calls.length,2);assert.ok(!calls.some(url=>url.includes('/upload/')));
});
test('Drive retries create with the reserved ID and verifies a 409 against parent, size and digest',async()=>{
 let tokenCalls=0,uploads=0;const photo={id:'photo-00000001',entryId:'entry-00001',name:'photo.jpg',mimeType:'image/jpeg',size:3,digest:'abc'};
 const provider=googleDrivePhotos(config,async(url,init)=>{
  url=String(url);if(url.includes('/token')){tokenCalls++;return json({access_token:'fake',expires_in:3600});}
  if(url.includes('/upload/')){uploads++;const body=await init.body.text();assert.ok(body.includes('reserved-file-0001'));assert.ok(body.includes('gateDigest'));return json({},409);}
  if(url.includes(config.folderId))return json({mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true},permissions:[{type:'user'}]});
  return json({id:'reserved-file-0001',size:'3',mimeType:'image/jpeg',parents:[config.folderId],appProperties:{gateDigest:'abc'}});
 });
 await provider.upload('reserved-file-0001',new Uint8Array([1,2,3]),photo);await provider.upload('reserved-file-0001',new Uint8Array([1,2,3]),photo);
 assert.equal(tokenCalls,1);assert.equal(uploads,2);
});
test('Drive never reads bytes from a different parent folder and disables incomplete credentials',async()=>{
 assert.equal(googleDrivePhotos({...config,refreshToken:''}).ready,false);
 let media=0;const provider=googleDrivePhotos(config,async(url)=>{
  url=String(url);if(url.includes('/token'))return json({access_token:'fake',expires_in:3600});
  if(url.includes(config.folderId))return json({mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true},permissions:[{type:'user'}]});
  if(url.includes('alt=media')){media++;return new Response('no');}
  return json({mimeType:'image/jpeg',parents:['other-folder'],size:'3'});
 });
 await assert.rejects(provider.read('reserved-file-0001'));assert.equal(media,0);
});
