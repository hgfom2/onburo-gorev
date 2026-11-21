import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const pepper = process.env.PIN_PEPPER;
  if (!pepper) return Response.json({ error: 'Sunucu ayarı eksik (PIN_PEPPER).' }, { status: 500 });
  const { username, pin } = await req.json().catch(() => ({}));
  const u = String(username || '').trim().toLowerCase();
  if (!u || !pin) return Response.json({ error: 'Kullanıcı adı ve PIN girin.' }, { status: 400 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: `${u}@onburo.local`, password: `${pin}${pepper}` });
  if (error || !data.session) return Response.json({ error: 'Kullanıcı adı veya PIN hatalı.' }, { status: 401 });
  return Response.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
}
