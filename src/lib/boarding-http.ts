import type { BoardingCommand, BoardingService, BoardingSnapshot, GuestReceipt, GuestRegistration, GateActor } from "@irsyads/gate-core";

export class GateHttpError extends Error { constructor(message: string, public status: number) { super(message); this.name = "GateHttpError"; } }
export async function localGateRequest<T>(path: string, data?: unknown): Promise<T> {
  const res = await fetch(path, { method: data === undefined ? "GET" : "POST", credentials: "same-origin", headers: data === undefined ? {} : { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(12000), cache: "no-store" });
  const result = await res.json().catch(() => ({ error: "Respons layanan tidak dapat dibaca." }));
  if (!res.ok) throw new GateHttpError(result.error || "Layanan belum dapat dihubungi.", res.status);
  return result as T;
}
export interface ConsoleService extends BoardingService {
  cards(ids: string[], reference: string): Promise<{people: import('@irsyads/gate-core').GatePerson[];reference:string}>;
  storageInfo(): Promise<{ready:boolean;provider:string;maxBytes:number}>;
  uploadPhoto(entryId:string,reference:string,base64:string): Promise<{id:string;entryId:string;status:string}>;
  readPhoto(reference:string): Promise<{mimeType:string;base64:string}>;
  lookup(token: string): Promise<{ kind: "person" | "visit"; id: string }>;
}
/** Hanya fixture loopback memakai adapter ini. Tidak diimpor GateRoot produksi. */
export const localBoardingService: ConsoleService = {
  snapshot: (range) => localGateRequest<BoardingSnapshot>('/api/operations',{op:'snapshot',range}),
  cards: (ids,reference) => localGateRequest('/api/operations',{op:'cards.print',ids,reference}),
  storageInfo: () => localGateRequest('/api/operations',{op:'storage.info'}),
  uploadPhoto: (entryId,reference,base64) => localGateRequest('/api/operations',{op:'photo.upload',entryId,reference,base64}),
  readPhoto: (reference) => localGateRequest('/api/operations',{op:'photo.read',reference}),
  command: (command: BoardingCommand) => localGateRequest("/api/command", command),
  lookup: (token) => localGateRequest("/api/lookup", { token }),
  logout: () => localGateRequest("/api/logout", {}),
};
export interface GuestOptions { siteName: string; hosts: { id: string; name: string }[]; retentionDays: number }
export interface GuestService {
  options(): Promise<GuestOptions>;
  register(input: GuestRegistration, reference: string, secret: string): Promise<GuestReceipt>;
  status(secret: string): Promise<GuestReceipt>;
  cancel(secret: string): Promise<GuestReceipt>;
}
export const localGuestService: GuestService = {
  options: () => localGateRequest("/api/guest-options"),
  register: (input, reference, secret) => localGateRequest("/api/guest-register", { input, reference, secret }),
  status: (secret) => localGateRequest("/api/guest-status", { secret }),
  cancel: (secret) => localGateRequest("/api/guest-cancel", { secret }),
};
export const localSession = () => localGateRequest<{ actor: GateActor | null }>("/api/session");
export const localLogin = (username: string, password: string) => localGateRequest<{ actor: GateActor }>("/api/login", { username, password });
