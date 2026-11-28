'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { TZ, fmtDT } from '../lib/util';

const SHIFT = { A: 'A Vardiyası', B: 'B Vardiyası', C: 'C Vardiyası' };
// Kıbrıs saatine göre şu anki vardiya: 08–16 A, 16–24 B, 00–08 C
export const nowShift = () => {
  const h = Number(new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).slice(0, 2));
  return h >= 16 ? 'B' : h >= 8 ? 'A' : 'C';
};

function useNotes(c, since, limit) {
  const [notes, setNotes] = useState(null); const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    let q = supabase.from('handover_notes').select('*').order('created_at', { ascending: false }).limit(limit);
    if (since) q = q.gte('created_at', since);
    q.then(({ data, error }) => { if (!live) return; if (error) setErr(error.message); else setNotes(data || []); });
    return () => { live = false; };
  }, [c.ver, since, limit]);
  return [notes, setNotes, err];
}

/* Görevlerim ekranının üstünde: son 24 saatin devir notları */
export function HandoverBanner({ c }) {
  const [since] = useState(() => new Date(Date.now() - 24 * 3600e3).toISOString());
  const [notes] = useNotes(c, since, 3);
  if (!notes?.length) return null;
  return (
    <div className="handover">
      <b>Devir notları</b>
      {notes.map(n => (
        <div key={n.id} className="hn"><span className="meta">{SHIFT[n.from_shift]} · {c.names[n.created_by] || '—'} · {fmtDT(n.created_at)}</span><div>{n.body}</div></div>
      ))}
    </div>
  );
}

/* Devir notları sekmesi */
export function HandoverScreen({ c }) {
  const [notes, setNotes, loadErr] = useNotes(c, null, 100);
  const [shift, setShift] = useState(nowShift()); const [body, setBody] = useState('');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);

  const add = async e => {
    e.preventDefault(); setMsg('');
    if (!body.trim()) { setMsg('Not yazın.'); return; }
    setBusy(true);
    const { data, error } = await supabase.from('handover_notes').insert({ from_shift: shift, body: body.trim() }).select().single();
    setBusy(false);
    if (error) { setMsg('Kaydedilemedi: ' + error.message); return; }
    setNotes([data, ...(notes || [])]); setBody('');
  };
  const del = async n => {
    if (!confirm('Not silinsin mi?')) return;
    const { error } = await supabase.from('handover_notes').delete().eq('id', n.id);
    if (error) setMsg(error.message); else setNotes(notes.filter(x => x.id !== n.id));
  };

  return (<>
    <h2>Devir notları</h2>
    <form className="card" onSubmit={add}>
      <div className="inline" style={{ marginBottom: 8 }}>
        <label style={{ margin: 0 }} htmlFor="hn-shift">Devreden vardiya</label>
        <select id="hn-shift" value={shift} onChange={e => setShift(e.target.value)}>
          {Object.entries(SHIFT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={2000} placeholder="Bir sonraki vardiyanın bilmesi gerekenler (yarım kalan işler, misafir istekleri, arızalar…)" aria-label="Devir notu" />
      {msg && <div className="err">{msg}</div>}
      <div style={{ marginTop: 10 }}><button className="btn" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Not ekle'}</button></div>
    </form>
    {loadErr && <div className="err">Notlar yüklenemedi: {loadErr}</div>}
    {notes && !notes.length && <p className="empty">Henüz devir notu yok.</p>}
    {(notes || []).map(n => (
      <div className="card" key={n.id}>
        <div className="inline" style={{ justifyContent: 'space-between' }}>
          <span className="meta"><b>{SHIFT[n.from_shift]}</b> · {c.names[n.created_by] || '—'} · {fmtDT(n.created_at)}</span>
          {(c.isMgr || n.created_by === c.me.id) && <button className="btn ghost sm" onClick={() => del(n)}>Sil</button>}
        </div>
        <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{n.body}</div>
      </div>
    ))}
  </>);
}
