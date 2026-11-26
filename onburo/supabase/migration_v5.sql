-- v5: e-posta ve hatırlatma e-postası yalnızca sunucu (service role) tarafından okunabilir.
-- UYGULAMA SIRASI: önce yeni kod deploy edilmeli (select('*') kullanan eski sürüm bundan sonra hata verir).
-- Realtime (v4) zaten uygulandı: alter publication supabase_realtime add table public.tasks, public.task_notes;

revoke select on public.profiles from anon, authenticated;
grant select (id, full_name, username, role, active) on public.profiles to authenticated;
