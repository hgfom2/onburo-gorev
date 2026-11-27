export const TZ = 'Europe/Istanbul';
export const SHIFT_END = { A: '16:00', B: '23:59', C: '08:00' };

export const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const monday = s => { const d = new Date(s + 'T00:00:00Z'); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
export const dateOf = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
export const fmtD = s => new Date(s + 'T00:00:00Z').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const fmtDT = iso => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
export const toLocalInput = iso => new Date(iso).toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T').slice(0, 16);
export const timeOf = iso => new Date(iso).toLocaleTimeString('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }); // "HH:MM"

// C (gece) vardiyası: "27 Kasım gece vardiyası" 28 Kasım 00:01'de başlar, 28 Kasım 08:00'de biter.
// Görevin tarihi (due_date) vardiyanın günüdür; son saati (due_at) ERTESİ günün sabahıdır.
export const NIGHT_END = '08:00';
// Operasyon günü 08:00'de başlar, ertesi gün 08:00'de biter (gece 00:00-08:00 arası hâlâ dünün gece vardiyası sürer)
export const opDayStr = () => new Date(Date.now() - 8 * 3600e3).toLocaleDateString('sv-SE', { timeZone: TZ });
// Son tarihten vardiya gününü bul: C vardiyasında son saat 00:00-08:00 ise bir önceki günün gece vardiyasıdır
export function shiftDateOf(shift, dueIso) {
  const d = dateOf(dueIso);
  return shift === 'C' && timeOf(dueIso) <= NIGHT_END ? addDays(d, -1) : d;
}

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
  const day = t.shift === 'C' ? addDays(date, 1) : date; // C vardiyası ertesi sabah biter
  return `${day}T${time}:00+03:00`;
}
