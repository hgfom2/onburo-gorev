-- v3: pasif kullanıcı erişimi, görev koruma tetikleyicisi, RPC yetkileri.
-- Supabase'e zaten uygulandı (2026-11-25); yeni kurulumlarda schema.sql yeterlidir.

alter policy tasks_read on public.tasks
  using (my_role() is not null and (my_role() in ('admin','supervisor') or assignee = auth.uid()));
alter policy tasks_update on public.tasks
  using (my_role() is not null and (my_role() in ('admin','supervisor') or assignee = auth.uid()))
  with check (my_role() is not null and (my_role() in ('admin','supervisor') or assignee = auth.uid()));
alter policy notes_insert on public.task_notes
  with check (my_role() is not null and author = auth.uid() and exists (
    select 1 from public.tasks t where t.id = task_notes.task_id
      and (t.assignee = auth.uid() or my_role() in ('admin','supervisor'))));

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
       or new.due_at is distinct from old.due_at or new.template_id is distinct from old.template_id then
      raise exception 'Resepsiyonistler görev bilgilerini değiştiremez.';
    end if;
    if old.status = 'cancelled' and new.status is distinct from old.status then
      raise exception 'İptal edilen görevi yalnızca yönetici veya süpervizör yeniden açabilir.';
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.guard_task_update(), public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;
