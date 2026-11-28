-- v11: Grup bilgileri (oda/kişi, sektör/firma, acente, toplantı, yemek, etkinlik) ve "Grup" görevlerini yalnızca yönetime göster.
-- Grup bilgilerini herkes görür; grup görevleri "Grup" kategorisi yönetime özel (mgr_only) yapıldığı için resepsiyonistlere görünmez.
alter table beo_groups
  add column rooms int check (rooms is null or rooms >= 0),
  add column pax int check (pax is null or pax >= 0),
  add column sector text,
  add column company text,
  add column agency text,
  add column agency_contact_name text,
  add column agency_contact text,
  add column has_meeting boolean not null default false,
  add column meal_payer text check (meal_payer in ('agency','guest')),   -- ekstra yemekleri kim öder
  add column meal_notes text,
  add column events text;

update categories set mgr_only = true where name = 'Grup';

-- Resepsiyonist yalnızca bileklik rengi ve notu değiştirebilir (diğer tüm alanlar korumalı)
create or replace function guard_group_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if my_role() = 'receptionist' and (to_jsonb(new) - 'wristband' - 'note') is distinct from (to_jsonb(old) - 'wristband' - 'note') then
    raise exception 'Resepsiyonistler yalnızca bileklik rengini ve notu güncelleyebilir.';
  end if;
  return new;
end $$;

-- Üretilen görevler resepsiyonistlere atanmaz (kural sorumlusu resepsiyonistse atanmamış kalır)
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
    select g.name || ': ' || w.title, cat, w.shift,
           case when exists (select 1 from profiles p where p.id = w.assignee and p.role = 'receptionist') then null else w.assignee end,
           w.dt,
           ((case when w.shift = 'C' then w.dt + 1 else w.dt end)::timestamp
             + (case w.shift when 'A' then time '16:00' when 'B' then time '23:59' else time '08:00' end)) at time zone 'Europe/Nicosia',
           gid, w.rule_id
    from group_wanted(gid) w
    on conflict (group_id, rule_id, due_date) where group_id is not null and rule_id is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
