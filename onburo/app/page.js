'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { todayStr, opDayStr, addDays, monday, SHIFT_END, NIGHT_END, dateOf, shiftDateOf, timeOf, fmtD, fmtDT, toLocalInput, occursOn, dueFor, zonedIso } from '../lib/util';
import { GroupsScreen } from './groups';
import { HandoverScreen, HandoverBanner, nowShift } from './handover';
import { AuditScreen } from './audit';
import { TASK_SELECT, itemsOf, ItemsList, ItemsEditor, CashInfo, CashForm } from './checklist';

const SHIFTS = { A: 'A Vardiyası (08:00-16:00)', B: 'B Vardiyası (16:00-00:00)', C: 'C Vardiyası (gece: ertesi gün 00:01-08:00)' };
const SHIFT_NAME = k => SHIFTS[k].split(' (')[0];
const ROLES = { admin: 'Yönetici', supervisor: 'Süpervizör', receptionist: 'Resepsiyonist' };
const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const REPEATS = { none: 'Tek seferlik', daily: 'Her gün', weekly: 'Haftanın belirli günleri', monthly_first: 'Her ayın ilk günü', monthly_last: 'Her ayın son günü' };
const CAT_COLORS = { 'Operasyon': '#1f5bc4', 'İdari': '#c62828', 'Misafir&Takip': '#e0a800', 'Checklist': '#2e7d32', 'Yönetim': '#6a1b9a', 'Grup': '#00838f' };
const KINDS = { normal: 'Normal görev', cash_handover: 'Kasa devri' };
const isChecklist = (c, t) => c.catList.find(k => k.id === t.category_id)?.name === 'Checklist';
const catColor = (catList, id) => CAT_COLORS[catList.find(c => c.id === id)?.name] || '#6b7280';
const repeatText = t => t.recurrence === 'weekly' ? (t.weekdays || []).map(d => DAYS[d - 1]).join(', ') : REPEATS[t.recurrence];
const byDue = (a, b) => (a.status !== 'open') - (b.status !== 'open') || new Date(a.due_at || 0) - new Date(b.due_at || 0);

/* Supabase tek istekte en fazla 1000 satır döndürür; sayfa sayfa hepsini al */
const PAGE = 1000;
async function fetchAll(make) {
  let all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().order('id').range(from, from + PAGE - 1);
    if (error || !data) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
  }
  return all;
}

/* Her ekran kendi görev listesini ve not sayılarını tutar (ortak state yok, eski cevaplar yok sayılır) */
function useTaskScreen(base, load, deps) {
  const [tasks, setTasks] = useState([]);
  const [noteCounts, setNoteCounts] = useState({});
  useEffect(() => {
    let live = true;
    load().then(d => { if (live) setTasks(d); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.ver, ...deps]);
  const ids = tasks.map(t => t.id).join(',');
  useEffect(() => {
    if (!ids) { setNoteCounts({}); return; }
    let live = true;
    const list = ids.split(','); const chunks = [];
    for (let i = 0; i < list.length; i += 100) chunks.push(list.slice(i, i + 100));
    Promise.all(chunks.map(ch => supabase.from('task_notes').select('task_id').in('task_id', ch))).then(rs => {
      if (!live) return;
      const m = {}; rs.forEach(r => (r.data || []).forEach(x => { m[x.task_id] = (m[x.task_id] || 0) + 1; })); setNoteCounts(m);
    });
    return () => { live = false; };
  }, [ids, base.ver]);
  const patch = (id, f) => setTasks(ts => ts.map(x => x.id === id ? { ...x, ...f } : x));
  return [tasks, { ...base, noteCounts, patch }];
}

/* ---------- Giriş ---------- */
function Login() {
  const [mode, setMode] = useState('pin');
  const [u, setU] = useState(''); const [pin, setPin] = useState('');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async e => {
    e.preventDefault(); setErr(''); setBusy(true);
    if (mode === 'pin') {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, pin }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error || 'Giriş başarısız.');
      else await supabase.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) setErr('E-posta veya şifre hatalı.');
    }
    setBusy(false);
  };
  return (
    <form className="login" onSubmit={go}>
      <h2>Önbüro Görevler</h2>
      {mode === 'pin' ? (<>
        <label>Kullanıcı adı</label><input value={u} onChange={e => setU(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        <label>PIN</label><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} autoComplete="current-password" required />
      </>) : (<>
        <label>E-posta</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <label>Şifre</label><input type="password" value={pw} onChange={e => setPw(e.target.value)} required />
      </>)}
      {err && <div className="err">{err}</div>}
      <button className="btn" style={{ width: '100%' }} disabled={busy}>Giriş yap</button>
      <p className="meta" style={{ textAlign: 'center', marginBottom: 0 }}>
        <a href="#" onClick={e => { e.preventDefault(); setErr(''); setMode(mode === 'pin' ? 'mail' : 'pin'); }}>{mode === 'pin' ? 'E-posta ile giriş (ilk yönetici)' : 'Kullanıcı adı ve PIN ile giriş'}</a>
      </p>
    </form>
  );
}

/* ---------- Görev kartı ve gruplar ---------- */
function Task({ t, c, who }) {
  const cancelled = t.status === 'cancelled';
  const late = t.status === 'open' && t.due_at && new Date(t.due_at) < new Date();
  const mine = t.assignee === c.me.id; const n = c.noteCounts[t.id] || 0;
  const cash = t.kind === 'cash_handover'; const hasItems = itemsOf(t).length > 0;
  const fresh = !t.template_id && !t.group_id && t.status === 'open';
  const pending = hasItems && t.status !== 'done' && itemsOf(t).some(i => !i.done); // alt maddeler bitmeden ana görev tamamlanamaz
  const onCheck = () => (cash && t.status !== 'done' ? c.edit({ kind: 'cash', data: t }) : c.toggle(t, c.patch));
  return (
    <div className={`task ${t.status === 'done' ? 'done' : ''} ${cancelled ? 'cancelled' : ''} ${late ? 'late' : ''} ${fresh ? 'fresh' : ''}`} style={{ borderLeftColor: catColor(c.catList, t.category_id) }}>
      <input type="checkbox" checked={t.status === 'done'} disabled={cancelled || pending} title={pending ? 'Önce tüm alt maddeleri tamamlayın' : undefined} onChange={onCheck} aria-label="Tamamlandı" />
      <div style={{ flex: 1 }}>
        <div className="t">{t.title}{cash && <span className="kindtag">Kasa devri</span>}</div>
        {t.description && <div className="meta">{t.description}</div>}
        <div className="meta">
          {SHIFT_NAME(t.shift)}{who && (t.assignee || !hasItems) && ` · ${c.names[t.assignee] || 'Atanmamış'}`} · Son: {t.due_at ? fmtDT(t.due_at) : fmtD(t.due_date)}
          {late && <span className="late-tag"> · Gecikti</span>}
          {cancelled && <span className="late-tag"> · İptal edildi</span>}
        </div>
        {cancelled && <div className="meta">İptal sebebi: {t.cancel_reason}{t.cancelled_by ? ` (${c.names[t.cancelled_by] || ''})` : ''}</div>}
        <ItemsList t={t} c={c} />
        {cash && <CashInfo t={t} c={c} />}
      </div>
      <div className="acts">
        {c.isMgr && !cancelled && (
          <select className="assign" value="" onChange={e => c.assign(t, e.target.value, c.patch)} aria-label="Ata">
            <option value="">{t.assignee ? 'Yeniden ata…' : 'Ata…'}</option>
            {c.people.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}
          </select>
        )}
        {c.isMgr && <button className="btn ghost sm" onClick={() => c.edit({ kind: 'task', data: t })}>Düzenle</button>}
        <button className="btn ghost sm" onClick={() => c.edit({ kind: 'notes', data: t })}>Notlar{n ? ` (${n})` : ''}</button>
        {(c.isMgr || mine || t.created_by === c.me.id) && t.status === 'open' && <button className="btn danger sm" onClick={() => c.edit({ kind: 'cancel', data: t })}>İptal</button>}
        {c.isMgr && cancelled && <button className="btn ghost sm" onClick={() => c.reopen(t)}>Yeniden aç</button>}
      </div>
    </div>
  );
}

function ByCategory({ list, c, who }) {
  const known = c.catList.map(k => [k, list.filter(t => t.category_id === k.id)]);
  const none = list.filter(t => !c.catList.some(k => k.id === t.category_id));
  const groups = [...known, [{ id: null, name: 'Kategorisiz' }, none]].filter(([, l]) => l.length);
  return groups.map(([k, l]) => (
    <div key={k.id ?? 'none'} className="grp">
      <div className="grph"><span className="dot" style={{ background: catColor(c.catList, k.id) }} />{k.name} <span className="meta">({l.length})</span></div>
      {[...l].sort(byDue).map(t => <Task key={t.id} t={t} c={c} who={who} />)}
    </div>
  ));
}

/* Bir grubun görevleri (Gruplar sekmesi) */
function GroupTasks({ g, base }) {
  const [tasks, c] = useTaskScreen(base, () => fetchAll(() => supabase.from('tasks').select(TASK_SELECT).eq('group_id', g.id).order('due_at')), [g.id]);
  if (!tasks.length) return <p className="empty">Bu grup için görev yok.</p>;
  return [...tasks].sort(byDue).map(t => <Task key={t.id} t={t} c={c} who />);
}

/* Sıra: şablondan üretilmeyen (yeni) görevler en üstte, Checklist kategorisi en altta */
function Sections({ list, c, who }) {
  const fresh = list.filter(t => !t.template_id && !t.group_id);
  const rest = list.filter(t => t.template_id || t.group_id);
  const other = rest.filter(t => !isChecklist(c, t));
  const chk = rest.filter(t => isChecklist(c, t));
  return (<>
    {fresh.length > 0 && (
      <div className="grp fresh-grp">
        <div className="grph"><span className="newtag">Yeni</span>Yeni görevler <span className="meta">({fresh.length})</span></div>
        {[...fresh].sort(byDue).map(t => <Task key={t.id} t={t} c={c} who={who} />)}
      </div>
    )}
    <ByCategory list={other} c={c} who={who} />
    <ByCategory list={chk} c={c} who={who} />
  </>);
}

function ShiftGroups({ list, c, who }) {
  return Object.keys(SHIFTS).map(s => {
    const l = list.filter(t => t.shift === s);
    return l.length > 0 && <div key={s}><h3>{SHIFTS[s]}</h3><Sections list={l} c={c} who={who} /></div>;
  });
}

/* ---------- Ana uygulama ---------- */
export default function App() {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState('mine');
  const [people, setPeople] = useState([]);
  const [catList, setCatList] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [ver, setVer] = useState(0);
  const [editing, setEditing] = useState(null);
  const [unCount, setUnCount] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadPeople = useCallback(async () => {
    if (!session) return;
    const [p, k] = await Promise.all([supabase.from('profiles').select('id,full_name,username,role,active').order('full_name'), supabase.from('categories').select('*').order('id')]);
    if (p.error) { setLoadErr(p.error.message); return; }
    setPeople(p.data || []); setCatList(k.data || []);
    setMe((p.data || []).find(x => x.id === session.user.id) || null);
  }, [session]);
  useEffect(() => { if (!session) { setMe(null); return; } loadPeople(); }, [session, loadPeople]);

  const isMgr = !!me && me.active && (me.role === 'admin' || me.role === 'supervisor');
  const isAdmin = !!me && me.active && me.role === 'admin';

  useEffect(() => {
    if (!isMgr) return;
    // Alt maddeleri olan checklist görevlerinin ana görevi atamasızdır; onlar "atanmamış" sayılmaz
    supabase.from('tasks').select('id, task_items(id)').is('assignee', null).eq('status', 'open')
      .then(({ data }) => setUnCount((data || []).filter(t => !(t.task_items || []).length).length));
  }, [isMgr, ver]);

  // Canlı yenileme: başkasının değişikliği (görev/not) gelince ekranlar yeniden yüklenir
  useEffect(() => {
    if (!session) return;
    let timer;
    const kick = () => { clearTimeout(timer); timer = setTimeout(() => setVer(v => v + 1), 800); };
    const ch = supabase.channel('live-tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, kick)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_notes' }, kick)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_items' }, kick)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_handovers' }, kick)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'beo_groups' }, kick)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handover_notes' }, kick)
      .subscribe();
    const onVis = () => { if (document.visibilityState === 'visible') kick(); };
    document.addEventListener('visibilitychange', onVis);
    const poll = setInterval(kick, 5 * 60e3); // bağlantı koparsa yedek
    return () => { clearTimeout(timer); clearInterval(poll); document.removeEventListener('visibilitychange', onVis); supabase.removeChannel(ch); };
  }, [session]);

  const bump = () => setVer(v => v + 1);
  const reopen = async t => {
    const { error } = await supabase.from('tasks').update({ status: 'open', cancel_reason: null, cancelled_at: null, cancelled_by: null, completed_at: null }).eq('id', t.id);
    if (!error) bump();
  };
  const toggle = async (t, patch) => {
    const done = t.status !== 'done';
    const f = { status: done ? 'done' : 'open', completed_at: done ? new Date().toISOString() : null };
    const { error } = await supabase.from('tasks').update(f).eq('id', t.id);
    if (!error) patch(t.id, f);
  };
  const assign = async (t, uid, patch) => {
    if (!uid) return;
    const { error } = await supabase.from('tasks').update({ assignee: uid }).eq('id', t.id);
    if (!error) { patch(t.id, { assignee: uid }); bump(); }
  };

  const names = Object.fromEntries(people.map(p => [p.id, p.full_name || p.username || p.email]));
  const c = { me, names, catList, people, isMgr, toggle, assign, ver, bump, reopen, edit: setEditing, reloadPeople: loadPeople };

  if (session === undefined) return null;
  if (!session) return <Login />;
  if (!me || !me.active) return (
    <main><p className="empty">Hesabınız henüz etkinleştirilmemiş. Lütfen yöneticiyle iletişime geçin.</p>
      {loadErr && <p className="err">Hata: {loadErr}</p>}
      <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Çıkış</button></main>
  );

  const tabs = [['mine', 'Görevlerim'], ['shift', 'Vardiya / Gün'], ['groups', 'Gruplar'], ['handover', 'Devir notları'], ...(!isMgr ? [['request', 'Talep / Takip']] : []),
    ...(isMgr ? [['un', `Atanmamış${unCount ? ` (${unCount})` : ''}`], ['report', 'Personel raporu'], ['manage', 'Görev ekle']] : []),
    ...(isAdmin ? [['users', 'Kullanıcılar'], ['audit', 'Denetim']] : [])];
  const go = k => setTab(k);

  return (
    <>
      <header>
        <b>Grand Sapphire · Önbüro Görevler</b>
        <span>{me.full_name || me.username} ({ROLES[me.role]}) · <a href="#" style={{ color: '#fff' }} onClick={e => { e.preventDefault(); supabase.auth.signOut(); }}>Çıkış</a></span>
      </header>
      <nav role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => go(k)}>{l}</button>)}</nav>
      <main>
        {tab === 'mine' && <Mine c={c} />}
        {tab === 'shift' && <ShiftView c={c} />}
        {tab === 'handover' && <HandoverScreen c={c} />}
        {tab === 'request' && !isMgr && <Requests c={c} />}
        {tab === 'groups' && <GroupsScreen c={c} Tasks={GroupTasks} />}
        {tab === 'un' && isMgr && <Unassigned c={c} />}
        {tab === 'report' && isMgr && <Report c={c} />}
        {tab === 'manage' && isMgr && <Manage c={c} />}
        {tab === 'users' && isAdmin && <Users c={c} />}
        {tab === 'audit' && isAdmin && <AuditScreen c={c} />}
      </main>
      {editing && (
        <div className="modal" onClick={() => setEditing(null)}>
          <div className="mbox" onClick={e => e.stopPropagation()}>
            {editing.kind === 'cancel' && <CancelForm t={editing.data} c={c} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); bump(); }} />}
            {editing.kind === 'notes' && <NotesPanel t={editing.data} c={c} onClose={() => setEditing(null)} />}
            {editing.kind === 'cash' && <CashForm t={editing.data} c={c} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); bump(); }} />}
            {editing.kind === 'preset' && (<>
              <h2>{editing.data.id ? 'Şablonu düzenle' : 'Yeni görev şablonu'}</h2>
              <PresetForm key={editing.data.id || 'new'} initial={editing.data} c={c} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); bump(); }} />
            </>)}
            {(editing.kind === 'task' || editing.kind === 'tpl') && (<>
              <h2>{editing.kind === 'tpl' ? 'Tekrarlayan görevi düzenle' : 'Görevi düzenle'}</h2>
              <TaskForm key={editing.data.id} mode={editing.kind === 'tpl' ? 'tpl-edit' : 'task-edit'} initial={editing.data} c={c}
                onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); bump(); }} />
            </>)}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Ekranlar ---------- */
function Mine({ c: base }) {
  const { me } = base; const today = todayStr();
  const [tasks, c] = useTaskScreen(base, async () => {
    const win = q => q.eq('status', 'open').lte('due_date', addDays(today, 7)); // yalnızca açık görevler: tamamlanan ve iptal edilenler listeden çıkar
    const own = await fetchAll(() => win(supabase.from('tasks').select(TASK_SELECT).eq('assignee', me.id)));
    // Ana görev bana atanmamış olsa bile, bana atanmış alt maddesi olan görevler de gelir
    const { data: its } = await supabase.from('task_items').select('task_id, tasks!inner(due_date,status)').eq('assignee', me.id).eq('tasks.status', 'open')
      .gte('tasks.due_date', addDays(today, -60)).lte('tasks.due_date', addDays(today, 7));
    const have = new Set(own.map(t => t.id));
    const extra = [...new Set((its || []).map(r => r.task_id))].filter(id => !have.has(id));
    let more = [];
    for (let i = 0; i < extra.length; i += 100) {
      const ids = extra.slice(i, i + 100);
      more = more.concat(await fetchAll(() => win(supabase.from('tasks').select(TASK_SELECT).in('id', ids))));
    }
    return [...own, ...more];
  }, [me.id, today]);
  const now = new Date(); const open = tasks.filter(t => t.status === 'open' && t.due_at);
  const late = open.filter(t => new Date(t.due_at) < now).length;
  const soon = open.filter(t => new Date(t.due_at) >= now && new Date(t.due_at) < new Date(now.getTime() + 2 * 3600e3)).length;
  return (<>
    <h2>Görevlerim</h2>
    <HandoverBanner c={base} />
    {(late > 0 || soon > 0) && <div className="alert">{late > 0 && <b>{late} görev gecikti</b>}{late > 0 && soon > 0 && ' · '}{soon > 0 && <span>{soon} görev 2 saat içinde bitiyor</span>}</div>}
    {!tasks.length && <div className="empty">Size atanmış görev yok.</div>}
    <Sections list={tasks} c={c} />
  </>);
}

function ShiftView({ c: base }) {
  const today = opDayStr(); // 08:00'e kadar hâlâ dünün gece (C) vardiyası sürer
  const [date, setDate] = useState(today); const [shift, setShift] = useState('');
  const [tasks, c] = useTaskScreen(base, async () => {
    const q1 = fetchAll(() => { let q = supabase.from('tasks').select(TASK_SELECT).eq('due_date', date); if (shift) q = q.eq('shift', shift); return q; });
    const q2 = date === today ? fetchAll(() => { let q = supabase.from('tasks').select(TASK_SELECT).eq('status', 'open').lt('due_date', today); if (shift) q = q.eq('shift', shift); return q; }) : Promise.resolve([]);
    const [a, b] = await Promise.all([q1, q2]); return [...a, ...b];
  }, [date, shift, today]);
  const day = tasks.filter(t => t.due_date === date);
  const late = tasks.filter(t => t.due_date < date && t.status === 'open');
  return (<>
    <h2>Vardiya / Günlük görevler</h2>
    {date === today && todayStr() !== today && <p className="meta">Gece vardiyası sürüyor: {fmtD(today)} tarihli C vardiyası görevleri bu günün altında listelenir.</p>}
    <div className="bar">
      <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      <select value={shift} onChange={e => setShift(e.target.value)}>
        <option value="">Tüm vardiyalar</option>{Object.entries(SHIFTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <span className="meta">{day.filter(t => t.status === 'done').length} / {day.filter(t => t.status !== 'cancelled').length} tamamlandı{day.some(t => t.status === 'cancelled') && ` · ${day.filter(t => t.status === 'cancelled').length} iptal`}</span>
    </div>
    {late.length > 0 && <><h3 style={{ color: 'var(--late)' }}>Geciken açık görevler ({late.length})</h3><ShiftGroups list={late} c={c} who /></>}
    {!day.length && <div className="empty">Bu gün için görev yok.</div>}
    <ShiftGroups list={day} c={c} who />
  </>);
}

/* Resepsiyonist: yönetime talep / misafir takibi görevi girer. Yalnızca "Misafir&Takip" kategorisi; vardiya ve gün otomatik */
function Requests({ c: base }) {
  const cat = base.catList.find(k => k.name === 'Misafir&Takip');
  const managers = base.people.filter(p => p.active && (p.role === 'admin' || p.role === 'supervisor'));
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState(''); const [to, setTo] = useState('');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [tasks, c] = useTaskScreen(base, async () => {
    const since = new Date(Date.now() - 7 * 24 * 3600e3).toISOString();
    return (await fetchAll(() => supabase.from('tasks').select(TASK_SELECT).eq('created_by', base.me.id).eq('category_id', cat?.id ?? -1).gte('created_at', since))).sort(byDue);
  }, [cat?.id]);
  const send = async e => {
    e.preventDefault(); setMsg('');
    if (!title.trim()) { setMsg('Başlık yazın.'); return; }
    if (!cat) { setMsg('Kategori bulunamadı. Sayfayı yenileyin.'); return; }
    setBusy(true);
    const shift = nowShift(); const day = opDayStr(); // başlangıç: şu an; son saat: vardiya sonu
    const { error } = await supabase.from('tasks').insert({ title: title.trim(), description: desc.trim() || null, category_id: cat.id, shift, assignee: to || null, due_date: day, due_at: dueFor({ shift }, day) });
    setBusy(false);
    if (error) { setMsg('Gönderilemedi: ' + error.message); return; }
    setTitle(''); setDesc(''); setTo(''); base.bump();
  };
  return (<>
    <h2>Talep / Takip</h2>
    <form className="card" onSubmit={send}>
      <p className="meta" style={{ marginTop: 0 }}>Yönetimden bir şey istemek veya misafir talebini iletmek için görev girin. Kategori "Misafir&amp;Takip" olarak, tarih ve vardiya şu ana göre otomatik atanır.</p>
      <label htmlFor="rq-t">Başlık</label><input id="rq-t" style={{ width: '100%' }} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required />
      <label htmlFor="rq-d" style={{ marginTop: 12 }}>Açıklama (isteğe bağlı)</label><textarea id="rq-d" value={desc} onChange={e => setDesc(e.target.value)} />
      <label htmlFor="rq-a" style={{ marginTop: 12 }}>Kime (isteğe bağlı)</label>
      <select id="rq-a" value={to} onChange={e => setTo(e.target.value)}>
        <option value="">Atanmamış (yönetim atar)</option>{managers.map(p => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}
      </select>
      {msg && <div className="err">{msg}</div>}
      <div style={{ marginTop: 14 }}><button className="btn" disabled={busy}>{busy ? 'Gönderiliyor…' : 'Görevi gönder'}</button></div>
    </form>
    <h3>Gönderdiğim talepler (son 7 gün)</h3>
    {!tasks.length && <div className="empty">Henüz talep göndermediniz.</div>}
    {tasks.map(t => <Task key={t.id} t={t} c={c} who />)}
  </>);
}

function Unassigned({ c: base }) {
  const [tasks, c] = useTaskScreen(base, async () => (await fetchAll(() => supabase.from('tasks').select(TASK_SELECT).is('assignee', null).eq('status', 'open')))
    .filter(t => !itemsOf(t).length).sort(byDue), []);
  return (<>
    <h2>Atanmamış görevler</h2>
    <p className="meta">Sağdaki "Ata…" listesinden kişiyi seçtiğiniz anda görev o kişiye atanır.</p>
    {!tasks.length && <div className="empty">Atanmamış açık görev yok.</div>}
    <ShiftGroups list={tasks} c={c} who />
  </>);
}

function Report({ c }) {
  const today = todayStr(); const thisMon = monday(today); const lastMon = addDays(thisMon, -7);
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let live = true;
    fetchAll(() => supabase.from('tasks').select('assignee,status,due_date,due_at').gte('due_date', lastMon).lte('due_date', addDays(thisMon, 6))).then(d => { if (live) setRows(d); });
    return () => { live = false; };
  }, [lastMon, thisMon, c.ver]);
  const stat = (id, from) => {
    const l = rows.filter(t => t.assignee === id && t.due_date >= from && t.due_date <= addDays(from, 6));
    return { n: l.length, can: l.filter(t => t.status === 'cancelled').length, done: l.filter(t => t.status === 'done').length, late: l.filter(t => t.status === 'open' && (t.due_at ? new Date(t.due_at) < new Date() : t.due_date < today)).length };
  };
  const Tbl = ({ from, title }) => (<>
    <h3>{title} ({fmtD(from)} – {fmtD(addDays(from, 6))})</h3>
    <table><thead><tr><th>Personel</th><th className="n">Toplam</th><th className="n">Tamamlanan</th><th className="n">Açık</th><th className="n">İptal</th><th className="n">Geciken</th></tr></thead>
      <tbody>{c.people.filter(p => p.active).map(p => { const s = stat(p.id, from); return (
        <tr key={p.id}><td>{p.full_name || p.username}</td><td className="n">{s.n}</td><td className="n">{s.done}</td><td className="n">{s.n - s.done - s.can}</td><td className="n">{s.can}</td><td className="n">{s.late}</td></tr>); })}</tbody></table></>);
  return (<><h2>Personel bazlı rapor</h2><Tbl from={thisMon} title="Bu hafta" /><Tbl from={lastMon} title="Geçen hafta" /></>);
}

function Manage({ c }) {
  const [tpls, setTpls] = useState([]); const [presets, setPresets] = useState([]); const [use, setUse] = useState(null); const [key, setKey] = useState(0);
  const load = useCallback(async () => { const { data } = await supabase.from('templates').select('*').eq('active', true).order('title'); setTpls(data || []); }, []);
  const loadP = useCallback(async () => { const { data } = await supabase.from('task_presets').select('*').order('name'); setPresets(data || []); }, []);
  useEffect(() => { load(); loadP(); }, [load, loadP, c.ver]);
  const stop = async id => { await supabase.from('templates').update({ active: false }).eq('id', id); load(); };
  const delPreset = async p => { if (confirm(`"${p.name}" şablonu silinsin mi?`)) { await supabase.from('task_presets').delete().eq('id', p.id); if (use && use.id === p.id) setUse(null); loadP(); } };
  const initial = use ? { title: use.title, description: use.description, category_id: use.category_id, shift: use.shift || 'A', assignee: use.assignee,
    dmode: use.due_n ? 'rel' : 'exact', rel_n: use.due_n || 2, rel_unit: use.due_unit || 'saat' } : undefined;
  return (<>
    <h2>Görev ekle</h2>
    <div className="bar"><label style={{ margin: 0 }}>Şablondan başla:</label>
      <select value={use ? use.id : ''} onChange={e => setUse(presets.find(p => p.id === e.target.value) || null)}>
        <option value="">Boş görev</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></div>
    <TaskForm key={`${key}-${use ? use.id : 'x'}`} mode="new" initial={initial} c={c} onPreset={loadP} onSaved={() => { setKey(k => k + 1); setUse(null); c.bump(); }} />
    <h3>Görev şablonları ({presets.length}) <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => c.edit({ kind: 'preset', data: {} })}>+ Yeni şablon</button></h3>
    <p className="meta">Sık verdiğiniz görevleri şablon olarak kaydedin. Yukarıdan seçince form dolar; siz sadece sorumlu ve deadline'ı ayarlarsınız.</p>
    {!presets.length && <div className="empty">Henüz şablon yok.</div>}
    {presets.map(p => (
      <div className="task" key={p.id} style={{ borderLeftColor: catColor(c.catList, p.category_id) }}>
        <div style={{ flex: 1 }}><div className="t">{p.name}</div>
          <div className="meta">{p.title}{p.shift ? ` · ${SHIFT_NAME(p.shift)}` : ''}{p.due_n ? ` · Süre: ${p.due_n} ${p.due_unit}` : ''}{p.assignee ? ` · ${c.names[p.assignee] || ''}` : ''}</div></div>
        <div className="acts">
          <button className="btn sm" onClick={() => { setUse(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Kullan</button>
          <button className="btn ghost sm" onClick={() => c.edit({ kind: 'preset', data: p })}>Düzenle</button>
          <button className="btn danger sm" onClick={() => delPreset(p)}>Sil</button>
        </div>
      </div>))}
    <h3>Aktif tekrarlayan görevler ({tpls.length})</h3>
    {!tpls.length && <div className="empty">Tekrarlayan görev yok.</div>}
    {tpls.map(t => (
      <div className="task" key={t.id} style={{ borderLeftColor: catColor(c.catList, t.category_id) }}>
        <div style={{ flex: 1 }}><div className="t">{t.title}{t.kind === 'cash_handover' && <span className="kindtag">Kasa devri</span>}</div>
          <div className="meta">{SHIFT_NAME(t.shift)} · {repeatText(t)} · Son saat: {(t.due_time || SHIFT_END[t.shift]).slice(0, 5)}{t.shift === 'C' ? ' (ertesi gün)' : ''} ·{c.names[t.assignee] || 'Atanmamış'}</div></div>
        <div className="acts">
          <button className="btn ghost sm" onClick={() => c.edit({ kind: 'tpl', data: t })}>Düzenle</button>
          <button className="btn ghost sm" onClick={() => stop(t.id)}>Durdur</button>
        </div>
      </div>))}
  </>);
}

/* ---------- Görev formu (yeni / düzenle / şablon düzenle) ---------- */
function TaskForm({ mode, initial, c, onSaved, onCancel, onPreset }) {
  const isTpl = mode === 'tpl-edit'; const isNew = mode === 'new'; const i = initial || {};
  const [f, setF] = useState({
    title: i.title || '', description: i.description || '', category_id: i.category_id ?? (c.catList[0]?.id || ''),
    shift: i.shift || 'A', assignee: i.assignee || '',
    dmode: i.dmode || 'exact', due_local: i.due_at ? toLocalInput(i.due_at) : `${todayStr()}T18:00`, rel_n: i.rel_n || 2, rel_unit: i.rel_unit || 'saat',
    repeat: isTpl ? i.recurrence : 'none', weekdays: i.weekdays || [1, 2, 3, 4, 5, 6, 7], due_time: (i.due_time || '').slice(0, 5),
    kind: i.kind || 'normal',
    shifts: [i.shift || 'A'], by: {} // yeni tekrarlayan görev: seçili vardiyalar ve her vardiyanın sorumlusu
  });
  const [msg, setMsg] = useState('');
  const [items, setItems] = useState([]); // şablonun alt maddeleri: { label, by: { vardiya: kişiId } }
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const recurring = isTpl || (isNew && f.repeat !== 'none');
  const multi = isNew && recurring; // birden çok vardiya seçilebilir; her vardiya için ayrı şablon oluşur
  const shiftList = multi ? f.shifts : [f.shift];
  const mgrOnly = !!c.catList.find(k => String(k.id) === String(f.category_id))?.mgr_only;
  const isRec = id => c.people.find(p => p.id === id)?.role === 'receptionist';
  useEffect(() => {
    if (!isTpl) return;
    supabase.from('template_items').select('label,assignee,sort').eq('template_id', i.id).order('sort')
      .then(({ data }) => setItems((data || []).map(x => ({ label: x.label, by: { [i.shift]: x.assignee || '' } }))));
  }, [isTpl, i.id, i.shift]);
  const toggleShift = s => setF(x => {
    const on = x.shifts.includes(s);
    return { ...x, shifts: Object.keys(SHIFTS).filter(k => (k === s ? !on : x.shifts.includes(k))) };
  });
  const changeShift = s => { // tekil vardiya seçimi (şablon düzenleme / tek seferlik): kişiler yeni vardiyaya taşınır
    setItems(its => its.map(it => ({ ...it, by: { ...it.by, [s]: it.by?.[f.shift] || '' } })));
    set('shift', s);
  };

  const save = async e => {
    e.preventDefault(); setMsg('');
    const mk = (s, who) => ({ title: f.title.trim(), description: f.description || null, category_id: f.category_id || null, shift: s, assignee: who || null, kind: f.kind });
    const base = mk(f.shift, f.assignee);
    const wd = f.repeat === 'weekly' ? f.weekdays : [1, 2, 3, 4, 5, 6, 7];
    if (f.repeat === 'weekly' && !wd.length) { setMsg('En az bir gün seçin.'); return; }
    if (multi && !f.shifts.length) { setMsg('En az bir vardiya seçin.'); return; }
    const NIGHT_MSG = 'C vardiyası ertesi gün 00:01-08:00 arasındadır; son saat 08:00\'i geçemez.';
    if (recurring && f.due_time && shiftList.includes('C') && f.due_time > NIGHT_END) { setMsg(NIGHT_MSG); return; }
    const cleanFor = s => (recurring && f.kind === 'normal' ? items.filter(x => x.label.trim()).map((x, n) => ({ label: x.label.trim(), assignee: x.by?.[s] || null, sort: n })) : []);
    const whoFor = s => (multi ? f.by[s] : f.assignee) || null;
    if (mgrOnly && shiftList.some(s => isRec(whoFor(s)) || cleanFor(s).some(x => isRec(x.assignee)))) { setMsg('Yönetim kategorisindeki görevler resepsiyonistlere atanamaz.'); return; }
    const syncItems = async (tid, clean) => {
      const d = await supabase.from('template_items').delete().eq('template_id', tid);
      if (d.error || !clean.length) return d.error;
      return (await supabase.from('template_items').insert(clean.map(x => ({ ...x, template_id: tid })))).error;
    };
    let error;
    if (isTpl) {
      ({ error } = await supabase.from('templates').update({ ...base, recurrence: f.repeat, weekdays: wd, due_time: f.due_time || null }).eq('id', i.id));
      if (!error) error = await syncItems(i.id, cleanFor(f.shift));
    } else if (recurring) {
      const done = []; const today = todayStr();
      for (const s of f.shifts) { // her vardiya için ayrı tekrarlayan görev
        const row = mk(s, whoFor(s));
        const { data, error: e1 } = await supabase.from('templates').insert({ ...row, recurrence: f.repeat, weekdays: wd, due_time: f.due_time || null }).select().single();
        error = e1;
        if (!error) error = await syncItems(data.id, cleanFor(s)); // önce maddeler: bugünün görevi eklenince tetikleyici bunları kopyalar
        if (!error && occursOn(data, today)) error = (await supabase.from('tasks').insert({ ...row, due_date: today, due_at: dueFor(data, today), template_id: data.id })).error;
        if (error) {
          if (done.length) { setMsg(`${done.join(', ')} vardiyası eklendi, ${s} eklenemedi: ${error.message}. Aynı vardiyayı tekrar eklememek için "Aktif tekrarlayan görevler" listesini kontrol edin.`); c.bump(); return; }
          break;
        }
        done.push(s);
      }
    } else {
      let due_at;
      if (f.dmode === 'exact') { if (!f.due_local) { setMsg('Tarih ve saat girin.'); return; } due_at = zonedIso(f.due_local.slice(0, 10), f.due_local.slice(11, 16)); }
      else { const n = Number(f.rel_n); if (!(n > 0)) { setMsg('Süre 0\'dan büyük olmalı.'); return; } due_at = new Date(Date.now() + n * (f.rel_unit === 'saat' ? 3600e3 : 86400e3)).toISOString(); }
      if (f.shift === 'C' && timeOf(due_at) > NIGHT_END) { setMsg(NIGHT_MSG); return; }
      const row = { ...base, due_at, due_date: shiftDateOf(f.shift, due_at) };
      ({ error } = isNew ? await supabase.from('tasks').insert(row) : await supabase.from('tasks').update(row).eq('id', i.id));
    }
    if (error) setMsg('Kaydedilemedi: ' + error.message); else onSaved();
  };
  const savePreset = async () => {
    if (!f.title.trim()) { setMsg('Önce görev başlığını yazın.'); return; }
    const name = window.prompt('Şablon adı:', f.title.trim()); if (!name) return;
    const rel = f.dmode === 'rel' && Number(f.rel_n) > 0;
    const { error } = await supabase.from('task_presets').insert({ name: name.trim(), title: f.title.trim(), description: f.description || null,
      category_id: f.category_id || null, shift: f.shift, assignee: f.assignee || null, due_n: rel ? Number(f.rel_n) : null, due_unit: rel ? f.rel_unit : null });
    if (error) setMsg('Şablon kaydedilemedi: ' + error.message); else { setMsg('Şablon kaydedildi.'); if (onPreset) onPreset(); }
  };
  const del = async () => { if (confirm('Bu görev silinsin mi?')) { await supabase.from('tasks').delete().eq('id', i.id); onSaved(); } };

  return (
    <form className="card" onSubmit={save}>
      <div style={{ marginBottom: 12 }}><label>Görev başlığı</label><input style={{ width: '100%' }} value={f.title} onChange={e => set('title', e.target.value)} required /></div>
      <div style={{ marginBottom: 12 }}><label>Açıklama</label><textarea value={f.description} onChange={e => set('description', e.target.value)} /></div>
      <div className="grid">
        <div><label>Kategori</label><select value={f.category_id} onChange={e => set('category_id', e.target.value)}>{c.catList.map(k => <option key={k.id} value={k.id}>{k.name}{k.mgr_only ? ' (yalnızca yönetim)' : ''}</option>)}</select></div>
        {multi
          ? <div><label>Vardiya (birden çok seçebilirsiniz)</label>
              <div className="days">{Object.entries(SHIFTS).map(([k, v]) => <label key={k}><input type="checkbox" checked={f.shifts.includes(k)} onChange={() => toggleShift(k)} />{v}</label>)}</div></div>
          : <div><label>Vardiya</label><select value={f.shift} onChange={e => (isTpl ? changeShift(e.target.value) : set('shift', e.target.value))}>{Object.entries(SHIFTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>}
        {multi
          ? f.shifts.map(s => <div key={s}><label>Sorumlu{f.shifts.length > 1 ? ` — ${SHIFTS[s]}` : ''}</label>
              <select value={f.by[s] || ''} onChange={e => set('by', { ...f.by, [s]: e.target.value })}><option value="">Atanmamış</option>{c.people.filter(p => p.active && !(mgrOnly && p.role === 'receptionist')).map(p => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}</select></div>)
          : <div><label>Sorumlu</label><select value={f.assignee} onChange={e => set('assignee', e.target.value)}><option value="">Atanmamış</option>{c.people.filter(p => p.active && !(mgrOnly && p.role === 'receptionist')).map(p => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}</select></div>}
        {(isNew || isTpl) && <div><label>Tür</label><select value={f.kind} onChange={e => set('kind', e.target.value)}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>}
        {(isNew || isTpl) && <div><label>Tekrar</label><select value={f.repeat} onChange={e => set('repeat', e.target.value)}>{Object.entries(REPEATS).filter(([k]) => !(isTpl && k === 'none')).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>}
      </div>
      {f.repeat === 'weekly' && <div className="days" style={{ marginTop: 12 }}>{DAYS.map((d, n) => <label key={d}><input type="checkbox" checked={f.weekdays.includes(n + 1)} onChange={e => set('weekdays', e.target.checked ? [...f.weekdays, n + 1] : f.weekdays.filter(x => x !== n + 1))} />{d}</label>)}</div>}
      {f.kind === 'cash_handover' && <p className="meta" style={{ marginBottom: 0 }}>Kasa devri: tamamlarken kasayı devreden, kasayı alan ve kasa raporu fotoğrafı zorunludur.</p>}
      {recurring && f.kind === 'normal' && <ItemsEditor items={items} setItems={setItems} people={c.people} mgrOnly={mgrOnly} shifts={shiftList} />}
      <div className="sep" />
      {recurring ? (
        <div><label>Son saat (boş bırakılırsa vardiya sonu{shiftList.length === 1 ? `: ${SHIFT_END[shiftList[0]]}` : 'nda; her vardiya kendi bitişinde'})</label><input type="time" value={f.due_time} onChange={e => set('due_time', e.target.value)} /></div>
      ) : (<>
        <label>Deadline</label>
        <div className="radios">
          <label><input type="radio" checked={f.dmode === 'exact'} onChange={() => set('dmode', 'exact')} />Kesin tarih ve saat</label>
          <label><input type="radio" checked={f.dmode === 'rel'} onChange={() => set('dmode', 'rel')} />Süre (şimdiden itibaren)</label>
        </div>
        {f.dmode === 'exact'
          ? <input type="datetime-local" value={f.due_local} onChange={e => set('due_local', e.target.value)} required />
          : <div className="inline"><input type="number" min="1" value={f.rel_n} onChange={e => set('rel_n', e.target.value)} />
              <select value={f.rel_unit} onChange={e => set('rel_unit', e.target.value)}><option value="saat">saat</option><option value="gün">gün</option></select><span className="meta">sonra</span></div>}
      </>)}
      {msg && <div className={msg.endsWith('kaydedildi.') ? 'meta' : 'err'}>{msg}</div>}
      <div className="inline" style={{ marginTop: 14 }}>
        <button className="btn">Kaydet</button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>İptal</button>}
        {isNew && !recurring && <button type="button" className="btn ghost" onClick={savePreset}>Şablon olarak kaydet</button>}
        {mode === 'task-edit' && <button type="button" className="btn danger" style={{ marginLeft: 'auto' }} onClick={del}>Görevi sil</button>}
      </div>
    </form>
  );
}

/* ---------- İptal ve notlar ---------- */
function CancelForm({ t, c, onCancel, onDone }) {
  const [reason, setReason] = useState(''); const [msg, setMsg] = useState('');
  const save = async e => {
    e.preventDefault();
    if (reason.trim().length < 3) { setMsg('İptal sebebini yazın (en az 3 karakter).'); return; }
    const { error } = await supabase.from('tasks').update({ status: 'cancelled', cancel_reason: reason.trim(), cancelled_at: new Date().toISOString(), cancelled_by: c.me.id }).eq('id', t.id);
    if (error) setMsg('İptal edilemedi: ' + error.message); else onDone();
  };
  return (
    <form className="card" onSubmit={save}>
      <h2 style={{ marginTop: 0 }}>Görevi iptal et</h2>
      <p className="meta">{t.title}</p>
      <label>İptal sebebi (zorunlu)</label>
      <textarea value={reason} onChange={e => setReason(e.target.value)} required autoFocus />
      {msg && <div className="err">{msg}</div>}
      <div className="inline" style={{ marginTop: 14 }}>
        <button className="btn danger">Görevi iptal et</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Vazgeç</button>
      </div>
    </form>
  );
}

function NotesPanel({ t, c, onClose }) {
  const [notes, setNotes] = useState([]); const [body, setBody] = useState(''); const [msg, setMsg] = useState('');
  const canAdd = c.isMgr || t.assignee === c.me.id;
  const load = useCallback(async () => {
    const { data } = await supabase.from('task_notes').select('*').eq('task_id', t.id).order('created_at'); setNotes(data || []);
  }, [t.id]);
  useEffect(() => { load(); }, [load]);
  const add = async e => {
    e.preventDefault(); if (!body.trim()) return;
    const { error } = await supabase.from('task_notes').insert({ task_id: t.id, author: c.me.id, body: body.trim() });
    if (error) setMsg('Not eklenemedi: ' + error.message); else { setBody(''); setMsg(''); load(); c.bump(); }
  };
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Notlar</h2>
      <p className="meta">{t.title}</p>
      {!notes.length && <div className="empty" style={{ padding: '8px 0' }}>Henüz not yok.</div>}
      {notes.map(n => (
        <div className="note" key={n.id}>
          <div className="meta"><b>{c.names[n.author] || 'Kullanıcı'}</b> · {fmtDT(n.created_at)}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
        </div>))}
      {canAdd && (
        <form onSubmit={add} style={{ marginTop: 12 }}>
          <label>Yeni not</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} />
          {msg && <div className="err">{msg}</div>}
          <div className="inline" style={{ marginTop: 10 }}><button className="btn">Not ekle</button></div>
        </form>
      )}
      <div style={{ marginTop: 12 }}><button type="button" className="btn ghost" onClick={onClose}>Kapat</button></div>
    </div>
  );
}

/* ---------- Görev şablonu formu ---------- */
function PresetForm({ initial, c, onSaved, onCancel }) {
  const i = initial || {};
  const [f, setF] = useState({ name: i.name || '', title: i.title || '', description: i.description || '', category_id: i.category_id ?? (c.catList[0]?.id || ''),
    shift: i.shift || 'A', assignee: i.assignee || '', due_n: i.due_n || '', due_unit: i.due_unit || 'saat' });
  const [msg, setMsg] = useState(''); const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = async e => {
    e.preventDefault(); setMsg('');
    const row = { name: f.name.trim(), title: f.title.trim(), description: f.description || null, category_id: f.category_id || null, shift: f.shift,
      assignee: f.assignee || null, due_n: f.due_n ? Number(f.due_n) : null, due_unit: f.due_n ? f.due_unit : null };
    const { error } = i.id ? await supabase.from('task_presets').update(row).eq('id', i.id) : await supabase.from('task_presets').insert(row);
    if (error) setMsg('Kaydedilemedi: ' + error.message); else onSaved();
  };
  return (
    <form className="card" onSubmit={save}>
      <div style={{ marginBottom: 12 }}><label>Şablon adı (listede görünür)</label><input style={{ width: '100%' }} value={f.name} onChange={e => set('name', e.target.value)} required /></div>
      <div style={{ marginBottom: 12 }}><label>Görev başlığı</label><input style={{ width: '100%' }} value={f.title} onChange={e => set('title', e.target.value)} required /></div>
      <div style={{ marginBottom: 12 }}><label>Açıklama</label><textarea value={f.description} onChange={e => set('description', e.target.value)} /></div>
      <div className="grid">
        <div><label>Kategori</label><select value={f.category_id} onChange={e => set('category_id', e.target.value)}>{c.catList.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></div>
        <div><label>Vardiya</label><select value={f.shift} onChange={e => set('shift', e.target.value)}>{Object.entries(SHIFTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label>Varsayılan sorumlu (isteğe bağlı)</label><select value={f.assignee} onChange={e => set('assignee', e.target.value)}><option value="">Atanmamış</option>{c.people.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}</select></div>
        <div><label>Varsayılan süre (isteğe bağlı)</label><div className="inline"><input type="number" min="1" value={f.due_n} onChange={e => set('due_n', e.target.value)} />
          <select value={f.due_unit} onChange={e => set('due_unit', e.target.value)}><option value="saat">saat</option><option value="gün">gün</option></select></div></div>
      </div>
      {msg && <div className="err">{msg}</div>}
      <div className="inline" style={{ marginTop: 14 }}><button className="btn">Kaydet</button><button type="button" className="btn ghost" onClick={onCancel}>İptal</button></div>
    </form>
  );
}

/* ---------- Kullanıcı yönetimi (yönetici) ---------- */
function Users({ c }) {
  const blank = { full_name: '', username: '', pin: '', role: 'receptionist', notify_email: '' };
  const [f, setF] = useState(blank); const [msg, setMsg] = useState(''); const [ed, setEd] = useState(null);
  const [contacts, setContacts] = useState({});
  const loadContacts = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/users', { headers: { Authorization: `Bearer ${session.access_token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setContacts(Object.fromEntries((j.contacts || []).map(x => [x.id, x])));
  }, []);
  useEffect(() => { loadContacts(); }, [loadContacts]);
  const call = async (method, body) => {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/users', { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (r.ok) loadContacts(); return r.ok ? null : (j.error || 'İşlem başarısız.');
  };
  const add = async e => { e.preventDefault(); setMsg('');
    const err = await call('POST', f); if (err) setMsg(err); else { setMsg('Kullanıcı eklendi.'); setF(blank); c.reloadPeople(); } };
  const saveEd = async e => { e.preventDefault();
    const b = { id: ed.id, full_name: ed.full_name, role: ed.role, active: ed.active, notify_email: ed.notify_email || '' };
    if (ed.username) b.username = ed.username; if (ed.pin) b.pin = ed.pin;
    const err = await call('PATCH', b); if (err) setEd({ ...ed, err }); else { setEd(null); c.reloadPeople(); } };
  const roleSel = (v, fn) => <select value={v} onChange={e => fn(e.target.value)}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
  return (<>
    <h2>Kullanıcılar</h2>
    {ed && (
      <form className="card" onSubmit={saveEd}>
        <h3 style={{ marginTop: 0 }}>Düzenle: {ed.full_name || ed.username}</h3>
        <div className="grid">
          <div><label>İsim</label><input value={ed.full_name} onChange={e => setEd({ ...ed, full_name: e.target.value })} required /></div>
          <div><label>Kullanıcı adı</label><input value={ed.username || ''} onChange={e => setEd({ ...ed, username: e.target.value.toLowerCase() })} placeholder="örn. ayse.k" /></div>
          <div><label>Yeni PIN (4-6 rakam, boş = değişmez)</label><input inputMode="numeric" maxLength={6} value={ed.pin || ''} onChange={e => setEd({ ...ed, pin: e.target.value.replace(/\D/g, '') })} /></div>
          <div><label>Rol</label>{roleSel(ed.role, v => setEd({ ...ed, role: v }))}</div>
          <div><label>Hatırlatma e-postası (isteğe bağlı)</label><input type="email" value={ed.notify_email || ''} onChange={e => setEd({ ...ed, notify_email: e.target.value })} /></div>
          <div><label>Durum</label><select value={ed.active ? '1' : '0'} onChange={e => setEd({ ...ed, active: e.target.value === '1' })}><option value="1">Aktif</option><option value="0">Pasif (giriş yapamaz)</option></select></div>
        </div>
        {ed.err && <div className="err">{ed.err}</div>}
        <div className="inline" style={{ marginTop: 14 }}><button className="btn">Kaydet</button><button type="button" className="btn ghost" onClick={() => setEd(null)}>İptal</button></div>
      </form>
    )}
    <table><thead><tr><th>İsim</th><th>Kullanıcı adı</th><th>Rol</th><th>Durum</th><th /></tr></thead>
      <tbody>{c.people.map(p => (
        <tr key={p.id}><td>{p.full_name || '—'}</td><td>{p.username || <span className="meta">tanımsız</span>}</td><td>{ROLES[p.role]}</td><td>{p.active ? 'Aktif' : 'Pasif'}</td>
          <td className="n"><button className="btn ghost sm" onClick={() => setEd({ ...p, notify_email: contacts[p.id]?.notify_email || '', pin: '' })}>Düzenle</button></td></tr>))}</tbody></table>
    <h3>Yeni kullanıcı ekle</h3>
    <form className="card" onSubmit={add}>
      <div className="grid">
        <div><label>İsim</label><input value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} required /></div>
        <div><label>Kullanıcı adı</label><input value={f.username} onChange={e => setF({ ...f, username: e.target.value.toLowerCase() })} placeholder="örn. ayse.k" required /></div>
        <div><label>PIN (4-6 rakam)</label><input inputMode="numeric" maxLength={6} value={f.pin} onChange={e => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} required /></div>
        <div><label>Rol</label>{roleSel(f.role, v => setF({ ...f, role: v }))}</div>
        <div><label>Hatırlatma e-postası (isteğe bağlı)</label><input type="email" value={f.notify_email} onChange={e => setF({ ...f, notify_email: e.target.value })} /></div>
      </div>
      {msg && <div className={msg === 'Kullanıcı eklendi.' ? 'meta' : 'err'} style={{ marginTop: 10 }}>{msg}</div>}
      <div style={{ marginTop: 14 }}><button className="btn">Kullanıcıyı ekle</button></div>
    </form>
  </>);
}
