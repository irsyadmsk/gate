import { applyBoardingCommand, boardingSnapshot, createDemoState, DEMO_ACTORS, expireBoardingGuests, findCredential, GateRuleError, printableCards } from "@irsyads/gate-core";
import { GateHttpError, type ConsoleService } from "./boarding-http";

const STATUS = { denied: 403, invalid: 400, conflict: 409, gone: 404 } as const;

/**
 * Mode demo (K4): engine Gate yang sama dengan server, tetapi data contoh hidup di memori dan hilang saat
 * keluar atau muat ulang. Tidak ada jaringan, sesi, atau penyimpanan; foto dinonaktifkan.
 */
export function createDemoService(actorId: string, now: () => Date = () => new Date(), cleanup: () => Promise<void> = () => Promise.resolve()): ConsoleService {
  const actor = DEMO_ACTORS.find((candidate) => candidate.id === actorId);
  if (!actor) throw new Error("Peran demo tidak dikenal.");
  let state = createDemoState(now());
  const run = <T>(work: () => T): Promise<T> => {
    try { return Promise.resolve(work()); }
    catch (error) {
      if (error instanceof GateRuleError) return Promise.reject(new GateHttpError(error.message, STATUS[error.code]));
      return Promise.reject(error);
    }
  };
  const noPhotos = () => Promise.reject(new GateHttpError("Foto kejadian tidak tersedia di mode demo.", 503));
  return {
    snapshot: () => run(() => { state = expireBoardingGuests(state, now()); return boardingSnapshot(state, actor, DEMO_ACTORS, now()); }),
    command: (command) => run(() => { const result = applyBoardingCommand(state, actor, command, now(), DEMO_ACTORS); state = result.state; return { target: result.target, duplicate: result.duplicate }; }),
    cards: (ids, reference) => run(() => {
      const people = printableCards(state, actor, ids);
      state = applyBoardingCommand(state, actor, { id: reference, type: "cards.print", data: { ids } }, now(), DEMO_ACTORS).state;
      return { people, reference };
    }),
    lookup: (token) => run(() => findCredential(state, actor, String(token).slice(0, 120))),
    storageInfo: () => Promise.resolve({ ready: false, provider: "Mode demo", maxBytes: 0 }),
    uploadPhoto: noPhotos,
    readPhoto: noPhotos,
    logout: () => cleanup(), // berkas ekspor sementara ikut dibuang, sama seperti keluar akun yang sebenarnya
  };
}
