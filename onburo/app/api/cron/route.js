import { createClient } from '@supabase/supabase-js';
import { todayStr, addDays, occursOn, dueFor, fmtDT } from '../../../lib/util';

export const dynamic = 'force-dynamic';

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`)
    return new Response('Yetkisiz', { status: 401 });

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const today = todayStr();
  const isLate = t => (t.due_at ? new Date(t.due_at) < new Date() : t.due_date < today); // C vardiyası ertesi sabah 08:00'de biter

  // 1) Tekrarlayan şablonlardan bugünün görevlerini üret.
  //    Telafi: son 3 günde şablondan hiç görev üretilmemiş bir gün varsa (cron o gün çalışmamıştır) o gün de üretilir.
  const { data: tpls } = await db.from('templates').select('*').eq('active', true);
  const mk = (t, d) => ({
    title: t.title, description: t.description, category_id: t.category_id, shift: t.shift,
    assignee: t.assignee, kind: t.kind || 'normal', due_date: d, due_at: dueFor(t, d), template_id: t.id
  });
  const days = [today];
  const since = addDays(today, -3);
  const { data: have } = await db.from('tasks').select('due_date').not('template_id', 'is', null).gte('due_date', since).lt('due_date', today).limit(5000);
  const haveDays = new Set((have || []).map(x => x.due_date));
  const catchUp = [];
  for (let k = 3; k >= 1; k--) { const d = addDays(today, -k); if (!haveDays.has(d)) catchUp.push(d); }
  const rows = [...catchUp, ...days].flatMap(d => (tpls || []).filter(t => occursOn(t, d)).map(t => mk(t, d)));
  if (rows.length) await db.from('tasks').upsert(rows, { onConflict: 'template_id,due_date', ignoreDuplicates: true });
  await db.from('login_attempts').delete().lt('at', new Date(Date.now() - 24 * 3600e3).toISOString()); // eski giriş denemelerini temizle

  // 2) E-posta hatırlatma (yalnızca "bildirim e-postası" girilmiş kullanıcılara)
  let sent = 0;
  if (process.env.RESEND_API_KEY) {
    const { data: open } = await db.from('tasks').select('title,shift,due_date,due_at,assignee')
      .eq('status', 'open').lte('due_date', today).not('assignee', 'is', null);
    // Alt maddeye atanmış kişiler de hatırlatma alır (ana görev kişiye atanmamış olsa bile)
    const { data: openItems } = await db.from('task_items').select('assignee,label,tasks!inner(title,shift,due_date,due_at,status)')
      .eq('done', false).eq('tasks.status', 'open').lte('tasks.due_date', today).not('assignee', 'is', null);
    const { data: users } = await db.from('profiles').select('id,notify_email,full_name').eq('active', true);
    for (const u of users || []) {
      const mine = (open || []).filter(t => t.assignee === u.id);
      const myItems = (openItems || []).filter(i => i.assignee === u.id);
      if ((!mine.length && !myItems.length) || !u.notify_email) continue;
      const lines = mine.map(t => `<li>${esc(t.title)} (${t.shift} Vardiyası · son: ${fmtDT(t.due_at)}${isLate(t) ? ' · <b>gecikmiş</b>' : ''})</li>`).join('')
        + myItems.map(i => `<li>${esc(i.tasks.title)} → ${esc(i.label)} (${i.tasks.shift} Vardiyası · son: ${fmtDT(i.tasks.due_at)}${isLate(i.tasks) ? ' · <b>gecikmiş</b>' : ''})</li>`).join('');
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.MAIL_FROM, to: u.notify_email, subject: `Bugünkü görevleriniz (${mine.length + myItems.length})`,
          html: `<p>Merhaba ${esc(u.full_name)},</p><ul>${lines}</ul><p><a href="${process.env.APP_URL}">Uygulamayı aç</a></p>` })
      });
      if (r.ok) sent++;
    }
  }
  return Response.json({ today, generated: rows.length, caughtUp: catchUp, emails: sent });
}
