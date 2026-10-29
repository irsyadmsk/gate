import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";

const paths: Record<string, string> = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  scan: "M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4M7 12h10M8 8h1m6 0h1M8 16h1m6 0h1",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m8 .13a4 4 0 0 1 0 7.75",
  shield: "M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7Zm-4 9 3 3 5-5",
  permit: "M8 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-3M8 2h8v4H8Zm0 10h8m-8 5h5",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  plus: "M12 5v14M5 12h14",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  chevron: "m9 5 7 7-7 7",
  logout: "M9 3H4v18h5m6-14 5 5-5 5m-7-5h12",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  file: "M14 2H5v20h14V7Zm0 0v6h5M8 12h8m-8 4h8",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  printer: "M6 9V3h12v6M6 18H3v-8h18v8h-3M6 15h12v7H6Zm11-3h1",
  menu: "M4 6h16M4 12h16M4 18h16",
  key: "M15 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0m-1 4 8 8m-5-2 2-2m1 5 2-2",
  car: "m5 4-3 8v7h3v-3h14v3h3v-7l-3-8ZM2 12h20M6 13v1m12-1v1",
  info: "M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  refresh: "M20 7v5h-5M4 17v-5h5m10-4a8 8 0 0 0-13-3L3 8m18 8-3 3A8 8 0 0 1 5 16",
  camera: "M7 6 9 3h6l2 3h5v15H2V6Zm10 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  school: "m2 10 10-7 10 7M4 10v11h16V10M9 21v-7h6v7M9 9h6",
};
export function Icon({ name, size = 22 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.info} /></svg>; }
export function Tag({ tone = "neutral", children }: { tone?: string; children: ReactNode }) { return <span className={`gc-tag gc-tag-${tone}`}><span aria-hidden="true" />{children}</span>; }
export function Empty({ title, children, icon = "permit" }: { title: string; children?: ReactNode; icon?: string }) { return <div className="gc-empty"><span><Icon name={icon} size={28} /></span><h3>{title}</h3>{children && <p>{children}</p>}</div>; }
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  const control = isValidElement(children) ? cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, { id, "aria-describedby": hint ? `${id}-hint` : undefined }) : children;
  return <div className="gc-field"><label htmlFor={id}>{label}</label>{control}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function Check({ label, name, required = false, checked, onChange }: { label: string; name?: string; required?: boolean; checked?: boolean; onChange?: (v: boolean) => void }) { return <label className="gc-check"><input type="checkbox" name={name} required={required} checked={checked} onChange={onChange ? (e) => onChange(e.target.checked) : undefined} /><span>{label}</span></label>; }
export function Modal({ title, subtitle, children, close }: { title: string; subtitle?: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const savedClose = useRef(close); savedClose.current = close;
  useEffect(() => {
    const d = ref.current!; const previous = document.activeElement as HTMLElement | null;
    d.showModal();
    const cancel = (event: Event) => { event.preventDefault(); savedClose.current(); };
    d.addEventListener("cancel", cancel);
    return () => { d.removeEventListener("cancel", cancel); d.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="gc-dialog" aria-labelledby="gc-dialog-title"><div className="gc-dialog-head"><div><h2 id="gc-dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="gc-icon-button" aria-label="Tutup" onClick={close}><Icon name="close" /></button></div><div className="gc-dialog-body">{children}</div></dialog>;
}
export const timeWib = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }) : "—";
export const dateWib = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short" }) : "—";
export const fullWib = (iso?: string | null) => iso ? `${dateWib(iso)}, ${timeWib(iso)} WIB` : "—";
export const inputWib = (date: Date | string) => new Date(new Date(date).getTime() + 7 * 3600_000).toISOString().slice(0, 16);
export const fromWib = (value: FormDataEntryValue | null) => value ? new Date(`${value}:00+07:00`).toISOString() : "";
export const newReference = () => crypto.randomUUID();
export const cardToken = (kind: "student" | "staff") => `${kind === "student" ? "MUR" : "GTK"}-${crypto.randomUUID().replace(/-/g, "")}`;
export const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((v) => v[0]).join("");
export function QrImage({ token, label = "Kode QR" }: { token: string; label?: string }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; setSrc(""); setFailed(false); import("qrcode").then((q) => q.toDataURL(token, { width: 400, margin: 3, errorCorrectionLevel: "M", color: { dark: "#14283e", light: "#ffffff" } })).then((value) => { if (active) setSrc(value); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, [token]);
  return src ? <img src={src} alt={label} width={190} height={190} /> : <p role="status">{failed ? "QR belum bisa dibuat. Gunakan kode tertulis." : "Menyiapkan QR…"}</p>;
}
