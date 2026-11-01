import type { PhotoProvider } from './gate-photos.ts';
import type { GatePhoto } from '../../../packages/gate/src/operations.ts';

export interface DriveConfig { clientId: string; clientSecret: string; refreshToken: string; folderId: string; parentId?: string }
export function googleDrivePhotos(config: DriveConfig, request: typeof fetch = fetch): PhotoProvider {
  let cached: {token:string;until:number} | undefined;
  const ready=!!(config.clientId&&config.clientSecret&&config.refreshToken&&/^[A-Za-z0-9_-]{10,200}$/.test(config.folderId));
  const failure=()=>({status:503,message:'Google Drive belum dapat mengonfirmasi foto. Ulangi unggahan dengan referensi yang sama.'});
  async function token() {
    if(cached && cached.until>Date.now()+60000) return cached.token;
    const response=await request('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw failure();const data=await response.json();if(!data.access_token)throw failure();
    cached={token:data.access_token,until:Date.now()+Math.min(Number(data.expires_in)||3600,3600)*1000};return cached.token;
  }
  async function api(url:string,init:RequestInit={}) {
    const response=await request(url,{...init,headers:{...init.headers,Authorization:'Bearer '+await token()},signal:AbortSignal.timeout(30000)});
    return response;
  }
  const fileUrl=(id:string,fields:string)=>{if(!/^[A-Za-z0-9_-]{10,200}$/.test(id))throw failure();return 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?supportsAllDrives=true&fields='+encodeURIComponent(fields);};
  async function privateFolder() {
    const r=await api(fileUrl(config.folderId,'id,mimeType,trashed,parents,permissions(type),capabilities(canAddChildren)'));
    if(!r.ok)throw failure();const folder=await r.json();
    if(config.parentId && !folder.parents?.includes(config.parentId))throw {status:503,message:'Folder foto belum ditempatkan pada folder tujuan Gate yang disetujui.'};
    if(folder.trashed || folder.mimeType!=='application/vnd.google-apps.folder' || !folder.capabilities?.canAddChildren || !Array.isArray(folder.permissions) || folder.permissions.some((p:any)=>['anyone','domain'].includes(p.type))) throw {status:503,message:'Folder foto harus privat dan akun penyimpanan harus dapat menambahkan berkas.'};
  }
  async function metadata(id:string) {const r=await api(fileUrl(id,'id,size,mimeType,parents,appProperties,trashed'));if(!r.ok)throw failure();return r.json();}
  function check(data:any,photo?:GatePhoto) {
    if(data.trashed || data.mimeType!=='image/jpeg' || !data.parents?.includes(config.folderId) || (photo && (data.appProperties?.gateDigest!==photo.digest || Number(data.size)!==photo.size)))throw failure();
  }
  return {
    name:'Google Drive',ready,verify:privateFolder,
    async newId(){await privateFolder();const r=await api('https://www.googleapis.com/drive/v3/files/generateIds?count=1&fields=ids');if(!r.ok)throw failure();const data=await r.json();if(!/^[A-Za-z0-9_-]{10,200}$/.test(data.ids?.[0]))throw failure();return data.ids[0];},
    async upload(fileId,bytes,photo) {
      await privateFolder();
      const boundary='gate_'+crypto.randomUUID().replaceAll('-','');
      const info={id:fileId,name:photo.name,mimeType:'image/jpeg',parents:[config.folderId],appProperties:{gatePhoto:photo.id,gateEntry:photo.entryId,gateDigest:photo.digest}};
      const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(info)}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`,bytes as BlobPart,`\r\n--${boundary}--\r\n`]);
      const r=await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,size,mimeType,parents,appProperties',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
      if(r.status===409) {check(await metadata(fileId),photo);return;}
      if(!r.ok)throw failure();check(await r.json(),photo);
    },
    async read(fileId) {
      await privateFolder();const meta=await metadata(fileId);check(meta);if(Number(meta.size)>1_500_000)throw failure();
      const r=await api('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media&supportsAllDrives=true');if(!r.ok)throw failure();
      const reader=r.body?.getReader();if(!reader)throw failure();const chunks:Uint8Array[]=[];let size=0;
      while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1_500_000){await reader.cancel();throw failure();}chunks.push(part.value);}
      const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
    },
  };
}
