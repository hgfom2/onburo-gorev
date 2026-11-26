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
