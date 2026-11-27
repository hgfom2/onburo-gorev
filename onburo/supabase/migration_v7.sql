-- v7: C (gece) vardiyası düzeltmesi. Supabase > SQL Editor'de çalıştırın.
-- Kural: "27 Kasım gece vardiyası (C)" 28 Kasım 00:01'de başlar, 28 Kasım 08:00'de biter.
--   -> C görevinin due_date'i vardiyanın GÜNÜDÜR (27), son saati (due_at) ERTESİ günün sabahıdır (28 08:00).
-- Şema değişmez; yalnızca bugün ve sonraki tarihli C görevlerinin tarihleri düzeltilir.
-- Geçmiş (bugünden önceki) görevlere dokunulmaz. Birden fazla çalıştırmak güvenlidir (ikinci kez bir şey değiştirmez).
-- UYGULAMA SIRASI: yeni kodu deploy edin, ardından bu SQL'i çalıştırın.

-- 1) Şablondan üretilmiş C görevleri: son saat (due_at) bir gün ileri alınır. due_date aynı kalır.
--    Örn. 27 Kasım C görevi: 27 Kasım 08:00 (vardiya başlamadan geçmiş) -> 28 Kasım 08:00
update tasks
   set due_at = due_at + interval '1 day'
 where shift = 'C'
   and template_id is not null
   and due_date >= (now() at time zone 'Europe/Istanbul')::date
   and (due_at at time zone 'Europe/Istanbul')::date = due_date
   and (due_at at time zone 'Europe/Istanbul')::time <= time '08:00';

-- 2) Elle girilmiş (tek seferlik) C görevleri: yöneticinin girdiği son tarih (due_at) korunur,
--    vardiya günü (due_date) bir gün geri alınır. Örn. son tarih 28 Kasım 06:00 -> 27 Kasım gece vardiyası.
update tasks
   set due_date = due_date - 1
 where shift = 'C'
   and template_id is null
   and due_date >= (now() at time zone 'Europe/Istanbul')::date
   and (due_at at time zone 'Europe/Istanbul')::date = due_date
   and (due_at at time zone 'Europe/Istanbul')::time <= time '08:00';

-- 3) Kontrol: C vardiyasında son saati 08:00'den sonra olan aktif tekrarlayan görevler varsa listelenir.
--    (Bunlar gece vardiyasına uymaz; Görev ekle > Düzenle ile son saati 00:01-08:00 arasına çekin veya vardiyayı değiştirin.)
select id, title, due_time from templates where active and shift = 'C' and due_time > time '08:00';

-- 4) Kontrol: bugünden itibaren C görevleri
select due_date, title, due_at at time zone 'Europe/Istanbul' as son_tarih, status
  from tasks
 where shift = 'C' and due_date >= (now() at time zone 'Europe/Istanbul')::date
 order by due_date, title;
