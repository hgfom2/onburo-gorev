-- Supabase > SQL Editor'de calistirin.
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  email text,
  role text not null default 'receptionist' check (role in ('admin','supervisor','receptionist')),
  active boolean not null default true
);
create table categories (id serial primary key, name text not null unique);
insert into categories(name) values ('Operasyon'),('Misafir İlişkileri'),('Kasa ve Fatura'),('İdari');

create table templates (
  id uuid primary key default gen_random_uuid(),
  title text not null, description text,
  category_id int references categories(id),
  shift text not null check (shift in ('A','B','C')),
  assignee uuid references profiles(id),
  recurrence text not null check (recurrence in ('daily','weekly')),
  weekdays int[] not null default '{1,2,3,4,5,6,7}',  -- 1=Pzt ... 7=Paz
  active boolean not null default true
);
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null, description text,
  category_id int references categories(id),
  shift text not null check (shift in ('A','B','C')),
  assignee uuid references profiles(id),
  due_date date not null,
  status text not null default 'open' check (status in ('open','done')),
  completed_at timestamptz,
  template_id uuid references templates(id) on delete set null,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (template_id, due_date)
);
create index on tasks (due_date, shift);
create index on tasks (assignee, due_date);

-- Yeni kullanici eklenince profil olustur
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, email, full_name) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create function my_role() returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active $$;

alter table profiles enable row level security;
alter table categories enable row level security;
alter table templates enable row level security;
alter table tasks enable row level security;

create policy "profiles_read" on profiles for select to authenticated using (true);
create policy "profiles_admin" on profiles for update to authenticated using (my_role()='admin');
create policy "cat_read" on categories for select to authenticated using (true);
create policy "cat_admin" on categories for all to authenticated using (my_role()='admin') with check (my_role()='admin');
create policy "tpl_manage" on templates for all to authenticated
  using (my_role() in ('admin','supervisor')) with check (my_role() in ('admin','supervisor'));
create policy "tasks_read" on tasks for select to authenticated
  using (my_role() in ('admin','supervisor') or assignee = auth.uid());
create policy "tasks_insert" on tasks for insert to authenticated with check (my_role() in ('admin','supervisor'));
create policy "tasks_update" on tasks for update to authenticated
  using (my_role() in ('admin','supervisor') or assignee = auth.uid());
create policy "tasks_delete" on tasks for delete to authenticated using (my_role() in ('admin','supervisor'));

-- ILK ADMIN: kullaniciyi Authentication > Users'tan ekledikten sonra:
-- update profiles set role='admin', full_name='Adiniz Soyadiniz' where email='sizin@mailiniz.com';
