/** Bentuk autentikasi yang dibutuhkan pos; implementasi nyata ada di auth-supabase.ts. */
export interface GateUser { id: string; email: string | null; name: string | null }

export interface GateAuth {
  getUser(): Promise<GateUser | null>;
  /** Alamat Irsyads ID yang memulangkan petugas ke pos ini setelah masuk. */
  loginUrl(): string;
  /** Hanya mengakhiri sesi di perangkat ini (scope local), bukan perangkat lain. */
  signOut(): Promise<void>;
  /** Dipanggil saat sesi berubah (masuk, keluar, token diperbarui). */
  subscribe(cb: () => void): () => void;
}
