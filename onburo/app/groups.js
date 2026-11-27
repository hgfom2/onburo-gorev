'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { todayStr, fmtD } from '../lib/util';

const WHEN = { arrival: 'İlk giriş günü', daily: 'Her gün (girişten çıkışın bir gün öncesine)', departure: 'Son çıkış günü' };
const SHIFT_LBL = { A: 'A Vardiyası', B: 'B Vardiyası', C: 'C Vardiyası (gece)' };

const statusOf = (g, today) => {
  if (g.status === 'cancelled') return ['İptal', 3];
  if (g.departure < today) return ['Tamamlandı', 2];
  if (g.arrival > today) return ['Yaklaşıyor', 0];
  return ['Konaklıyor', 0];
};

/* Gruplar sekmesi. Tasks: bir grubun görevlerini gösteren bileşen (page.js'te tanımlı; döngüsel içe aktarımı önler) */
export function GroupsScreen({ c, Tasks }) {
  const today = todayStr();
  const [groups, setGroups] = useState([]); const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(null); const [openId, setOpenId] = useState(null);
  const [showOld, setShowOld] = useState(false); const [rulesOpen, setRulesOpen] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let live = true;
    supabase.from('beo_groups').select('*').order('arrival', { ascending: false }).limit(500)
      .then(({ data, error }) => { if (!live) return; if (error) setMsg('Gruplar yüklenemedi: ' + error.message); else setGroups(data || []); setLoaded(true); });
    return () => { live = false; };
  }, [c.ver]);

  const regen = async id => {
    const { data, error } = await supabase.rpc('generate_group_tasks', { gid: id });
    if (error) { setMsg('Görevler üretilemedi: ' + error.message); return null; }
    c.bump(); return data;
  };
  const setStatus = async (g, status) => {
    if (status === 'cancelled' && !confirm(`"${g.name}" iptal edilsin mi? Açık grup görevleri iptal edilir.`)) return;
    const { error } = await supabase.from('beo_groups').update({ status }).eq('id', g.id);
    if (error) { setMsg(error.message); return; }
    await regen(g.id);
  };

  const visible = groups.filter(g => showOld || statusOf(g, today)[1] < 2)
    .sort((a, b) => (a.arrival < b.arrival ? -1 : 1) * (showOld ? -1 : 1));

  return (<>
    <h2>Gruplar (BEO)</h2>
    <div className="bar">
      {c.isMgr && <button className="btn" onClick={() => setForm({})}>+ Grup ekle</button>}
      {c.isMgr && <button className="btn ghost" onClick={() => setRulesOpen(!rulesOpen)}>Grup görev kuralları</button>}
      <label className="inline" style={{ margin: 0 }}><input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} /> Geçmiş ve iptal edilenleri göster</label>
    </div>
    {msg && <div className="err">{msg}</div>}
    {form && c.isMgr && <GroupForm initial={form} onDone={async id => { setForm(null); if (id) await regen(id); else c.bump(); }} onCancel={() => setForm(null)} />}
    {rulesOpen && c.isMgr && <RulesEditor c={c} groups={groups} regen={regen} />}
    {loaded && !visible.length && <p className="empty">Gösterilecek grup yok.</p>}
    {visible.map(g => {
      const [st] = statusOf(g, today); const open = openId === g.id;
      return (
        <div className="card" key={g.id}>
          <div className="inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div>
              <b>{g.name}</b> {g.beo_no && <span className="meta">BEO {g.beo_no}</span>} <span className="kindtag">{st}</span>
              <div className="meta">{fmtD(g.arrival)} giriş → {fmtD(g.departure)} çıkış</div>
            </div>
            <div className="acts">
              <button className="btn ghost sm" onClick={() => setOpenId(open ? null : g.id)}>{open ? 'Görevleri gizle' : 'Görevler'}</button>
              {c.isMgr && g.status === 'active' && <>
                <button className="btn ghost sm" onClick={() => setForm(g)}>Düzenle</button>
                <button className="btn ghost sm" onClick={() => regen(g.id)}>Görevleri yenile</button>
                <button className="btn danger sm" onClick={() => setStatus(g, 'cancelled')}>İptal et</button>
              </>}
              {c.isMgr && g.status === 'cancelled' && <button className="btn ghost sm" onClick={() => setStatus(g, 'active')}>Yeniden aç</button>}
            </div>
          </div>
          <WristNote g={g} onSaved={() => c.bump()} setMsg={setMsg} />
          {open && <div style={{ marginTop: 10 }}><Tasks g={g} base={c} /></div>}
        </div>
      );
    })}
  </>);
}

/* Bileklik rengi ve not: resepsiyonistler de güncelleyebilir */
function WristNote({ g, onSaved, setMsg }) {
  const [w, setW] = useState(g.wristband || ''); const [n, setN] = useState(g.note || '');
  useEffect(() => { setW(g.wristband || ''); setN(g.note || ''); }, [g.wristband, g.note]);
  const dirty = w !== (g.wristband || '') || n !== (g.note || '');
  const save = async () => {
    const { error } = await supabase.from('beo_groups').update({ wristband: w.trim() || null, note: n.trim() || null }).eq('id', g.id);
    if (error) setMsg(error.message); else { setMsg(''); onSaved(); }
  };
  return (
    <div className="inline" style={{ marginTop: 8, flexWrap: 'wrap' }}>
      <input placeholder="Bileklik rengi" value={w} onChange={e => setW(e.target.value)} style={{ width: 150 }} aria-label="Bileklik rengi" />
      <input placeholder="Not" value={n} onChange={e => setN(e.target.value)} style={{ flex: 1, minWidth: 160 }} aria-label="Not" />
      {dirty && <button className="btn sm" onClick={save}>Kaydet</button>}
    </div>
  );
}

function GroupForm({ initial, onDone, onCancel }) {
  const edit = !!initial.id;
  const [f, setF] = useState({ name: initial.name || '', beo_no: initial.beo_no || '', arrival: initial.arrival || '', departure: initial.departure || '', wristband: initial.wristband || '', note: initial.note || '' });
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const save = async e => {
    e.preventDefault(); setMsg('');
    if (!f.name.trim()) { setMsg('Grup adı gerekli.'); return; }
    if (!f.arrival || !f.departure) { setMsg('Giriş ve çıkış tarihini girin.'); return; }
    if (f.departure < f.arrival) { setMsg('Çıkış tarihi girişten önce olamaz.'); return; }
    setBusy(true);
    const row = { name: f.name.trim(), beo_no: f.beo_no.trim() || null, arrival: f.arrival, departure: f.departure, wristband: f.wristband.trim() || null, note: f.note.trim() || null };
    const r = edit ? await supabase.from('beo_groups').update(row).eq('id', initial.id).select('id').single()
                   : await supabase.from('beo_groups').insert(row).select('id').single();
    setBusy(false);
    if (r.error) { setMsg('Kaydedilemedi: ' + r.error.message); return; }
    onDone(r.data.id);
  };
  return (
    <form className="card" onSubmit={save}>
      <h3 style={{ marginTop: 0 }}>{edit ? 'Grubu düzenle' : 'Yeni grup'}</h3>
      <div className="grid">
        <div><label>Grup adı</label><input value={f.name} onChange={set('name')} required /></div>
        <div><label>BEO no</label><input value={f.beo_no} onChange={set('beo_no')} /></div>
        <div><label>İlk misafir giriş günü</label><input type="date" value={f.arrival} onChange={set('arrival')} required /></div>
        <div><label>Son misafir çıkış günü</label><input type="date" value={f.departure} onChange={set('departure')} required /></div>
        <div><label>Bileklik rengi</label><input value={f.wristband} onChange={set('wristband')} /></div>
        <div><label>Not</label><input value={f.note} onChange={set('note')} /></div>
      </div>
      {edit && <p className="meta">Tarihler değişirse gerekmeyen açık görevler silinir, yenileri eklenir. Tamamlanan görevler korunur.</p>}
      {msg && <div className="err">{msg}</div>}
      <div className="inline" style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kaydet ve görevleri üret'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Vazgeç</button>
      </div>
    </form>
  );
}

/* Hangi görev, ne zaman, hangi vardiya, kime — yönetici düzenler */
function RulesEditor({ c, groups, regen }) {
  const [rules, setRules] = useState([]); const [msg, setMsg] = useState('');
  const load = () => supabase.from('group_rules').select('*').order('sort').then(({ data }) => setRules(data || []));
  useEffect(() => { load(); }, []);
  const upd = (id, f) => setRules(rs => rs.map(r => (r.id === id ? { ...r, ...f } : r)));
  const save = async r => {
    if (!r.title.trim()) { setMsg('Başlık gerekli.'); return; }
    const { error } = await supabase.from('group_rules').update({ title: r.title.trim(), when_type: r.when_type, offset_days: Number(r.offset_days) || 0, shift: r.shift, assignee: r.assignee || null, active: r.active, sort: r.sort }).eq('id', r.id);
    setMsg(error ? error.message : 'Kaydedildi. Mevcut gruplara uygulamak için "Tüm aktif gruplara uygula"ya basın.');
  };
  const del = async r => {
    if (!confirm('Kural silinsin mi? Üretilmiş görevler kalır.')) return;
    const { error } = await supabase.from('group_rules').delete().eq('id', r.id);
    if (error) setMsg(error.message); else load();
  };
  const add = async () => {
    const { error } = await supabase.from('group_rules').insert({ title: 'Yeni görev', when_type: 'arrival', sort: (rules.at(-1)?.sort || 0) + 1 });
    if (error) setMsg(error.message); else load();
  };
  const applyAll = async () => {
    for (const g of groups.filter(x => x.status === 'active' && x.departure >= todayStr())) { if ((await regen(g.id)) === null) return; }
    setMsg('Aktif gruplara uygulandı.');
  };
  const staff = c.people.filter(p => p.active);
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Grup görev kuralları</h3>
      <p className="meta">Her yeni grup için bu kurallardan görevler üretilir. Görev adı "Grup adı: kural başlığı" olur.</p>
      {rules.map(r => (
        <div key={r.id} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
          <div className="inline" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
            <input style={{ flex: 1, minWidth: 200 }} value={r.title} onChange={e => upd(r.id, { title: e.target.value })} aria-label="Görev başlığı" />
            <label className="inline" style={{ margin: 0 }}><input type="checkbox" checked={r.active} onChange={e => upd(r.id, { active: e.target.checked })} /> Aktif</label>
          </div>
          <div className="inline" style={{ flexWrap: 'wrap' }}>
            <select value={r.when_type} onChange={e => upd(r.id, { when_type: e.target.value })} aria-label="Ne zaman">{Object.entries(WHEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {r.when_type !== 'daily' && <label className="inline" style={{ margin: 0 }}>Gün farkı <input type="number" value={r.offset_days} onChange={e => upd(r.id, { offset_days: e.target.value })} /></label>}
            <select value={r.shift} onChange={e => upd(r.id, { shift: e.target.value })} aria-label="Vardiya">{Object.entries(SHIFT_LBL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={r.assignee || ''} onChange={e => upd(r.id, { assignee: e.target.value })} aria-label="Sorumlu">
              <option value="">Atanmamış</option>{staff.map(p => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}
            </select>
            <button className="btn sm" onClick={() => save(r)}>Kaydet</button>
            <button className="btn danger sm" onClick={() => del(r)}>Sil</button>
          </div>
        </div>
      ))}
      <div className="inline">
        <button className="btn ghost sm" onClick={add}>+ Kural ekle</button>
        <button className="btn ghost sm" onClick={applyAll}>Tüm aktif gruplara uygula</button>
      </div>
      {msg && <div className="meta" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
