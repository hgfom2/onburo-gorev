-- v15: Resepsiyonistin girdiği talep/takip görevi kimseye atanamaz (herkes görür, "Atanmamış" sekmesinde çıkmaz).
drop policy tasks_insert on tasks;
create policy tasks_insert on tasks for insert to authenticated with check (
  my_role() in ('admin','supervisor')
  or (my_role() = 'receptionist'
      and category_id = (select id from categories where name = 'Misafir&Takip')
      and kind = 'normal' and status = 'open'
      and template_id is null and group_id is null and rule_id is null
      and created_by = auth.uid()
      and assignee is null));
