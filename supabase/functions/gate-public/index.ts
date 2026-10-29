import { nativeGateHandler } from '../_shared/gate-console-handler.ts';
import { nativeStore } from '../_shared/gate-console-store.ts';
// This endpoint accepts only public registration/status actions; no privileged command dispatch.
Deno.serve(nativeGateHandler(nativeStore, true));
