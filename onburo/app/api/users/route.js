import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ROLES = ['admin', 'supervisor', 'receptionist'];
const userOk = u => /^[a-z0-9._-]{3,30}$/.test(u);
const pinOk = p => /^\d{4,6}$/.test(p);
const bad = (m, s = 400) => Response.json({ error: m }, { status: s });

async function adminId(req, sb) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return { err: 'Oturum bilgisi sunucuya ulaşmadı (token yok). Çıkış yapıp tekrar girin.' };
  const { data, error } = await sb.auth.getUser(token);
  if (!data?.user) return { err: 'Oturum doğrulanamadı: ' + (error?.message || 'bilinmeyen hata') + ' (SUPABASE_SERVICE_ROLE_KEY doğru mu?)' };
  const { data: p, error: e2 } = await sb.from('profiles').select('role,active').eq('id', data.user.id).single();
  if (!p) return { err: 'Profil okunamadı: ' + (e2?.message || 'satır yok') + ' (SUPABASE_SERVICE_ROLE_KEY doğru mu?)' };
  if (p.role !== 'admin' || !p.active) return { err: 'Bu işlem için yönetici olmalısınız.' };
  return { id: data.user.id };
}

// Yalnızca yönetici: iletişim alanları (e-posta, hatırlatma e-postası) istemciye doğrudan açık değildir
export async function GET(req) {
  const sb = db(); const g = await adminId(req, sb); if (!g.id) return bad(g.err, 403);
  const { data, error } = await sb.from('profiles').select('id,email,notify_email');
  if (error) return bad(error.message, 500);
  return Response.json({ contacts: data });
}

export async function POST(req) {
  const pepper = process.env.PIN_PEPPER; if (!pepper) return bad('Sunucu ayarı eksik (PIN_PEPPER).', 500);
  const sb = db(); const g = await adminId(req, sb); if (!g.id) return bad(g.err, 403);
  const b = await req.json().catch(() => ({}));
  const username = String(b.username || '').trim().toLowerCase(); const pin = String(b.pin || '');
  if (!String(b.full_name || '').trim()) return bad('İsim gerekli.');
  if (!userOk(username)) return bad('Kullanıcı adı 3-30 karakter olmalı; sadece küçük harf (a-z), rakam, nokta, tire, alt çizgi.');
  if (!pinOk(pin)) return bad('PIN 4 ila 6 rakam olmalı.');
  const { data, error } = await sb.auth.admin.createUser({ email: `${username}@onburo.local`, password: `${pin}${pepper}`, email_confirm: true, user_metadata: { full_name: b.full_name } });
  if (error) return bad(/already|registered/i.test(error.message) ? 'Bu kullanıcı adı zaten var.' : error.message);
  const { error: e2 } = await sb.from('profiles').update({
    full_name: String(b.full_name).trim(), username, email: `${username}@onburo.local`,
    role: ROLES.includes(b.role) ? b.role : 'receptionist', notify_email: b.notify_email || null, active: true
  }).eq('id', data.user.id);
  if (e2) return bad(e2.message);
  return Response.json({ ok: true });
}

export async function PATCH(req) {
  const pepper = process.env.PIN_PEPPER; if (!pepper) return bad('Sunucu ayarı eksik (PIN_PEPPER).', 500);
  const sb = db(); const g = await adminId(req, sb); if (!g.id) return bad(g.err, 403); const me = g.id;
  const b = await req.json().catch(() => ({}));
  if (!b.id) return bad('Kullanıcı seçilmedi.');
  if (b.id === me && ((b.role && b.role !== 'admin') || b.active === false)) return bad('Kendi yönetici yetkinizi veya hesabınızı kapatamazsınız.');
  const { data: cur } = await sb.from('profiles').select('username').eq('id', b.id).single();
  const upd = {}; const auth = {};
  if (b.full_name !== undefined) upd.full_name = String(b.full_name).trim();
  if (b.role) { if (!ROLES.includes(b.role)) return bad('Geçersiz rol.'); upd.role = b.role; }
  if (b.active !== undefined) { upd.active = !!b.active; auth.ban_duration = b.active ? 'none' : '876000h'; }
  if (b.notify_email !== undefined) upd.notify_email = b.notify_email || null;
  if (b.username) {
    const u = String(b.username).trim().toLowerCase();
    if (!userOk(u)) return bad('Kullanıcı adı geçersiz (küçük harf, rakam, . _ - ; 3-30 karakter).');
    if (!cur?.username && !b.pin) return bad('İlk kez kullanıcı adı tanımlarken PIN de girin.');
    upd.username = u; upd.email = `${u}@onburo.local`; auth.email = upd.email; auth.email_confirm = true;
  }
  if (b.pin) {
    if (!pinOk(String(b.pin))) return bad('PIN 4 ila 6 rakam olmalı.');
    auth.password = `${b.pin}${pepper}`;
  }
  if (Object.keys(auth).length) {
    const { error } = await sb.auth.admin.updateUserById(b.id, auth);
    if (error) return bad(/already|registered/i.test(error.message) ? 'Bu kullanıcı adı zaten var.' : error.message);
  }
  if (Object.keys(upd).length) {
    const { error } = await sb.from('profiles').update(upd).eq('id', b.id);
    if (error) return bad(/duplicate|unique/i.test(error.message) ? 'Bu kullanıcı adı zaten var.' : error.message);
  }
  return Response.json({ ok: true });
}
