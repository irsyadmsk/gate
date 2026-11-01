import { useEffect, useRef, useState } from 'react';
import { boardingReport, boardingXlsx, boardingDocx, hasRole, wibDay, type BoardingSnapshot, type BoardingReportKind } from '@irsyads/gate-core';
import type { ConsoleService } from '../../lib/boarding-http';
import { Field, Empty, Icon, newReference } from './ui';
const labels:Record<BoardingReportKind,string>={movements:'Keluar masuk murid / GTK',permits:'Izin murid',visits:'Riwayat tamu',handover:'Pergantian jaga',shifts:'Jadwal & pelaksanaan jaga',incidents:'Catatan kejadian & foto',duty:'Seluruh buku jaga',audit:'Jejak audit',activity:'Seluruh aktivitas Gate'};
const csv=(value:string)=>'"'+(/^[=+\-@\t\r]/.test(value)?"'":'')+value.replaceAll('"','""')+'"';
function save(name:string,type:string,data:string|Uint8Array) {const url=URL.createObjectURL(new Blob([data as BlobPart],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export default function GateReports({service}:{service:ConsoleService}) {
  const [from,setFrom]=useState(wibDay(new Date())),[until,setUntil]=useState(wibDay(new Date())),[kind,setKind]=useState<BoardingReportKind>('movements');
  const [loaded,setLoaded]=useState(''),[snapshot,setSnapshot]=useState<BoardingSnapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const sequence=useRef(0),lock=useRef(false);
  async function load() {const ticket=++sequence.current;setBusy(true);setError('');setLoaded('');try{const s=await service.snapshot({from,until});if(ticket===sequence.current){if(!hasRole(s.actor,'admin','guard'))throw Error('Laporan operasional hanya untuk admin dan satpam aktif.');setSnapshot(s);setLoaded(from+'/'+until);}}catch(e){if(ticket===sequence.current)setError((e as Error).message);}finally{if(ticket===sequence.current)setBusy(false);}}
  useEffect(()=>{void load();return()=>{++sequence.current;};},[service]);
  const report=snapshot&&loaded===from+'/'+until&&!busy&&!error?boardingReport(snapshot,kind,from,until):null;
  async function exportFile(format:'csv'|'xlsx'|'docx'|'print') {
    if(!report||!snapshot||lock.current)return;lock.current=true;setBusy(true);setError('');
    try{
      // Re-read the exact range and revalidate the account before creating an export.
      const current=await service.snapshot({from,until});if(!hasRole(current.actor,'admin','guard'))throw Error('Hak laporan Gate tidak aktif.');
      const fresh=boardingReport(current,kind,from,until);
      await service.command({id:newReference(),type:'report.export',data:{kind,from,until,format}});
      setSnapshot(current);setLoaded(from+'/'+until);const name=`gate-${kind}-${from}-${until}`;
      if(format==='csv')save(name+'.csv','text/csv;charset=utf-8','\ufeff'+[fresh.headers,...fresh.rows].map(row=>row.map(csv).join(',')).join('\r\n'));
      if(format==='xlsx')save(name+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',boardingXlsx(fresh));
      if(format==='docx')save(name+'.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',boardingDocx(fresh,current.settings.siteName,from+' s.d. '+until));
      if(format==='print'){setBusy(false);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));window.print();}
    }catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}
  }
  return <><div className="gc-page-head gc-no-print"><div><h1>Riwayat & laporan.</h1><p>Cetak dan ekspor riwayat tamu, pergerakan, pergantian jaga, kejadian, dan aktivitas Gate.</p></div></div><section className="gc-section"><form className="gw-filter gc-no-print" onSubmit={e=>{e.preventDefault();void load();}}><Field label="Jenis laporan"><select value={kind} onChange={e=>setKind(e.target.value as BoardingReportKind)}>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field><Field label="Dari tanggal · WIB"><input type="date" required value={from} onChange={e=>{++sequence.current;setBusy(false);setFrom(e.target.value);}}/></Field><Field label="Sampai tanggal · WIB"><input type="date" required min={from} value={until} onChange={e=>{++sequence.current;setBusy(false);setUntil(e.target.value);}}/></Field><button type="submit" disabled={busy} className="gc-primary">{busy?'Memproses…':'Tampilkan riwayat'}</button></form>{error&&<p className="gc-callout gc-error" role="alert">{error}</p>}<div className="gc-section-head"><div><h2>{labels[kind]}</h2><p>{report?`${report.rows.length} catatan · ${from} s.d. ${until}`:'Tampilkan rentang tanggal untuk menyiapkan laporan.'}</p></div><div className="gc-actions gc-no-print">{(['csv','xlsx','docx','print'] as const).map(format=><button type="button" key={format} disabled={!report||busy} onClick={()=>void exportFile(format)}>{format==='print'?<><Icon name="printer" size={16}/>Cetak</>:format==='xlsx'?'Excel':format==='docx'?'Word':'CSV'}</button>)}</div></div>{report?.rows.length?<div className="gc-table-scroll"><table className="gc-table"><thead><tr>{report.headers.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{report.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j} data-label={report.headers[j]}>{cell}</td>)}</tr>)}</tbody></table></div>:<Empty title={busy?'Memuat riwayat…':'Belum ada riwayat ditampilkan'}>Ubah jenis atau rentang tanggal, kemudian tampilkan riwayat.</Empty>}</section></>;
}
