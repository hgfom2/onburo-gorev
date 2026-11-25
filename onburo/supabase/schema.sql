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
