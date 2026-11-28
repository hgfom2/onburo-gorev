-- Güncel şema (v1 + v2 + v3, canlı veritabanıyla eşleşir). Yeni kurulum için Supabase > SQL Editor'de çalıştırın.
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  email text,
  role text not null default 'receptionist' check (role in ('admin','supervisor','receptionist')),
  active boolean not null default true,
  username text,
  notify_email text
);
create unique index profiles_username_key on profiles (lower(username));

create table categories (id serial primary key, name text not null unique);
insert into categories(name) values ('Operasyon'),('Misafir İlişkileri'),('İdari');

create table templates (
  id uuid primary key default gen_random_uuid(),
  title text not null, description text,
  category_id int references categories(id),
  shift text not null check (shift in ('A','B','C')),
  assignee uuid references profiles(id),
  recurrence text not null check (recurrence in ('daily','weekly','monthly_first','monthly_last')),
  weekdays int[] not null default '{1,2,3,4,5,6,7}',  -- 1=Pzt ... 7=Paz
  active boolean not null default true,
  due_time time
);
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null, description text,
  category_id int references categories(id),
  shift text not null check (shift in ('A','B','C')),
  assignee uuid references profiles(id),
  due_date date not null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  completed_at timestamptz,
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references profiles(id),
  template_id uuid references templates(id) on delete set null,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (template_id, due_date),
  constraint tasks_cancel_reason_check check (status <> 'cancelled' or length(trim(coalesce(cancel_reason, ''))) >= 3)
);
create index on tasks (due_date, shift);
create index on tasks (assignee, due_date);

create table task_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null, title text not null, description text,
  category_id int references categories(id),
  shift text check (shift in ('A','B','C')),
  assignee uuid references profiles(id),
  due_n int,
  due_unit text check (due_unit in ('saat','gün')),
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create table task_notes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  author uuid not null references profiles(id) default auth.uid(),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

-- Yeni kullanici eklenince profil olustur
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, email, full_name) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create function my_role() returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active $$;

-- Resepsiyonistler görev bilgilerini değiştiremez; pasif kullanıcılar hiçbir şey yapamaz
create function guard_task_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and my_role() is null then
    raise exception 'Hesap pasif.';
  end if;
  if my_role() = 'receptionist' then
    if new.title is distinct from old.title or new.description is distinct from old.description
       or new.category_id is distinct from old.category_id or new.shift is distinct from old.shift
       or new.assignee is distinct from old.assignee or new.due_date is distinct from old.due_date
       or new.due_at is distinct from old.due_at or new.template_id is distinct from old.template_id then
      raise exception 'Resepsiyonistler görev bilgilerini değiştiremez.';
    end if;
    if old.status = 'cancelled' and new.status is distinct from old.status then
      raise exception 'İptal edilen görevi yalnızca yönetici veya süpervizör yeniden açabilir.';
    end if;
  end if;
  return new;
end $$;
create trigger tasks_guard before update on tasks for each row execute function guard_task_update();

revoke execute on function guard_task_update(), handle_new_user() from public, anon, authenticated;
revoke execute on function my_role() from public, anon;
grant execute on function my_role() to authenticated;

alter table profiles enable row level security;
alter table categories enable row level security;
alter table templates enable row level security;
alter table tasks enable row level security;
alter table task_presets enable row level security;
alter table task_notes enable row level security;

create policy "profiles_read" on profiles for select to authenticated using (true);
create policy "profiles_admin" on profiles for update to authenticated using (my_role()='admin');
create policy "cat_read" on categories for select to authenticated using (true);
create policy "cat_admin" on categories for all to authenticated using (my_role()='admin') with check (my_role()='admin');
create policy "tpl_manage" on templates for all to authenticated
  using (my_role() in ('admin','supervisor')) with check (my_role() in ('admin','supervisor'));
create policy "presets_manage" on task_presets for all to authenticated
  using (my_role() in ('admin','supervisor')) with check (my_role() in ('admin','supervisor'));
create policy "tasks_read" on tasks for select to authenticated
  using (my_role() is not null and (my_role() in ('admin','supervisor') or assignee = auth.uid()));
create policy "tasks_insert" on tasks for insert to authenticated with check (my_role() in ('admin','supervisor'));
create policy "tasks_update" on tasks for update to authenticated
  using (my_role() is not null and (my_role() in ('admin','supervisor') or assignee = auth.uid()))
  with check (my_role() is not null and (my_role() in ('admin','supervisor') or assignee = auth.uid()));
create policy "tasks_delete" on tasks for delete to authenticated using (my_role() in ('admin','supervisor'));
create policy "notes_read" on task_notes for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_notes.task_id));
create policy "notes_insert" on task_notes for insert to authenticated
  with check (my_role() is not null and author = auth.uid() and exists (
    select 1 from tasks t where t.id = task_notes.task_id
      and (t.assignee = auth.uid() or my_role() in ('admin','supervisor'))));

-- ILK ADMIN: kullaniciyi Authentication > Users'tan ekledikten sonra:
-- update profiles set role='admin', full_name='Adiniz Soyadiniz' where email='sizin@mailiniz.com';

-- ===== v5: profil iletişim alanları yalnızca sunucudan okunur =====
revoke select on public.profiles from anon, authenticated;
grant select (id, full_name, username, role, active) on public.profiles to authenticated;
-- Canlı yenileme (v4)
alter publication supabase_realtime add table public.tasks, public.task_notes;

-- ===== v6: checklist, yönetime özel kategori, kasa devri (migration_v6.sql ile aynı) =====
-- v6: Checklist alt maddeleri, yönetime özel kategori, kasa devri (devreden / alan / JPEG rapor).
-- UYGULAMA SIRASI: önce bu SQL, hemen ardından yeni kodun deploy'u. Eski kod bu SQL ile çalışmaya devam eder
-- (yeni sütunlar varsayılanlı, yeni tablolar isteğe bağlı), ancak Yönetim kategorisindeki görevleri atanmamış kullanıcı göremez.

-- 1) Kategoriler: yönetime özel işareti + yeni kategoriler
alter table categories add column if not exists mgr_only boolean not null default false;
insert into categories(name, mgr_only) values ('Yönetim', true), ('Checklist', false) on conflict (name) do nothing;

-- 2) Görev türü (normal / kasa devri)
alter table templates add column if not exists kind text not null default 'normal' check (kind in ('normal','cash_handover'));
alter table tasks add column if not exists kind text not null default 'normal' check (kind in ('normal','cash_handover'));

-- 3) Alt maddeler (şablonda tanımlanır, görev üretilince kopyalanır)
create table template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  assignee uuid references profiles(id) on delete set null,
  sort int not null default 0
);
create table task_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  assignee uuid references profiles(id) on delete set null,
  sort int not null default 0,
  done boolean not null default false
);
create index on template_items (template_id);
create index on task_items (task_id);
create index on task_items (assignee);

-- 4) Kasa devri kaydı
create table cash_handovers (
  task_id uuid primary key references tasks(id) on delete cascade,
  giver uuid not null references profiles(id),
  receiver uuid not null references profiles(id),
  report_path text not null,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (giver <> receiver)
);

-- Bu projede yeni tablolara Data API yetkisi otomatik verilmez: açıkça verin (satır erişimini RLS sınırlar)
revoke all on template_items, task_items, cash_handovers from anon;
grant select, insert, update, delete on template_items, task_items, cash_handovers to authenticated;
grant all on template_items, task_items, cash_handovers to service_role;

-- 5) Yardımcı fonksiyonlar
-- Kategori bu kullanıcıya görünür mü? (yönetime özel kategoriyi yalnızca admin/süpervizör görür)
create function cat_visible(cat int) returns boolean language sql stable security definer set search_path = public as $$
  select my_role() is not null and (
    my_role() in ('admin','supervisor')
    or cat is null
    or not exists (select 1 from categories c where c.id = cat and c.mgr_only)) $$;
revoke execute on function cat_visible(int) from public, anon;
grant execute on function cat_visible(int) to authenticated;

-- Şablondan görev üretilince alt maddeleri kopyala (cron ve istemci aynı yolu kullanır)
create function copy_template_items() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into task_items(task_id, label, assignee, sort)
    select new.id, label, assignee, sort from template_items where template_id = new.template_id;
  return new;
end $$;
revoke execute on function copy_template_items() from public, anon, authenticated;
create trigger tasks_copy_items after insert on tasks for each row when (new.template_id is not null) execute function copy_template_items();

-- 6) Görev koruması: tür değişmez (resepsiyonist), kasa devri kayıt olmadan tamamlanamaz
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
       or new.kind is distinct from old.kind then
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

-- Alt madde koruması: resepsiyonist yalnızca "done" alanını değiştirebilir
create function guard_item_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if my_role() = 'receptionist' and (new.task_id is distinct from old.task_id or new.label is distinct from old.label
     or new.assignee is distinct from old.assignee or new.sort is distinct from old.sort) then
    raise exception 'Resepsiyonistler alt madde bilgilerini değiştiremez.';
  end if;
  return new;
end $$;
revoke execute on function guard_item_update() from public, anon, authenticated;
create trigger task_items_guard before update on task_items for each row execute function guard_item_update();

-- 7) RLS: herkes her görevi görür (yönetime özel kategori hariç)
alter table template_items enable row level security;
alter table task_items enable row level security;
alter table cash_handovers enable row level security;

drop policy tasks_read on tasks;
create policy tasks_read on tasks for select to authenticated using (cat_visible(category_id));

drop policy tasks_update on tasks;
create policy tasks_update on tasks for update to authenticated
  using (cat_visible(category_id) and (
    my_role() in ('admin','supervisor') or assignee = auth.uid()
    or exists (select 1 from task_items i where i.task_id = tasks.id and i.assignee = auth.uid())
    or exists (select 1 from cash_handovers h where h.task_id = tasks.id and (h.giver = auth.uid() or h.receiver = auth.uid()))))
  with check (cat_visible(category_id) and (
    my_role() in ('admin','supervisor') or assignee = auth.uid()
    or exists (select 1 from task_items i where i.task_id = tasks.id and i.assignee = auth.uid())
    or exists (select 1 from cash_handovers h where h.task_id = tasks.id and (h.giver = auth.uid() or h.receiver = auth.uid()))));

create policy "tpl_items_manage" on template_items for all to authenticated
  using (my_role() in ('admin','supervisor')) with check (my_role() in ('admin','supervisor'));

create policy "items_read" on task_items for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_items.task_id));
create policy "items_manage" on task_items for all to authenticated
  using (my_role() in ('admin','supervisor')) with check (my_role() in ('admin','supervisor'));
create policy "items_tick" on task_items for update to authenticated
  using (my_role() is not null and assignee = auth.uid() and exists (select 1 from tasks t where t.id = task_items.task_id))
  with check (assignee = auth.uid());

create policy "cash_read" on cash_handovers for select to authenticated
  using (exists (select 1 from tasks t where t.id = cash_handovers.task_id));
create policy "cash_write" on cash_handovers for insert to authenticated
  with check (my_role() is not null and exists (select 1 from tasks t where t.id = cash_handovers.task_id and t.kind = 'cash_handover')
    and (my_role() in ('admin','supervisor') or giver = auth.uid() or receiver = auth.uid()));
create policy "cash_edit" on cash_handovers for update to authenticated
  using (my_role() in ('admin','supervisor') or giver = auth.uid() or receiver = auth.uid())
  with check (my_role() in ('admin','supervisor') or giver = auth.uid() or receiver = auth.uid());

-- 8) Kasa raporu deposu (özel, yalnızca JPEG, en fazla 2 MB; giriş yapmış aktif herkes görür)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kasa-raporlari', 'kasa-raporlari', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
create policy "kasa_rapor_read" on storage.objects for select to authenticated
  using (bucket_id = 'kasa-raporlari' and my_role() is not null);
create policy "kasa_rapor_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'kasa-raporlari' and my_role() is not null);
create policy "kasa_rapor_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'kasa-raporlari' and my_role() in ('admin','supervisor'));

-- 9) Canlı yenileme
alter publication supabase_realtime add table public.task_items, public.cash_handovers;


-- ===== v8: Grup (BEO) =====

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
revoke execute on function group_wanted(uuid) from public, anon, authenticated;

-- Görevleri üret / güncelle (güvenle tekrar çalıştırılabilir; tamamlanan ve geçmiş görevlere dokunmaz)
create function generate_group_tasks(gid uuid) returns int
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
           ((case when w.shift = 'C' then w.dt + 1 else w.dt end)::timestamp + (case w.shift when 'A' then time '16:00' when 'B' then time '23:59' else time '08:00' end)) at time zone 'Europe/Nicosia', -- C: ertesi sabah 08:00
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
