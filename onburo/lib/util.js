export const TZ = 'Europe/Istanbul';
export const SHIFT_END = { A: '16:00', B: '23:59', C: '08:00' };

export const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const monday = s => { const d = new Date(s + 'T00:00:00Z'); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
export const dateOf = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
export const fmtD = s => new Date(s + 'T00:00:00Z').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const fmtDT = iso => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
export const toLocalInput = iso => new Date(iso).toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T').slice(0, 16);

// Tekrarlayan şablon bu tarihte görev üretir mi?
export function occursOn(t, date) {
  const wd = new Date(date + 'T00:00:00Z').getUTCDay() || 7; // 1=Pzt..7=Paz
  if (t.recurrence === 'daily') return true;
  if (t.recurrence === 'weekly') return (t.weekdays || []).includes(wd);
  if (t.recurrence === 'monthly_first') return date.slice(8) === '01';
  if (t.recurrence === 'monthly_last') return addDays(date, 1).slice(8) === '01';
  return false;
}
// Şablondan üretilen görevin son teslim zamanı (Türkiye saati, UTC+3)
export function dueFor(t, date) {
  const time = (t.due_time || SHIFT_END[t.shift]).slice(0, 5);
  return `${date}T${time}:00+03:00`;
}
