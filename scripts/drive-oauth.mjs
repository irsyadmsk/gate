/** One-time owner authorization. Never reads tokens from the chat connector. */
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile,open,rename,unlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export function parsePrivateEnv(text) {const values={};for(const line of text.split(/\r?\n/)){const match=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(!match)continue;try{values[match[1]]=match[2].startsWith('"')?JSON.parse(match[2]):match[2];}catch{throw Error('Format konfigurasi privat tidak valid.');}}return values;}
export async function savePrivateEnv(file,patch) {
  let text='';try{text=await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  const values=parsePrivateEnv(text);if(values.GATE_DRIVE_REFRESH_TOKEN)throw Error('Koneksi Drive sudah ada; tidak ditimpa otomatis.');
  const lines=text.split(/\r?\n/).filter(line=>!Object.keys(patch).some(key=>line.match(new RegExp('^\\s*'+key+'\\s*='))));
  const output=lines.join('\n').trimEnd()+'\n'+Object.entries(patch).map(([key,value])=>key+'='+JSON.stringify(String(value))).join('\n')+'\n';
  const temporary=file+'.oauth-'+randomBytes(8).toString('hex');
  const handle=await open(temporary,'wx',0o600);
  try{
    if(process.platform==='win32') {
      const sid=execFileSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).match(/S-1-\d+(?:-\d+)+/)?.[0];
      if(!sid)throw Error('Tidak dapat memastikan pemilik berkas rahasia.');
      execFileSync('icacls',[temporary,'/inheritance:r','/grant:r','*'+sid+':(F)','*S-1-5-18:(F)'],{stdio:'ignore',windowsHide:true});
    }
    await handle.writeFile(output,'utf8');await handle.sync();await handle.close();await rename(temporary,file);
  }catch(error){await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
}
export function createDriveOAuthSetup({client,parentFolderId,expectedOwnerEmail,save,request=fetch,baseUrl='http://127.0.0.1:4583',clock=()=>Date.now()}) {
  const base=new URL(baseUrl);
  if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||!base.port)throw Error('Setup harus memakai loopback 127.0.0.1.');
  if(!client?.client_id?.endsWith('.apps.googleusercontent.com')||!client.client_secret)throw Error('Client OAuth khusus Gate belum tersedia.');
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(parentFolderId)||!expectedOwnerEmail?.includes('@'))throw Error('Folder tujuan dan akun pemilik wajib ditetapkan.');
  const csrf=randomBytes(32).toString('hex'),cookie=randomBytes(32).toString('hex');
  let flow,complete=false,inProgress=false;
  const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
  const page=(content,status=200)=>new Response(`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Koneksi foto Gate</title><style>body{font:16px/1.6 system-ui;background:#f6f5f1;color:#14283e;margin:0;padding:24px}main{max-width:640px;margin:8vh auto;background:white;border:1px solid #dce1e3;border-radius:20px;padding:32px}h1{line-height:1.2}button{background:#315f89;color:white;border:0;border-radius:10px;padding:15px 20px;font:inherit;cursor:pointer}small{color:#536271}</style><main>${content}</main></html>`,{status,headers});
  async function google(url,init={}){const r=await request(url,{...init,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Google belum mengonfirmasi koneksi. Tidak ada rahasia yang ditampilkan; ulangi setup setelah memeriksa konfigurasi.');return r.json();}
  return async req=>{
    const url=new URL(req.url);
    if(req.headers.get('host')!==base.host||url.origin!==base.origin)return page('<h1>Host ditolak</h1>',403);
    if(req.method==='GET'&&url.pathname==='/')return page(`<p>GATE / PENYIMPANAN FOTO</p><h1>Hubungkan Google khusus Gate.</h1><p>Anda akan memberikan izin <code>drive.file</code>: berkas yang dibuat atau diotorisasi untuk aplikasi Gate. Aplikasi tidak meminta akses ke seluruh Drive.</p><p>Setelah persetujuan Google, setup membuat folder privat milik aplikasi. Folder ini kemudian ditempatkan di dalam folder tujuan Anda melalui koneksi Drive yang sudah ada.</p><form method="post" action="/start"><input type="hidden" name="csrf" value="${csrf}"><button>Hubungkan Google & siapkan folder privat</button></form><p><small>Rahasia disimpan hanya di berkas lokal privat. Tidak ada deploy, unggahan foto, atau perubahan login Irsyads dari halaman ini.</small></p>`);
    if(req.method==='POST'&&url.pathname==='/start'){
      if(req.headers.get('origin')!==base.origin||!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return page('<h1>Asal ditolak</h1>',403);
      const body=await req.text();if(body.length>2000||!equal(new URLSearchParams(body).get('csrf'),csrf))return page('<h1>Permintaan tidak valid</h1>',403);
      if(complete||inProgress)return page('<h1>Setup sudah diproses</h1>',409);
      flow={state:randomBytes(32).toString('hex'),verifier:randomBytes(48).toString('base64url'),expires:clock()+10*60000,used:false};
      const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search=new URLSearchParams({client_id:client.client_id,redirect_uri:base.origin+'/oauth/callback',response_type:'code',scope:DRIVE_SCOPE,access_type:'offline',prompt:'consent',include_granted_scopes:'false',state:flow.state,code_challenge:createHash('sha256').update(flow.verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
      return new Response(null,{status:303,headers:{Location:auth.href,'Cache-Control':'no-store','Set-Cookie':`gate_drive_setup=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`}});
    }
    if(req.method==='GET'&&url.pathname==='/oauth/callback'){
      const bound=req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('gate_drive_setup='))?.slice('gate_drive_setup='.length);
      if(!flow||flow.used||clock()>flow.expires||!equal(url.searchParams.get('state'),flow.state)||!equal(bound,cookie))return page('<h1>Sesi setup tidak valid</h1><p>Tidak ada izin atau rahasia yang diproses. Mulai kembali dari halaman utama.</p>',403);
      if(url.searchParams.has('error')){flow.used=true;return page('<h1>Persetujuan Google tidak diselesaikan</h1><p>Tidak ada rahasia disimpan.</p>',400);}
      const code=url.searchParams.get('code');if(!code||code.length>4096)return page('<h1>Kode Google tidak valid</h1>',400);
      flow.used=true;inProgress=true;
      try{
        const tokens=await google('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:client.client_id,client_secret:client.client_secret,code,code_verifier:flow.verifier,redirect_uri:base.origin+'/oauth/callback',grant_type:'authorization_code'})});
        const scopes=String(tokens.scope??'').split(/\s+/).filter(Boolean);
        if(!tokens.access_token||!tokens.refresh_token||scopes.length!==1||scopes[0]!==DRIVE_SCOPE)throw Error('Google tidak memberikan tepat izin drive.file dan akses offline. Koneksi tidak disimpan.');
        const auth={Authorization:'Bearer '+tokens.access_token};
        const about=await google('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota(limit,usage)',{headers:auth});
        if(about.user?.emailAddress?.toLowerCase()!==expectedOwnerEmail.toLowerCase())throw Error('Akun Google berbeda dari pemilik folder yang ditetapkan. Tidak ada folder dibuat atau rahasia disimpan.');
        const available=Number(about.storageQuota?.limit)-Number(about.storageQuota?.usage);
        if(!Number.isFinite(available)||available<10_000_000)throw Error('Ruang Drive yang tersedia belum dapat dipastikan. Setup tidak mengaktifkan penyimpanan.');
        const created=await google('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({name:'Gate — Foto kejadian',mimeType:'application/vnd.google-apps.folder',appProperties:{gatePhotoStorage:'v1'}})});
        if(!/^[A-Za-z0-9_-]{10,200}$/.test(created.id))throw Error('Google belum mengonfirmasi ID folder.');
        const folder=await google('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(created.id)+'?fields=id,mimeType,permissions(type)',{headers:auth});
        if(!/^[A-Za-z0-9_-]{10,200}$/.test(folder.id)||folder.mimeType!=='application/vnd.google-apps.folder'||!Array.isArray(folder.permissions)||folder.permissions.some(p=>['anyone','domain'].includes(p.type)))throw Error('Folder penyimpanan belum terkonfirmasi privat. Rahasia tidak disimpan.');
        await save({GATE_DRIVE_CLIENT_ID:client.client_id,GATE_DRIVE_CLIENT_SECRET:client.client_secret,GATE_DRIVE_REFRESH_TOKEN:tokens.refresh_token,GATE_DRIVE_FOLDER_ID:folder.id,GATE_DRIVE_PARENT_FOLDER_ID:parentFolderId,GATE_DRIVE_OWNER_EMAIL:expectedOwnerEmail});
        complete=true;
        return new Response(null,{status:303,headers:{Location:'/connected','Cache-Control':'no-store','Set-Cookie':'gate_drive_setup=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'}});
      }catch(error){return page('<h1>Koneksi belum selesai</h1><p>'+escape(error.message)+'</p><p>Bila Google sudah membuat folder kosong, biarkan sampai peninjauan; setup tidak menghapusnya otomatis.</p>',400);}
      finally{inProgress=false;}
    }
    if(req.method==='GET'&&url.pathname==='/connected'&&complete)return page('<h1>Koneksi disimpan secara privat.</h1><p>Tahap berikutnya: tempatkan folder baru di folder tujuan, periksa ulang izin dan kuota, lalu pasang rahasia server melalui aktivasi yang disetujui pemilik.</p><p>Belum ada foto yang diunggah atau aplikasi yang di-deploy.</p>');
    return page('<h1>Halaman tidak ditemukan</h1>',404);
  };
}

async function main(){
  const args=process.argv.slice(2);if(args.includes('--help')){console.log('node scripts/drive-oauth.mjs --client-file <private-client.json> [--env-file .env.backend.local] [--port 4583]');return;}
  const value=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
  const clientFile=value('--client-file','');if(!clientFile)throw Error('Client OAuth khusus Gate belum tersedia. Siapkan JSON client Desktop yang baru di dalam scratch/; jangan memakai client login Irsyads.');
  const envFile=path.resolve(value('--env-file','.env.backend.local'));
  const env=parsePrivateEnv(await readFile(envFile,'utf8'));if(env.GATE_DRIVE_REFRESH_TOKEN)throw Error('Koneksi sudah ada; konfigurasi tidak ditimpa otomatis.');
  const port=Number(value('--port','4583'));if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Port loopback tidak valid.');
  const json=JSON.parse(await readFile(path.resolve(clientFile),'utf8'));if(!json.installed)throw Error('Gunakan JSON client Desktop khusus Gate, bukan client web login Irsyads.');
  const baseUrl='http://127.0.0.1:'+port;
  const handler=createDriveOAuthSetup({client:json.installed,parentFolderId:env.GATE_DRIVE_PARENT_FOLDER_ID||env.GATE_DRIVE_FOLDER_ID,expectedOwnerEmail:env.GATE_DRIVE_OWNER_EMAIL,save:patch=>savePrivateEnv(envFile,patch),baseUrl});
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/start')console.error(JSON.stringify({origin:req.headers.origin,type:req.headers['content-type'],host:req.headers.host}));
    try{let body='';for await(const chunk of req){body+=chunk;if(body.length>2000){res.writeHead(413);res.end();return;}}const request=new Request(new URL(req.url,baseUrl),{method:req.method,headers:req.headers,...(body?{body}: {})});const result=await handler(request);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());}
    catch{res.writeHead(500,{'Cache-Control':'no-store'});res.end('Setup lokal belum dapat memproses permintaan. Rahasia tidak ditampilkan.');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  console.log('Setup foto Gate: '+baseUrl+' — meminta drive.file saja. Tidak ada deploy atau unggahan foto.');
  setTimeout(()=>server.close(),15*60000).unref();
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error.message);process.exitCode=1;});
