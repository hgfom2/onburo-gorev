-- v8: Grup (BEO) kayıtları ve otomatik görev üretimi.
-- Bir grup kaydedilince, "grup görev kuralları"ndan (ilk giriş günü / her gün / son çıkış günü) görevler üretilir.
-- UYGULAMA SIRASI: önce bu SQL, ardından yeni kodun deploy'u. Eski kod bu SQL ile çalışmaya devam eder.

-- 1) Kategori ve tablolar
insert into categories(name, mgr_only) values ('Grup', false) on conflict (name) do nothing;

create table beo_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  beo_no text,
  arrival date not null,            -- ilk misafir giriş günü
  departure date not null,          -- son misafir çıkış günü
  wristband text,                   -- bileklik rengi (sonradan doldurulur)
  note text,
  status text not null default 'active' check (status in ('active','cancelled')),
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (departure >= arrival)
);
create index on beo_groups (arrival);

create table group_rules (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  when_type text not null check (when_type in ('arrival','daily','departure')),
  offset_days int not null default 0,   -- ilk giriş / son çıkış gününe göre kayma (örn. -1: bir gün önce); "her gün" için yok sayılır
  shift text not null default 'A' check (shift in ('A','B','C')),
  assignee uuid references profiles(id) on delete set null,
  active boolean not null default true,
  sort int not null default 0
);

alter table tasks add column group_id uuid references beo_groups(id) on delete cascade;
alter table tasks add column rule_id uuid references group_rules(id) on delete set null;
create unique index tasks_group_rule_date_key on tasks (group_id, rule_id, due_date) where group_id is not null and rule_id is not null;
create index on tasks (group_id);

-- Bu projede yeni tablolara Data API yetkisi otomatik verilmez
revoke all on beo_groups, group_rules from anon;
grant select, insert, update, delete on beo_groups, group_rules to authenticated;
grant all on beo_groups, group_rules to service_role;

-- 2) Hazır kurallar (Ayarlar > Grup görev kuralları'ndan değiştirilebilir)
insert into group_rules(title, when_type, sort) values
  ('Sanal folyo oluştur', 'arrival', 1),
  ('Mutabakat dosyası oluştur', 'arrival', 2),
  ('Grup bileklik rengini belirle', 'arrival', 3),
  ('Günlük inhouse mailini gönder', 'daily', 4),
  ('Günlük mutabakat tablosunu güncelle', 'daily', 5),
  ('Mutabakatı kapat', 'departure', 6);

-- 3) Bir grup için üretilmesi gereken görevler
-- "Her gün" görevleri: ilk giriş gününden çıkış gününün bir önceki gününe kadar; geçmiş günler üretilmez.
create function group_wanted(gid uuid) returns table(rule_id uuid, title text, shift text, assignee uuid, dt date)
language sql stable security definer set search_path = public as $$
  with g as (select * from beo_groups where id = gid and status = 'active'),
       td as (select (now() at time zone 'Europe/Istanbul')::date as today)
  select r.id, r.title, r.shift, r.assignee, (g.arrival + r.offset_days) from group_rules r, g where r.active and r.when_type = 'arrival'
  union all
  select r.id, r.title, r.shift, r.assignee, (g.departure + r.offset_days) from group_rules r, g where r.active and r.when_type = 'departure'
  union all
  select r.id, r.title, r.shift, r.assignee, s::date
    from group_rules r, g, td,
         generate_series(greatest(g.arrival, td.today)::timestamp, (g.departure - 1)::timestamp, interval '1 day') s
    where r.active and r.when_type = 'daily'
$$;
revoke execute on function group_wanted(uuid) from public, anon, authenticated;

-- Görevleri üret / güncelle (güvenle tekrar çalıştırılabilir; tamamlanan ve geçmiş görevlere dokunmaz)
create function generate_group_tasks(gid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare g beo_groups; cat int; n int; today date := (now() at time zone 'Europe/Istanbul')::date;
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

  -- grup tekrar aktif edildiyse, iptal nedeniyle kapanan görevleri yeniden üret
  delete from tasks where group_id = gid and rule_id is not null and status = 'cancelled' and cancel_reason = 'Grup iptal edildi';

  -- tarihler / kurallar değiştiyse artık gerekmeyen (bugün ve sonrası) açık görevleri sil
  delete from tasks t where t.group_id = gid and t.rule_id is not null and t.status = 'open' and t.due_date >= today
    and not exists (select 1 from group_wanted(gid) w where w.rule_id = t.rule_id and w.dt = t.due_date);

  -- grup adı veya kural başlığı değiştiyse açık görevlerin başlığını güncelle
  update tasks t set title = g.name || ': ' || r.title from group_rules r
    where t.group_id = gid and t.rule_id = r.id and t.status = 'open' and t.title is distinct from g.name || ': ' || r.title;

  insert into tasks(title, category_id, shift, assignee, due_date, due_at, group_id, rule_id)
    select g.name || ': ' || w.title, cat, w.shift, w.assignee, w.dt,
           ((case when w.shift = 'C' then w.dt + 1 else w.dt end)::text || 'T' || case w.shift when 'A' then '16:00' when 'B' then '23:59' else '08:00' end || ':00+03:00')::timestamptz, -- C: ertesi sabah 08:00
           gid, w.rule_id
    from group_wanted(gid) w
    on conflict (group_id, rule_id, due_date) where group_id is not null and rule_id is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function generate_group_tasks(uuid) from public, anon;
grant execute on function generate_group_tasks(uuid) to authenticated;

-- 4) Korumalar
-- Görev: resepsiyonist grup bağlantısını da değiştiremez
create or replace function public.guard_task_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and my_role() is null then
    raise exception 'Hesap pasif.';
  end if;
  if my_role() = 'receptionist' then
    if new.title is distinct from old.title or new.description is distinct from old.description
       or new.category_id is distinct from old.category_id or new.shift is distinct from old.shift
       or new.assignee is distinct from old.assignee or new.due_date is distinct from old.due_date
       or new.due_at is distinct from old.due_at or new.template_id is distinct from old.template_id
       or new.kind is distinct from old.kind or new.group_id is distinct from old.group_id
       or new.rule_id is distinct from old.rule_id then
      raise exception 'Resepsiyonistler görev bilgilerini değiştiremez.';
    end if;
    if old.status = 'cancelled' and new.status is distinct from old.status then
      raise exception 'İptal edilen görevi yalnızca yönetici veya süpervizör yeniden açabilir.';
    end if;
  end if;
  if new.kind = 'cash_handover' and new.status = 'done' and old.status is distinct from 'done'
     and not exists (select 1 from cash_handovers h where h.task_id = new.id) then
    raise exception 'Kasa devri için devreden, alan ve kasa raporu girilmeli.';
  end if;
  return new;
end $$;

-- Grup: resepsiyonist yalnızca bileklik rengini ve notu güncelleyebilir
create function guard_group_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if my_role() = 'receptionist' and (new.name is distinct from old.name or new.beo_no is distinct from old.beo_no
     or new.arrival is distinct from old.arrival or new.departure is distinct from old.departure or new.status is distinct from old.status) then
    raise exception 'Resepsiyonistler yalnızca bileklik rengini ve notu güncelleyebilir.';
  end if;
  return new;
end $$;
revoke execute on function guard_group_update() from public, anon, authenticated;
create trigger beo_groups_guard before update on beo_groups for each row execute function guard_group_update();

-- 5) RLS: herkes grupları görür; ekleme/silme yönetimde; güncelleme herkeste (kısıt yukarıdaki tetikleyicide)
alter table beo_groups enable row level security;
alter table group_rules enable row level security;
create policy "groups_read" on beo_groups for select to authenticated using (my_role() is not null);
create policy "groups_insert" on beo_groups for insert to authenticated with check (my_role() in ('admin','supervisor'));
create policy "groups_update" on beo_groups for update to authenticated using (my_role() is not null) with check (my_role() is not null);
create policy "groups_delete" on beo_groups for delete to authenticated using (my_role() in ('admin','supervisor'));
create policy "rules_manage" on group_rules for all to authenticated
  using (my_role() in ('admin','supervisor')) with check (my_role() in ('admin','supervisor'));

-- 6) Canlı yenileme
alter publication supabase_realtime add table public.beo_groups;
