import { googleDrivePhotos } from '../_shared/gate-photo-drive.ts';
import { nativeGateHandler } from '../_shared/gate-console-handler.ts';
import { nativeStore } from '../_shared/gate-console-store.ts';
const env=(name:string)=>Deno.env.get(name) ?? '';
const photos=googleDrivePhotos({clientId:env('GATE_DRIVE_CLIENT_ID'),clientSecret:env('GATE_DRIVE_CLIENT_SECRET'),refreshToken:env('GATE_DRIVE_REFRESH_TOKEN'),folderId:env('GATE_DRIVE_FOLDER_ID'),parentId:env('GATE_DRIVE_PARENT_FOLDER_ID')});
Deno.serve(nativeGateHandler(nativeStore,false,photos));
