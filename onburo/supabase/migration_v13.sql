-- v13: Devir notları (vardiyadan vardiyaya) ve denetim kaydı (yalnızca admin okur).
-- UYGULAMA SIRASI: önce bu SQL, sonra kod. Eski kod bu tabloları kullanmaz.
create table handover_notes (
  id uuid primary key default gen_random_uuid(),
  from_shift text not null check (from_shift in ('A','B','C')),
  body text not null check (length(trim(body)) > 0 and length(body) <= 2000),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on handover_notes (created_at desc);
revoke all on handover_notes from anon;
grant select, insert, delete on handover_notes to authenticated;
grant all on handover_notes to service_role;
alter table handover_notes enable row level security;
create policy "notes_read" on handover_notes for select to authenticated using (my_role() is not null);
create policy "notes_insert" on handover_notes for insert to authenticated with check (my_role() is not null and created_by = auth.uid());
create policy "notes_delete" on handover_notes for delete to authenticated
  using (my_role() is not null and (created_by = auth.uid() or my_role() in ('admin','supervisor')));
alter publication supabase_realtime add table public.handover_notes;

-- Denetim kaydı: tetikleyicilerle otomatik yazılır; istemci yalnızca (admin) okuyabilir, yazamaz/silemez
create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_name text,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  table_name text not null,
  row_id uuid,
  label text,
  details jsonb      -- UPDATE: {alan: [eski, yeni]}; INSERT/DELETE: satırın özeti
);
create index on audit_log (at desc);
create index on audit_log (table_name, at desc);
revoke all on audit_log from anon, authenticated;
grant select on audit_log to authenticated;
grant all on audit_log to service_role;
alter table audit_log enable row level security;
create policy "audit_read" on audit_log for select to authenticated using (my_role() = 'admin');

create function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; d jsonb; src jsonb; k text; rid uuid; nm text; lbl text; tt text;
  skip text[] := array['completed_at','cancelled_at','cancelled_by','created_at','created_by','email','notify_email','report_path'];
begin
  o := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  src := coalesce(n, o);
  if tg_op = 'UPDATE' then
    d := '{}'::jsonb;
    for k in select jsonb_object_keys(n) loop
      if k <> all(skip) and (n -> k) is distinct from (o -> k) then
        d := d || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      end if;
    end loop;
    if d = '{}'::jsonb then return null; end if;
  else
    d := src - skip;
  end if;
  begin rid := coalesce(src ->> 'id', src ->> 'task_id')::uuid; exception when others then rid := null; end;
  lbl := coalesce(src ->> 'title', src ->> 'name', src ->> 'label', src ->> 'full_name');
  if tg_table_name in ('task_items','cash_handovers') then
    select title into tt from tasks where id = (src ->> 'task_id')::uuid;
    lbl := coalesce(lbl || ' — ', '') || coalesce(tt, '');
  end if;
  select full_name into nm from profiles where id = auth.uid();
  insert into audit_log(actor, actor_name, action, table_name, row_id, label, details)
    values (auth.uid(), nm, tg_op, tg_table_name, rid, lbl, d);
  return null;
end $$;
revoke execute on function audit_row() from public, anon, authenticated;

-- Şablondan / gruptan üretilen görevlerin eklenmesi ve silinmesi kaydedilmez (gürültü); durum değişiklikleri kaydedilir
create trigger audit_tasks_ins after insert on tasks for each row when (new.template_id is null and new.group_id is null) execute function audit_row();
create trigger audit_tasks_upd after update on tasks for each row execute function audit_row();
create trigger audit_tasks_del after delete on tasks for each row when (old.template_id is null and old.group_id is null) execute function audit_row();
create trigger audit_templates after insert or update or delete on templates for each row execute function audit_row();
create trigger audit_profiles after insert or update or delete on profiles for each row execute function audit_row();
create trigger audit_groups after insert or update or delete on beo_groups for each row execute function audit_row();
create trigger audit_rules after insert or update or delete on group_rules for each row execute function audit_row();
create trigger audit_items after update on task_items for each row execute function audit_row();
create trigger audit_cash after insert or update on cash_handovers for each row execute function audit_row();
