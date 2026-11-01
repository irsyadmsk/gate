import { GateRuleError, requireGateOperator } from './gate-console-engine.js';
import type { GatePhoto } from '../../../packages/gate/src/operations.ts';
import type { GateActor } from '../../../packages/gate/src/boarding.ts';
import type { NativeGateStore } from './gate-console-handler.ts';

export const MAX_PHOTO_BYTES = 1_500_000;
export interface PhotoProvider {
  name: string; ready: boolean;
  verify?(): Promise<void>;
  newId(): Promise<string>;
  upload(fileId: string, bytes: Uint8Array, photo: GatePhoto): Promise<void>;
  read(fileId: string): Promise<Uint8Array>;
}
const fail = (message: string): never => { throw new GateRuleError('invalid', message); };
export const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2,'0')).join('');
export const base64 = (bytes: Uint8Array) => { let out=''; for(let i=0;i<bytes.length;i+=8192) out+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(out); };
export function photoBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_PHOTO_BYTES/3)*4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('Foto tidak valid atau melebihi 1,5 MB.');
  let raw: string; try { raw=atob(value as string); } catch { return fail('Foto tidak dapat dibaca.'); }
  const bytes=Uint8Array.from(raw!, c=>c.charCodeAt(0));
  if (bytes.length>MAX_PHOTO_BYTES || bytes.length<20 || bytes[0]!==255 || bytes[1]!==216 || bytes.at(-2)!==255 || bytes.at(-1)!==217) fail('Gunakan foto JPEG yang diproses Gate.');
  // Read JPEG frame dimensions before serving an image to another officer.
  let dimensions=false;
  for(let i=2;i+9<bytes.length;) {
    if(bytes[i]!==255) break; const marker=bytes[i+1];
    if(marker===0xda || marker===0xd9) break;
    if(marker===0xff){i++;continue;}
    const length=(bytes[i+2]<<8)|bytes[i+3]; if(length<2 || i+2+length>bytes.length) break;
    if([0xc0,0xc1,0xc2].includes(marker)) { const height=(bytes[i+5]<<8)|bytes[i+6],width=(bytes[i+7]<<8)|bytes[i+8]; if(!width||!height||width>2000||height>2000) fail('Dimensi foto melebihi batas.'); dimensions=true;break; }
    i+=length+2;
  }
  if(!dimensions) fail('Format atau dimensi JPEG tidak valid.');
  return bytes;
}
export async function photoOperation(store: NativeGateStore, provider: PhotoProvider | undefined, actor: GateActor, body: any) {
  let state=await store.read('',undefined,true); actor=requireGateOperator(state,actor);
  if(body.op==='storage.info' && provider?.ready && provider.verify) await provider.verify();
  if(body.op==='storage.info') return {ready:provider?.ready===true,provider:provider?.name ?? 'Google Drive',maxBytes:MAX_PHOTO_BYTES};
  if(!provider?.ready) throw {status:503,message:'Penyimpanan foto belum dihubungkan oleh admin. Catatan teks tetap dapat disimpan.'};
  if(!/^[a-zA-Z0-9_-]{8,80}$/.test(String(body.reference))) fail('Referensi foto tidak valid.');
  if(body.op==='photo.read') {
    const photo=state.photos?.find(p=>p.id===body.reference && p.status==='ready');
    if(!photo || !state.entries.some(e=>e.id===photo.entryId)) throw new GateRuleError('gone','Foto tidak ditemukan.');
    const bytes=await provider.read(photo.fileId);
    if(bytes.length!==photo.size || await sha256(bytes)!==photo.digest) throw {status:503,message:'Integritas foto belum dapat dikonfirmasi.'};
    requireGateOperator(await store.read('',undefined,true),await store.identity(String(body.authorization)));
    return {mimeType:'image/jpeg',base64:base64(bytes)};
  }
  if(body.op!=='photo.upload') fail('Tindakan foto tidak dikenal.');
  const bytes=photoBytes(body.base64),digest=await sha256(bytes);
  let photo: GatePhoto | undefined;
  for(let attempt=0;attempt<5;attempt++) {
    state=await store.read('',undefined,true); requireGateOperator(state,actor);
    if(!state.entries.some(e=>e.id===body.entryId)) throw new GateRuleError('gone','Simpan catatan kejadian sebelum mengunggah foto.');
    photo=state.photos?.find(p=>p.id===body.reference);
    if(photo) { if(photo.entryId!==body.entryId || photo.digest!==digest || photo.uploadedBy!==actor.id) throw new GateRuleError('conflict','Referensi foto dipakai untuk berkas berbeda.'); break; }
    if((state.photos ?? []).filter(p=>p.entryId===body.entryId).length>=8) fail('Maksimal delapan foto per catatan.');
    const fileId=await provider.newId();
    photo={id:body.reference,entryId:body.entryId,name:'kejadian-'+body.reference+'.jpg',mimeType:'image/jpeg',size:bytes.length,digest,fileId,uploadedBy:actor.id,createdAt:new Date().toISOString(),status:'uploading'};
    const next=structuredClone(state);next.revision++;next.photos=[...(next.photos ?? []),photo];
    if(await store.commit(state.revision,next)) break;
    photo=undefined;
  }
  if(!photo) throw new GateRuleError('conflict','Catatan sedang berubah. Ulangi dengan foto dan referensi yang sama.');
  if(photo.status==='ready') return {id:photo.id,entryId:photo.entryId,status:'ready'};
  // The Drive file ID was persisted before the upload. Lost responses and concurrent retries reuse it.
  await provider.upload(photo.fileId,bytes,photo);
  for(let attempt=0;attempt<5;attempt++) {
    state=await store.read('',undefined,true); requireGateOperator(state,await store.identity(String(body.authorization)));
    const current=state.photos?.find(p=>p.id===photo!.id);
    if(current?.status==='ready') return {id:current.id,entryId:current.entryId,status:'ready'};
    if(!current || current.digest!==digest || current.fileId!==photo.fileId) throw new GateRuleError('conflict','Referensi unggahan berubah. Hubungi admin.');
    const next=structuredClone(state);next.revision++;next.photos!.find(p=>p.id===photo!.id)!.status='ready';
    next.audit.unshift({id:'photo-'+photo.id,at:new Date().toISOString(),actorId:actor.id,actorName:actor.name,action:'Foto kejadian disimpan',target:photo.entryId,note:photo.name});
    if(await store.commit(state.revision,next)) return {id:photo.id,entryId:photo.entryId,status:'ready'};
  }
  throw new GateRuleError('conflict','Foto telah diunggah; konfirmasi tertunda. Ulangi dengan referensi yang sama.');
}
