-- v12: Alt maddeler bitmeden ana görev tamamlanamaz; tüm maddeler bitince görev kendiliğinden tamamlanır (madde geri alınırsa görev yeniden açılır).
-- Resepsiyonistler (ve tüm aktif kullanıcılar) kendisine atanmamış olsa bile alt maddeyi işaretleyebilir; madde bilgisi değiştirme yine yönetime özel.
drop policy items_tick on task_items;
create policy items_tick on task_items for update to authenticated
  using (my_role() is not null and exists (select 1 from tasks t where t.id = task_items.task_id))
  with check (my_role() is not null);

create or replace function public.guard_task_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and my_role() is null then raise exception 'Hesap pasif.'; end if;
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
  if new.status = 'done' and old.status is distinct from 'done'
     and exists (select 1 from task_items i where i.task_id = new.id and not i.done) then
    raise exception 'Önce tüm alt maddeler tamamlanmalı.';
  end if;
  if new.kind = 'cash_handover' and new.status = 'done' and old.status is distinct from 'done'
     and not exists (select 1 from cash_handovers h where h.task_id = new.id) then
    raise exception 'Kasa devri için devreden, alan ve kasa raporu girilmeli.';
  end if;
  return new;
end $$;

create function sync_task_from_items() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.done is not distinct from old.done then return new; end if;
  if new.done then
    if not exists (select 1 from task_items where task_id = new.task_id and not done) then
      update tasks set status = 'done', completed_at = now() where id = new.task_id and status = 'open' and kind = 'normal';
    end if;
  else
    update tasks set status = 'open', completed_at = null where id = new.task_id and status = 'done' and kind = 'normal';
  end if;
  return new;
end $$;
revoke execute on function sync_task_from_items() from public, anon, authenticated;
create trigger task_items_sync after update of done on task_items for each row execute function sync_task_from_items();
