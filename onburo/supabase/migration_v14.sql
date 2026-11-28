-- v14: Resepsiyonist talep / takip görevi girebilir (yalnızca "Misafir&Takip" kategorisi).
-- Kategori adı "Misafir İlişkileri" -> "Misafir&Takip". Resepsiyonist: başkasına değil yalnızca yönetici/süpervizöre atayabilir
-- veya atamasız bırakır; şablon/grup/kasa devri türünde görev giremez; kendi girdiği görevi iptal edebilir.
update categories set name = 'Misafir&Takip' where name = 'Misafir İlişkileri';

drop policy tasks_insert on tasks;
create policy tasks_insert on tasks for insert to authenticated with check (
  my_role() in ('admin','supervisor')
  or (my_role() = 'receptionist'
      and category_id = (select id from categories where name = 'Misafir&Takip')
      and kind = 'normal' and status = 'open'
      and template_id is null and group_id is null and rule_id is null
      and created_by = auth.uid()
      and (assignee is null or exists (select 1 from profiles p where p.id = assignee and p.active and p.role in ('admin','supervisor')))));

drop policy tasks_update on tasks;
create policy tasks_update on tasks for update to authenticated
  using (cat_visible(category_id) and (
    my_role() in ('admin','supervisor') or assignee = auth.uid() or created_by = auth.uid()
    or exists (select 1 from task_items i where i.task_id = tasks.id and i.assignee = auth.uid())
    or exists (select 1 from cash_handovers h where h.task_id = tasks.id and (h.giver = auth.uid() or h.receiver = auth.uid()))))
  with check (cat_visible(category_id) and (
    my_role() in ('admin','supervisor') or assignee = auth.uid() or created_by = auth.uid()
    or exists (select 1 from task_items i where i.task_id = tasks.id and i.assignee = auth.uid())
    or exists (select 1 from cash_handovers h where h.task_id = tasks.id and (h.giver = auth.uid() or h.receiver = auth.uid()))));
