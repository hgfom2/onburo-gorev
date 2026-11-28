-- v10: Saat dilimi Türkiye (UTC+3 sabit) yerine Kıbrıs (Europe/Nicosia; kışın UTC+2, yazın UTC+3).
-- !! TEK SEFERLİK: 2. bölüm açık görevlerin son saatini yeniden yorumlar; ikinci kez çalıştırmayın.
-- UYGULAMA SIRASI: bu SQL, hemen ardından yeni kodun deploy'u.

-- 1) Grup fonksiyonları Kıbrıs saatini kullanır
create or replace function group_wanted(gid uuid) returns table(rule_id uuid, title text, shift text, assignee uuid, dt date)
language sql stable security definer set search_path = public as $$
  with g as (select * from beo_groups where id = gid and status = 'active'),
       td as (select (now() at time zone 'Europe/Nicosia')::date as today)
  select r.id, r.title, r.shift, r.assignee, (g.arrival + r.offset_days) from group_rules r, g where r.active and r.when_type = 'arrival'
  union all
  select r.id, r.title, r.shift, r.assignee, (g.departure + r.offset_days) from group_rules r, g where r.active and r.when_type = 'departure'
  union all
  select r.id, r.title, r.shift, r.assignee, s::date
    from group_rules r, g, td,
         generate_series(greatest(g.arrival, td.today)::timestamp, (g.departure - 1)::timestamp, interval '1 day') s
    where r.active and r.when_type = 'daily'
$$;

create or replace function generate_group_tasks(gid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare g beo_groups; cat int; n int; today date := (now() at time zone 'Europe/Nicosia')::date;
begin
  if my_role() is null or my_role() not in ('admin','supervisor') then raise exception 'Yetkisiz.'; end if;
  select * into g from beo_groups where id = gid;
  if not found then raise exception 'Grup bulunamadı.'; end if;
  select id into cat from categories where name = 'Grup';
  if g.status = 'cancelled' then
    update tasks set status = 'cancelled', cancel_reason = 'Grup iptal edildi', cancelled_at = now(), cancelled_by = auth.uid()
      where group_id = gid and rule_id is not null and status = 'open';
    return 0;
  end if;
  delete from tasks where group_id = gid and rule_id is not null and status = 'cancelled' and cancel_reason = 'Grup iptal edildi';
  delete from tasks t where t.group_id = gid and t.rule_id is not null and t.status = 'open' and t.due_date >= today
    and not exists (select 1 from group_wanted(gid) w where w.rule_id = t.rule_id and w.dt = t.due_date);
  update tasks t set title = g.name || ': ' || r.title from group_rules r
    where t.group_id = gid and t.rule_id = r.id and t.status = 'open' and t.title is distinct from g.name || ': ' || r.title;
  insert into tasks(title, category_id, shift, assignee, due_date, due_at, group_id, rule_id)
    select g.name || ': ' || w.title, cat, w.shift, w.assignee, w.dt,
           ((case when w.shift = 'C' then w.dt + 1 else w.dt end)::timestamp
             + (case w.shift when 'A' then time '16:00' when 'B' then time '23:59' else time '08:00' end)) at time zone 'Europe/Nicosia',
           gid, w.rule_id
    from group_wanted(gid) w
    on conflict (group_id, rule_id, due_date) where group_id is not null and rule_id is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- 2) Açık görevlerin son saati: eskiden "saat X (Türkiye)" olarak kaydedilmişti; aynı duvar saati Kıbrıs saati olarak yeniden yorumlanır
--    (örn. 16:00 Türkiye = 15:00 Kıbrıs  ->  16:00 Kıbrıs). Tamamlanan/iptal görevlere dokunulmaz.
update tasks
   set due_at = (due_at at time zone 'Europe/Istanbul') at time zone 'Europe/Nicosia'
 where status = 'open' and due_at is not null;
