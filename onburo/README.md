# Önbüro Görevler — Kurulum (yaklaşık 30-45 dk)

## 1) Supabase
1. supabase.com → New project (bölge: Frankfurt/Avrupa).
2. SQL Editor → `supabase/schema.sql` içeriğini yapıştırıp çalıştırın.
3. Authentication → Users → "Add user" ile 15 kullanıcıyı e-posta + şifre ile ekleyin (Auto Confirm işaretli).
   Authentication → Providers → Email: "Confirm email" kapalı olsun, "Allow new users to sign up" kapalı olsun (herkes kayıt olamasın).
4. SQL Editor'de kendinizi admin yapın:
   `update profiles set role='admin', full_name='Adınız Soyadınız' where email='sizin@mail.com';`
   Diğerleri için: `update profiles set role='supervisor', full_name='...' where email='...';`
   (Rol verilmeyenler resepsiyonist olur.)
5. Project Settings → API: URL, anon key ve service_role key'i not alın.

## 2) Vercel
1. Bu klasörü GitHub'a yükleyin → vercel.com → Add New Project → repoyu seçin.
2. Environment Variables: `.env.example` içindeki değişkenleri girin.
   `CRON_SECRET` için uzun rastgele bir metin yazın (Vercel cron isteğine otomatik ekler).
3. Deploy. Her gün 07:00 (Türkiye saati) tekrarlayan görevler üretilir ve hatırlatma e-postası gider (`vercel.json`).

## E-posta hatırlatma (isteğe bağlı)
resend.com ücretsiz hesap → API key → `RESEND_API_KEY`.
Not: kendi alan adınızı doğrulamadan Resend sadece kendi adresinize gönderir; personele göndermek için alan adı doğrulayın.

## Notlar
- Resepsiyonist yalnızca kendine atanan görevleri görür; süpervizör ve yönetici tüm görevleri görür.
- Ücretsiz Supabase planı 7 gün hiç kullanılmazsa projeyi duraklatır; otomatik yedek yoktur, ayda bir dışa aktarın.
- Cron "Hobby" planda günde 1 kez çalışır, bu uygulama için yeterlidir.
