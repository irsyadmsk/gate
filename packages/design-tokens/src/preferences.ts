export type AppearanceValues = { theme: 'system' | 'light' | 'dark'; palette: 'krem' | 'forest' | 'ocean' | 'royal' | 'aurora' | 'earth'; language: 'en' | 'id' | 'ar' | 'zh'; motion: 'system' | 'full' | 'reduce' };
export type AccountTicket = { account: string | null; epoch: number; explicit: number; revision: number };
export interface PreferenceRuntime {
  version: number;
  get(): AppearanceValues;
  envelope(): {version:number;revision:number;source:string;values:AppearanceValues};
  validate(value:unknown): boolean;
  set(patch: Partial<AppearanceValues>): boolean;
  subscribe(listener: (values: AppearanceValues, reason: string) => void): () => void;
  setAccount(id: string | null): void;
  accountTicket(): AccountTicket;
  applyAccount(values: Partial<AppearanceValues>, ticket: AccountTicket): boolean;
}
declare global { interface Window { IrsyadsPreferences?: PreferenceRuntime } }
