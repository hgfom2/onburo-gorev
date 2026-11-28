'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { compressJpeg } from '../lib/image';

/* Görev sorgularına alt maddeleri ve kasa devri kaydını ekler */
export const TASK_SELECT = '*, task_items(id,label,assignee,done,sort), cash_handovers(giver,receiver,report_path)';
const one = x => (Array.isArray(x) ? x[0] : x) || null; // PostgREST bire-bir ilişkiyi nesne ya da dizi döndürebilir
export const itemsOf = t => [...(t.task_items || [])].sort((a, b) => a.sort - b.sort);
export const cashOf = t => one(t.cash_handovers);

/* ---------- Görev kartı içindeki alt maddeler ---------- */
export function ItemsList({ t, c }) {
  const items = itemsOf(t);
  if (!items.length) return null;
  const tick = async i => {
    const done = !i.done;
    const { error } = await supabase.from('task_items').update({ done }).eq('id', i.id);
    if (error) return;
    const next = t.task_items.map(x => (x.id === i.id ? { ...x, done } : x));
    // Veritabanı tetikleyicisiyle aynı kural: tüm maddeler bitince görev tamamlanır, madde geri alınınca yeniden açılır
    const f = { task_items: next };
    if (t.kind === 'normal' && t.status === 'open' && next.every(x => x.done)) { f.status = 'done'; f.completed_at = new Date().toISOString(); }
    if (t.kind === 'normal' && t.status === 'done' && !done) { f.status = 'open'; f.completed_at = null; }
    c.patch(t.id, f);
  };
  const reassign = async (i, uid) => {
    const { error } = await supabase.from('task_items').update({ assignee: uid || null }).eq('id', i.id);
    if (!error) c.patch(t.id, { task_items: t.task_items.map(x => (x.id === i.id ? { ...x, assignee: uid || null } : x)) });
  };
  return (
    <div className="items">
      {items.map(i => (
        <div key={i.id} className={`item ${i.done ? 'done' : ''} ${i.assignee === c.me.id ? 'mine' : ''}`}>
          <label>
            <input type="checkbox" checked={i.done} disabled={t.status === 'cancelled'} onChange={() => tick(i)} />
            {i.label}
          </label>
          {c.isMgr
            ? <select className="assign" value={i.assignee || ''} onChange={e => reassign(i, e.target.value)} aria-label="Madde sorumlusu">
                <option value="">Atanmamış</option>
                {c.people.filter(p => p.active || p.id === i.assignee).map(p => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}
              </select>
            : <span className="meta">{c.names[i.assignee] || 'Atanmamış'}</span>}
        </div>
      ))}
    </div>
  );
}

/* ---------- Şablon formunda alt madde düzenleyici ---------- */
// Her madde: { label, by: { A: kişiId, B: kişiId, ... } } — sorumlu seçili her vardiya için ayrı seçilir
export function ItemsEditor({ items, setItems, people, mgrOnly, shifts }) {
  const upd = (k, f) => setItems(items.map((x, n) => (n === k ? { ...x, ...f } : x)));
  const setBy = (k, s, v) => upd(k, { by: { ...(items[k].by || {}), [s]: v } });
  const staff = people.filter(p => p.active && !(mgrOnly && p.role === 'receptionist'));
  return (
    <div style={{ marginTop: 12 }}>
      <label>Alt maddeler (isteğe bağlı){shifts.length > 1 ? ' — sorumlu her vardiya için ayrı seçilir' : ' — her biri ayrı kişiye atanabilir'}</label>
      {items.map((it, k) => (
        <div key={k} style={{ marginBottom: 10 }}>
          <div className="inline" style={{ marginBottom: 4 }}>
            <input style={{ flex: 1 }} placeholder="örn. Casino grubu" value={it.label} onChange={e => upd(k, { label: e.target.value })} />
            <button type="button" className="btn ghost sm" aria-label="Maddeyi sil" onClick={() => setItems(items.filter((_, n) => n !== k))}>×</button>
          </div>
          <div className="inline">
            {shifts.map(s => (
              <span key={s} className="inline">
                {shifts.length > 1 && <span className="meta">{s}</span>}
                <select value={it.by?.[s] || ''} onChange={e => setBy(k, s, e.target.value)} aria-label={`${s} vardiyası sorumlusu`}>
                  <option value="">Atanmamış</option>
                  {staff.map(p => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}
                </select>
              </span>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={() => setItems([...items, { label: '', by: {} }])}>+ Madde ekle</button>
    </div>
  );
}

/* ---------- Kasa devri ---------- */
export function CashInfo({ t, c }) {
  const h = cashOf(t);
  if (!h) return null;
  const view = async e => {
    e.preventDefault();
    const w = window.open('', '_blank'); // tıklama anında aç (açılır pencere engelleyicileri için)
    const { data } = await supabase.storage.from('kasa-raporlari').createSignedUrl(h.report_path, 300);
    if (data?.signedUrl && w) w.location.href = data.signedUrl; else if (w) w.close();
  };
  return (
    <div className="meta">
      Devreden: <b>{c.names[h.giver] || '—'}</b> → Alan: <b>{c.names[h.receiver] || '—'}</b> · <a href="#" onClick={view}>Kasa raporu</a>
    </div>
  );
}

export function CashForm({ t, c, onCancel, onDone }) {
  const existing = cashOf(t);
  const people = c.people.filter(p => p.active);
  const [giver, setGiver] = useState(existing?.giver || c.me.id);
  const [receiver, setReceiver] = useState(existing?.receiver || '');
  const [file, setFile] = useState(null); const [preview, setPreview] = useState('');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = async e => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const blob = await compressJpeg(f); setFile(blob); setPreview(URL.createObjectURL(blob)); setMsg(''); }
    catch { setFile(null); setPreview(''); setMsg('Fotoğraf okunamadı. Başka bir fotoğraf deneyin.'); }
  };
  const save = async e => {
    e.preventDefault(); setMsg('');
    if (!giver || !receiver) { setMsg('Devreden ve alan kişiyi seçin.'); return; }
    if (giver === receiver) { setMsg('Devreden ve alan kişi aynı olamaz.'); return; }
    if (!file && !existing) { setMsg('Kasa raporu fotoğrafını ekleyin.'); return; }
    setBusy(true);
    let path = existing?.report_path;
    if (file) {
      path = `${t.id}/${Date.now()}.jpg`;
      const up = await supabase.storage.from('kasa-raporlari').upload(path, file, { contentType: 'image/jpeg' });
      if (up.error) { setBusy(false); setMsg('Fotoğraf yüklenemedi: ' + up.error.message); return; }
    }
    const row = { task_id: t.id, giver, receiver, report_path: path };
    const r = existing ? await supabase.from('cash_handovers').update(row).eq('task_id', t.id) : await supabase.from('cash_handovers').insert(row);
    if (r.error) {
      setBusy(false);
      setMsg(r.error.code === '42501' ? 'Devreden veya alan kişi siz olmalısınız (ya da yönetici).' : 'Kaydedilemedi: ' + r.error.message);
      return;
    }
    const u = await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', t.id);
    setBusy(false);
    if (u.error) { setMsg('Kayıt alındı ama görev tamamlanamadı: ' + u.error.message); return; }
    onDone();
  };
  return (
    <form className="card" onSubmit={save}>
      <h2 style={{ marginTop: 0 }}>Kasa devri</h2>
      <p className="meta">{t.title}</p>
      <div className="grid">
        <div><label>Kasayı devreden</label>
          <select value={giver} onChange={e => setGiver(e.target.value)} required>
            <option value="">Seçin…</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}
          </select></div>
        <div><label>Kasayı alan</label>
          <select value={receiver} onChange={e => setReceiver(e.target.value)} required>
            <option value="">Seçin…</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}
          </select></div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label>Kasa raporu (fotoğraf){existing ? ' — boş bırakırsanız mevcut rapor kalır' : ''}</label>
        <input type="file" accept="image/*" onChange={pick} />
        {preview && <img src={preview} alt="Kasa raporu önizleme" style={{ display: 'block', maxWidth: '100%', maxHeight: 260, marginTop: 8, borderRadius: 6, border: '1px solid var(--line)' }} />}
      </div>
      {msg && <div className="err">{msg}</div>}
      <div className="inline" style={{ marginTop: 14 }}>
        <button className="btn" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Devri tamamla'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Vazgeç</button>
      </div>
    </form>
  );
}
