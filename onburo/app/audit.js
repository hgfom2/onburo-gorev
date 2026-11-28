'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtDT } from '../lib/util';

const TABLES = { tasks: 'Görev', templates: 'Şablon', profiles: 'Kullanıcı', beo_groups: 'Grup', group_rules: 'Grup kuralı', task_items: 'Alt madde', cash_handovers: 'Kasa devri' };
const ACTIONS = { INSERT: 'Eklendi', UPDATE: 'Değiştirildi', DELETE: 'Silindi' };
const FIELDS = { status: 'Durum', assignee: 'Sorumlu', title: 'Başlık', due_at: 'Son saat', due_date: 'Tarih', shift: 'Vardiya', description: 'Açıklama', cancel_reason: 'İptal sebebi',
  done: 'Yapıldı', label: 'Madde', role: 'Rol', active: 'Aktif', full_name: 'Ad', username: 'Kullanıcı adı', name: 'Ad', arrival: 'Giriş', departure: 'Çıkış', wristband: 'Bileklik',
  note: 'Not', rooms: 'Oda', pax: 'Kişi', sector: 'Sektör', company: 'Firma', agency: 'Acente', has_meeting: 'Toplantı', giver: 'Devreden', receiver: 'Alan', recurrence: 'Tekrar',
  weekdays: 'Günler', when_type: 'Ne zaman', offset_days: 'Gün farkı', category_id: 'Kategori', kind: 'Tür', agency_contact_name: 'Acente yetkilisi', agency_contact: 'Acente iletişim',
  meal_payer: 'Yemek', events: 'Etkinlikler', due_time: 'Saat', sort: 'Sıra' };
const VALUES = { open: 'Açık', done: 'Tamamlandı', cancelled: 'İptal', admin: 'Yönetici', supervisor: 'Süpervizör', receptionist: 'Resepsiyonist', agency: 'Acente', guest: 'Misafir' };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function AuditScreen({ c }) {
  const [rows, setRows] = useState(null); const [table, setTable] = useState('');
  const [more, setMore] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const PAGE = 100;

  const load = async (before) => {
    setBusy(true); setErr('');
    let q = supabase.from('audit_log').select('*').order('id', { ascending: false }).limit(PAGE);
    if (table) q = q.eq('table_name', table);
    if (before) q = q.lt('id', before);
    const { data, error } = await q;
    setBusy(false);
    if (error) { setErr('Kayıtlar yüklenemedi: ' + error.message); return; }
    setRows(r => (before ? [...(r || []), ...data] : data)); setMore(data.length === PAGE);
  };
  useEffect(() => { load(); }, [table, c.ver]); // eslint-disable-line react-hooks/exhaustive-deps

  const val = v => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır';
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'string') {
      if (c.names[v]) return c.names[v];
      if (ISO.test(v)) return fmtDT(v);
      return VALUES[v] || (v.length > 80 ? v.slice(0, 80) + '…' : v);
    }
    return String(v);
  };
  const detail = r => {
    if (r.action !== 'UPDATE' || !r.details) return null;
    return Object.entries(r.details).map(([k, [a, b]]) => <div key={k} className="meta">{FIELDS[k] || k}: {val(a)} → <b>{val(b)}</b></div>);
  };

  return (<>
    <h2>Denetim kaydı</h2>
    <div className="bar">
      <select value={table} onChange={e => setTable(e.target.value)} aria-label="Kayıt türü">
        <option value="">Tüm kayıtlar</option>
        {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <span className="meta">Kayıtlar bir yıl saklanır. Günlük otomatik üretilen görevler kaydedilmez.</span>
    </div>
    {err && <div className="err">{err}</div>}
    {rows && !rows.length && <p className="empty">Kayıt yok.</p>}
    {!!rows?.length && (
      <table>
        <thead><tr><th>Zaman</th><th>Kim</th><th>İşlem</th><th>Kayıt</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id}>
            <td>{fmtDT(r.at)}</td>
            <td>{r.actor_name || (r.actor ? c.names[r.actor] : '') || 'Sistem'}</td>
            <td>{ACTIONS[r.action]} · {TABLES[r.table_name] || r.table_name}</td>
            <td style={{ whiteSpace: 'normal' }}>{r.label || '—'}{detail(r)}</td>
          </tr>))}
        </tbody>
      </table>
    )}
    {more && <div style={{ marginTop: 12 }}><button className="btn ghost" disabled={busy} onClick={() => load(rows[rows.length - 1].id)}>{busy ? 'Yükleniyor…' : 'Daha eski kayıtlar'}</button></div>}
  </>);
}
