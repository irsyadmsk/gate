import { nativeGateHandler } from '../_shared/gate-console-handler.ts';
import { nativeStore } from '../_shared/gate-console-store.ts';
Deno.serve(nativeGateHandler(nativeStore));
