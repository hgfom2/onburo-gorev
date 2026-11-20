'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const TZ = 'Europe/Istanbul';
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monday = s => { const d = new Date(s + 'T00:00:00Z'); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
const fmt = s => new Date(s + 'T00:00:00Z').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const SHIFTS = { A: 'A Vardiyası (08:00-16:00)', B: 'B Vardiyası (16:00-00:00)', C: 'C Vardiyası (00:00-08:00)' };
const ROLES = { admin: 'Yönetici', supervisor: 'Süpervizör', receptionist: 'Resepsiyonist' };
const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function Login() {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState('');
  const go = async e => {
    e.preventDefault(); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) setErr('E-posta veya şifre hatalı.');
  };
  return (
    <form className="login" onSubmit={go}>
      <h2>Önbüro Görevler</h2>
      <label>E-posta</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
      <label>Şifre</label><input type="password" value={pw} onChange={e => setPw(e.target.value)} required />
      {err && <div className="err">{err}</div>}
      <button className="btn" style={{ width: '100%' }}>Giriş yap</button>
    </form>
  );
}

function Task({ t, names, cats, onToggle, who }) {
  const late = t.status === 'open' && t.due_date < todayStr();
  return (
    <div className={`task ${t.status === 'done' ? 'done' : ''} ${late ? 'late' : ''}`}>
      <input type="checkbox" checked={t.status === 'done'} onChange={() => onToggle(t)} aria-label="Tamamlandı" />
      <div>
        <div className="t">{t.title}</div>
        {t.description && <div className="meta">{t.description}</div>}
        <div className="meta">
          {SHIFTS[t.shift].split(' (')[0]} · {cats[t.category_id] || 'Kategorisiz'}
          {who && ` · ${names[t.assignee] || 'Atanmamış'}`} · Son tarih: {fmt(t.due_date)}
          {late && <span className="late-tag"> · Gecikti</span>}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState('mine');
  const [people, setPeople] = useState([]);
  const [catList, setCatList] = useState([]);
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMe(null); return; }
    (async () => {
      const [p, c] = await Promise.all([supabase.from('profiles').select('*').order('full_name'), supabase.from('categories').select('*').order('id')]);
      setPeople(p.data || []); setCatList(c.data || []);
      setMe((p.data || []).find(x => x.id === session.user.id) || null);
    })();
  }, [session]);

  const names = Object.fromEntries(people.map(p => [p.id, p.full_name || p.email]));
  const cats = Object.fromEntries(catList.map(c => [c.id, c.name]));
  const isMgr = me && (me.role === 'admin' || me.role === 'supervisor');

  const toggle = async t => {
    const done = t.status !== 'done';
    await supabase.from('tasks').update({ status: done ? 'done' : 'open', completed_at: done ? new Date().toISOString() : null }).eq('id', t.id);
    setTasks(ts => ts.map(x => x.id === t.id ? { ...x, status: done ? 'done' : 'open' } : x));
  };

  if (session === undefined) return null;
  if (!session) return <Login />;
  if (!me || !me.active) return <main><p className="empty">Hesabınız henüz etkinleştirilmemiş. Lütfen yöneticiyle iletişime geçin.</p><button className="btn ghost" onClick={() => supabase.auth.signOut()}>Çıkış</button></main>;

  const tabs = [['mine', 'Görevlerim'], ...(isMgr ? [['shift', 'Vardiya / Gün'], ['report', 'Personel raporu'], ['manage', 'Görev ekle']] : [])];
  const common = { me, names, cats, catList, people, tasks, setTasks, toggle };
  return (
    <>
      <header>
        <b>Grand Sapphire · Önbüro Görevler</b>
        <span>{me.full_name || me.email} ({ROLES[me.role]}) · <a href="#" style={{ color: '#fff' }} onClick={e => { e.preventDefault(); supabase.auth.signOut(); }}>Çıkış</a></span>
      </header>
      <nav role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <main>
        {tab === 'mine' && <Mine {...common} />}
        {tab === 'shift' && isMgr && <ShiftView {...common} />}
        {tab === 'report' && isMgr && <Report {...common} />}
        {tab === 'manage' && isMgr && <Manage {...common} />}
      </main>
    </>
  );
}

function Mine({ me, names, cats, tasks, setTasks, toggle }) {
  const today = todayStr();
  const load = useCallback(async () => {
    const { data } = await supabase.from('tasks').select('*').eq('assignee', me.id)
      .or(`status.eq.open,due_date.gte.${addDays(today, -1)}`).lte('due_date', addDays(today, 7)).order('due_date');
    setTasks(data || []);
  }, [me.id, today, setTasks]);
  useEffect(() => { load(); }, [load]);
  const open = tasks.filter(t => t.status === 'open' && t.due_date <= today);
  const soon = tasks.filter(t => t.status === 'open' && t.due_date > today);
  const done = tasks.filter(t => t.status === 'done');
  const L = ({ list, title }) => list.length > 0 && <><h3>{title} ({list.length})</h3>{list.map(t => <Task key={t.id} t={t} names={names} cats={cats} onToggle={toggle} />)}</>;
  return (<>
    <h2>Görevlerim</h2>
    {!tasks.length && <div className="empty">Size atanmış açık görev yok.</div>}
    <L list={open} title="Bugün ve geciken" /><L list={soon} title="Yaklaşan (7 gün)" /><L list={done} title="Tamamlanan" />
  </>);
}

function ShiftView({ names, cats, tasks, setTasks, toggle }) {
  const [date, setDate] = useState(todayStr()); const [shift, setShift] = useState('');
  useEffect(() => { (async () => {
    let q = supabase.from('tasks').select('*').eq('due_date', date).order('shift');
    if (shift) q = q.eq('shift', shift);
    const { data } = await q; setTasks(data || []);
  })(); }, [date, shift, setTasks]);
  return (<>
    <h2>Vardiya / Günlük görevler</h2>
    <div className="bar">
      <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      <select value={shift} onChange={e => setShift(e.target.value)}>
        <option value="">Tüm vardiyalar</option>{Object.entries(SHIFTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <span className="meta">{tasks.filter(t => t.status === 'done').length} / {tasks.length} tamamlandı</span>
    </div>
    {!tasks.length && <div className="empty">Bu gün için görev yok.</div>}
    {Object.keys(SHIFTS).map(s => { const l = tasks.filter(t => t.shift === s); return l.length > 0 && <div key={s}><h3>{SHIFTS[s]}</h3>{l.map(t => <Task key={t.id} t={t} names={names} cats={cats} onToggle={toggle} who />)}</div>; })}
  </>);
}

function Report({ people }) {
  const today = todayStr(); const thisMon = monday(today); const lastMon = addDays(thisMon, -7);
  const [rows, setRows] = useState([]);
  useEffect(() => { (async () => {
    const { data } = await supabase.from('tasks').select('assignee,status,due_date').gte('due_date', lastMon).lte('due_date', addDays(thisMon, 6));
    setRows(data || []);
  })(); }, [lastMon, thisMon]);
  const stat = (id, from) => { const l = rows.filter(t => t.assignee === id && t.due_date >= from && t.due_date <= addDays(from, 6));
    return { n: l.length, done: l.filter(t => t.status === 'done').length, late: l.filter(t => t.status === 'open' && t.due_date < today).length }; };
  const Tbl = ({ from, title }) => (<>
    <h3>{title} ({fmt(from)} – {fmt(addDays(from, 6))})</h3>
    <table><thead><tr><th>Personel</th><th className="n">Toplam</th><th className="n">Tamamlanan</th><th className="n">Açık</th><th className="n">Geciken</th></tr></thead>
      <tbody>{people.filter(p => p.active).map(p => { const s = stat(p.id, from); return (
        <tr key={p.id}><td>{p.full_name || p.email}</td><td className="n">{s.n}</td><td className="n">{s.done}</td><td className="n">{s.n - s.done}</td><td className="n">{s.late}</td></tr>); })}</tbody></table></>);
  return (<><h2>Personel bazlı rapor</h2><Tbl from={thisMon} title="Bu hafta" /><Tbl from={lastMon} title="Geçen hafta" /></>);
}

function Manage({ me, people, catList }) {
  const blank = { title: '', description: '', category_id: catList[0]?.id || '', shift: 'A', assignee: '', due_date: todayStr(), repeat: 'none', weekdays: [1, 2, 3, 4, 5, 6, 7] };
  const [f, setF] = useState(blank); const [msg, setMsg] = useState(''); const [tpls, setTpls] = useState([]);
  const loadT = useCallback(async () => { const { data } = await supabase.from('templates').select('*').eq('active', true).order('title'); setTpls(data || []); }, []);
  useEffect(() => { loadT(); }, [loadT]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = async e => {
    e.preventDefault(); setMsg('');
    const base = { title: f.title, description: f.description || null, category_id: f.category_id || null, shift: f.shift, assignee: f.assignee || null };
    let error;
    if (f.repeat === 'none') ({ error } = await supabase.from('tasks').insert({ ...base, due_date: f.due_date }));
    else {
      const wd = f.repeat === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : f.weekdays;
      const { data, error: e1 } = await supabase.from('templates').insert({ ...base, recurrence: f.repeat, weekdays: wd }).select().single();
      error = e1;
      const today = todayStr(); const w = new Date(today + 'T00:00:00Z').getUTCDay() || 7;
      if (!e1 && wd.includes(w)) await supabase.from('tasks').insert({ ...base, due_date: today, template_id: data.id });
    }
    if (error) setMsg('Kaydedilemedi: ' + error.message); else { setMsg('Görev kaydedildi.'); setF({ ...blank, shift: f.shift }); loadT(); }
  };
  const stop = async id => { await supabase.from('templates').update({ active: false }).eq('id', id); loadT(); };
  return (<>
    <h2>Görev ekle</h2>
    <form className="card" onSubmit={save}>
      <div style={{ marginBottom: 12 }}><label>Görev başlığı</label><input style={{ width: '100%' }} value={f.title} onChange={e => set('title', e.target.value)} required /></div>
      <div style={{ marginBottom: 12 }}><label>Açıklama</label><textarea value={f.description} onChange={e => set('description', e.target.value)} /></div>
      <div className="grid">
        <div><label>Kategori</label><select value={f.category_id} onChange={e => set('category_id', e.target.value)}>{catList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label>Vardiya</label><select value={f.shift} onChange={e => set('shift', e.target.value)}>{Object.entries(SHIFTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label>Sorumlu</label><select value={f.assignee} onChange={e => set('assignee', e.target.value)}><option value="">Atanmamış</option>{people.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></div>
        <div><label>Tekrar</label><select value={f.repeat} onChange={e => set('repeat', e.target.value)}><option value="none">Tek seferlik</option><option value="daily">Her gün</option><option value="weekly">Haftanın belirli günleri</option></select></div>
        {f.repeat === 'none' && <div><label>Son tarih</label><input type="date" value={f.due_date} onChange={e => set('due_date', e.target.value)} required /></div>}
      </div>
      {f.repeat === 'weekly' && <div className="days" style={{ marginTop: 12 }}>{DAYS.map((d, i) => <label key={d}><input type="checkbox" checked={f.weekdays.includes(i + 1)} onChange={e => set('weekdays', e.target.checked ? [...f.weekdays, i + 1] : f.weekdays.filter(x => x !== i + 1))} />{d}</label>)}</div>}
      {msg && <div className={msg.startsWith('Kaydedilemedi') ? 'err' : 'meta'} style={{ marginTop: 10 }}>{msg}</div>}
      <div style={{ marginTop: 14 }}><button className="btn">Görevi kaydet</button></div>
    </form>
    <h3>Aktif tekrarlayan görevler ({tpls.length})</h3>
    {!tpls.length && <div className="empty">Tekrarlayan görev yok.</div>}
    {tpls.map(t => <div className="task" key={t.id}><div style={{ flex: 1 }}><div className="t">{t.title}</div>
      <div className="meta">{t.shift} Vardiyası · {t.recurrence === 'daily' ? 'Her gün' : t.weekdays.map(d => DAYS[d - 1]).join(', ')} · {people.find(p => p.id === t.assignee)?.full_name || 'Atanmamış'}</div></div>
      <button className="btn ghost" onClick={() => stop(t.id)}>Durdur</button></div>)}
  </>);
}
