-- Supabase > SQL Editor'de BİR KEZ çalıştırın (v2 güncellemesi).
alter table profiles add column if not exists username text;
create unique index if not exists profiles_username_key on profiles (lower(username));
alter table profiles add column if not exists notify_email text;

alter table tasks add column if not exists due_at timestamptz;
update tasks set due_at = (due_date::text || ' 23:59:00+03')::timestamptz where due_at is null;

alter table templates add column if not exists due_time time;
alter table templates drop constraint if exists templates_recurrence_check;
alter table templates add constraint templates_recurrence_check
  check (recurrence in ('daily','weekly','monthly_first','monthly_last'));

-- "Kasa ve Fatura" kategorisini kaldır (mevcut görevler Operasyon'a taşınır)
update tasks set category_id = (select id from categories where name='Operasyon')
  where category_id = (select id from categories where name='Kasa ve Fatura');
update templates set category_id = (select id from categories where name='Operasyon')
  where category_id = (select id from categories where name='Kasa ve Fatura');
delete from categories where name='Kasa ve Fatura';

select * from categories order by id;
