-- v9: Giriş denemesi sınırı (PIN kaba kuvvet koruması). Yalnızca sunucu (service_role) erişir.
-- UYGULAMA SIRASI: önce bu SQL, sonra kod. Eski kod bu tabloyu kullanmaz.
create table login_attempts (
  id bigint generated always as identity primary key,
  key text not null,                       -- 'u:<kullanıcı>' veya 'ip:<adres>'
  at timestamptz not null default now()
);
create index on login_attempts (key, at);
alter table login_attempts enable row level security;   -- politika yok: istemci erişemez
revoke all on login_attempts from anon, authenticated;
grant all on login_attempts to service_role;
