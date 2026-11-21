import { createClient } from '@supabase/supabase-js';
import { todayStr, occursOn, dueFor, fmtDT } from '../../../lib/util';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('Yetkisiz', { status: 401 });

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const today = todayStr();

  // 1) Tekrarlayan şablonlardan bugünün görevlerini üret
  const { data: tpls } = await db.from('templates').select('*').eq('active', true);
  const rows = (tpls || []).filter(t => occursOn(t, today)).map(t => ({
    title: t.title, description: t.description, category_id: t.category_id, shift: t.shift,
    assignee: t.assignee, due_date: today, due_at: dueFor(t, today), template_id: t.id
  }));
  if (rows.length) await db.from('tasks').upsert(rows, { onConflict: 'template_id,due_date', ignoreDuplicates: true });

  // 2) E-posta hatırlatma (yalnızca "bildirim e-postası" girilmiş kullanıcılara)
  let sent = 0;
  if (process.env.RESEND_API_KEY) {
    const { data: open } = await db.from('tasks').select('title,shift,due_date,due_at,assignee')
      .eq('status', 'open').lte('due_date', today).not('assignee', 'is', null);
    const { data: users } = await db.from('profiles').select('id,notify_email,full_name').eq('active', true);
    for (const u of users || []) {
      const mine = (open || []).filter(t => t.assignee === u.id);
      if (!mine.length || !u.notify_email) continue;
      const lines = mine.map(t => `<li>${t.title} (${t.shift} Vardiyası · son: ${fmtDT(t.due_at)}${t.due_date < today ? ' · <b>gecikmiş</b>' : ''})</li>`).join('');
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.MAIL_FROM, to: u.notify_email, subject: `Bugünkü görevleriniz (${mine.length})`,
          html: `<p>Merhaba ${u.full_name},</p><ul>${lines}</ul><p><a href="${process.env.APP_URL}">Uygulamayı aç</a></p>` })
      });
      if (r.ok) sent++;
    }
  }
  return Response.json({ today, generated: rows.length, emails: sent });
}
