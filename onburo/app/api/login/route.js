import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const pepper = process.env.PIN_PEPPER;
  if (!pepper) return Response.json({ error: 'Sunucu ayarı eksik (PIN_PEPPER).' }, { status: 500 });
  const { username, pin } = await req.json().catch(() => ({}));
  const u = String(username || '').trim().toLowerCase();
  if (!u || !pin) return Response.json({ error: 'Kullanıcı adı ve PIN girin.' }, { status: 400 });

  // Deneme sınırı: kullanıcı başına 15 dakikada 5, IP başına 20 hatalı deneme. Veritabanı hatasında giriş engellenmez.
  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'yok';
  const keys = [`u:${u}`, `ip:${ip}`];
  const since = new Date(Date.now() - 15 * 60e3).toISOString();
  if (admin) {
    const [a, b] = await Promise.all(keys.map(k => admin.from('login_attempts').select('id', { count: 'exact', head: true }).eq('key', k).gte('at', since)));
    if ((a.count || 0) >= 5 || (b.count || 0) >= 20)
      return Response.json({ error: 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.' }, { status: 429 });
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: `${u}@onburo.local`, password: `${pin}${pepper}` });
  if (error || !data.session) {
    if (admin) await admin.from('login_attempts').insert(keys.map(key => ({ key })));
    return Response.json({ error: 'Kullanıcı adı veya PIN hatalı.' }, { status: 401 });
  }
  if (admin) await admin.from('login_attempts').delete().eq('key', keys[0]);
  return Response.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
}
