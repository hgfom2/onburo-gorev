# Önbüro Görevler v2 — Güncelleme adımları

## 1) Veritabanı (Supabase → SQL Editor)
`supabase/migration_v2.sql` dosyasının içeriğini yapıştırıp **bir kez** çalıştırın.
(Yeni alanlar eklenir, "Kasa ve Fatura" kategorisi kaldırılır; o kategorideki görevler "Operasyon"a taşınır.)

## 2) Vercel ortam değişkeni (YENİ)
Settings → Environment Variables → `PIN_PEPPER` ekleyin: uzun, rastgele bir metin (en az 16 karakter, boşluksuz).
- Bu değer PIN'lerin güvenliği için kullanılır. Sonradan DEĞİŞTİRMEYİN; değişirse tüm PIN'ler geçersiz olur.
- `SUPABASE_SERVICE_ROLE_KEY` zaten tanımlı olmalı (kullanıcı ekleme için gerekli).

## 3) Dosyaları GitHub'a yükleyin
Zip'teki tüm dosyaları aynı yerlerine yükleyin (aynı isimli dosyaların üzerine yazılır):
- `app/page.js`, `app/globals.css` (değişti)
- `app/api/cron/route.js` (değişti)
- `app/api/login/route.js`, `app/api/users/route.js`, `lib/util.js` (yeni)
- `supabase/migration_v2.sql` (yeni, sadece bilgi için)
Vercel otomatik yeniden deploy eder. Deploy bittikten sonra **Redeploy** gerekmez, ama PIN_PEPPER'ı deploy'dan sonra eklediyseniz bir kez Redeploy edin.

## 4) İlk giriş ve kullanıcılar
1. Giriş ekranının altındaki **"E-posta ile giriş (ilk yönetici)"** bağlantısıyla şimdiki hesabınızla girin.
2. **Kullanıcılar** sekmesinde kendi satırınızda **Düzenle** → kullanıcı adı ve PIN belirleyin → Kaydet.
   Bundan sonra kullanıcı adı + PIN ile girebilirsiniz.
3. Diğer personeli aynı sekmeden ekleyin (isim, kullanıcı adı, PIN, rol).
   Kullanıcı adı: küçük harf (a-z), rakam, nokta, tire, alt çizgi; Türkçe karakter ve boşluk yok.

## Hatırlatmalar
- Uygulama içinde: Görevlerim ekranının üstünde "X görev gecikti / Y görev 2 saat içinde bitiyor" uyarısı çıkar.
- E-posta: kullanıcıya isteğe bağlı "hatırlatma e-postası" girilirse her sabah 07:00'de özet gider (Resend gerekir).
