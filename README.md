# OtoKay-T — Oto / Motosiklet Servis Yönetim Uygulaması

Google Apps Script Web App (HTML Service) tabanlı, **Google Sheets'i veritabanı**
olarak kullanan servis yönetim uygulaması. Müşteri/araç kaydı, iş emri açma,
kalem kalem işçilik + parça girişi, otomatik KDV/toplam hesabı, araç geçmişi ve
müşteriye gösterilebilen yazdırılabilir / WhatsApp'a gönderilebilir özet.

## Özellikler

- **Müşteri** ekle / düzenle / sil (silme = pasifleştirme, geçmiş korunur).
- **Araç** ekle (müşteriye bağlı, otomobil/motosiklet), plaka otomatik büyük harf.
- **Arama:** plaka, müşteri adı veya telefona göre — üstteki tek kutudan.
- **İş emri (servis kaydı):** durum takibi (Beklemede / Devam Ediyor / Tamamlandı / Teslim Edildi).
- **İşçilik + Parça** kalemleri ekle/sil; toplam ve KDV otomatik hesaplanır.
- **KDV:** her iş emrinde oran ayarlanabilir + "fiyatlara KDV dahil mi?" seçilebilir.
  Varsayılan oran Ayarlar'dan değiştirilir (varsayılan %20).
- **Araç geçmişi:** o araca açılmış tüm iş emirleri, tarih + tutar; tıkla → tüm kalemleri gör.
  Ayrıca "ömür boyu toplam" satırı.
- **Müşteri özeti:** temiz ekran → **🖨️ Yazdır** ve **🟢 WhatsApp** (wa.me linki, müşteri numarasıyla).

## Veritabanı Yapısı (Sheets)

| Sayfa | Kolonlar |
|---|---|
| `Musteriler` | MusteriID, Ad Soyad, Telefon, Notlar, Kayit Tarihi, Aktif |
| `Araclar` | AracID, MusteriID, Plaka, Tur, Marka, Model, Yil, Sasi/Notlar, Aktif |
| `ServisKayitlari` | ServisID, AracID, ServisNo, Tarih, Durum, Genel Not, Iscilik Toplam, Parca Toplam, KDV Orani, KDV Dahil, KDV Tutar, Genel Toplam |
| `Iscilikler` | KalemID, ServisID, Aciklama, Tutar |
| `Parcalar` | KalemID, ServisID, Parca Adi, Adet, Birim Fiyat, Tutar |
| `Ayarlar` | Anahtar, Deger |

> Not: Spec'teki şemaya göre `ServisKayitlari` sayfasına 3 kolon eklendi —
> `ServisNo` (müşteriye gösterilen okunabilir iş emri no, ör. `2026-0001`),
> `KDV Orani` ve `KDV Dahil` (her iş emri için ayrı KDV davranışı), `KDV Tutar`.
> Soft-delete için `Musteriler`/`Araclar` sayfalarına `Aktif` kolonu eklendi.

## Kurulum

### Yöntem A — Tarayıcıdan (clasp olmadan)

1. [sheets.new](https://sheets.new) ile yeni bir Google E-Tablo oluşturun.
2. **Uzantılar → Apps Script**.
3. Editörde:
   - `Kod.gs` içeriğini silip `Code.gs` dosyasının içeriğini yapıştırın.
   - **+ → HTML** ile şu dosyaları aynı adla oluşturup içeriklerini yapıştırın:
     `Index`, `Stylesheet`, `JavaScript` (uzantısız; editör `.html` ekler).
   - **Proje Ayarları → "appsscript.json" göster** seçeneğini açın, içeriğini
     `appsscript.json` ile değiştirin.
4. Üstteki fonksiyon seçicisinden **`setupSpreadsheet`** seçip **Çalıştır**.
   İlk çalıştırmada yetki isteyecek — onaylayın. Bu işlem tüm sayfaları ve
   varsayılan ayarları oluşturur.
5. **Dağıt → Yeni dağıtım → Tür: Web uygulaması.**
   - "Yürüten": **Ben**
   - "Erişim": **Yalnızca ben**
6. Verilen Web App URL'sini açın. Bitti.

### Yöntem B — clasp ile (bu repodan)

```bash
npm install -g @google/clasp
clasp login
clasp create --type sheets --title "OtoKay-T"   # veya mevcut script'e: clasp clone <scriptId>
clasp push
```
Ardından Apps Script'te `setupSpreadsheet` çalıştırıp Web App olarak dağıtın.

## Performans Notları

- Her sayfa **tek seferde** `getDataRange().getValues()` ile okunur; işleme JS'te yapılır.
- Yazma `setValues()` / `appendRow()` ile toplu; gereksiz `flush()` yok.
- Ayarlar ve açılış özeti **CacheService** ile 5 dk önbelleğe alınır.
- Açılışta yalnızca özet yüklenir; servis detayları kullanıcı tıklayınca gelir (**lazy load**).
- Müşteri listesinde **arama + sayfalama**; arama sonuçları 50 ile sınırlıdır.
- Tüm yazma işlemleri **LockService** kilidi altında (ID çakışması / eşzamanlılık koruması).

## Dosyalar

- `Code.gs` — sunucu tarafı (Sheets erişimi, hesaplama, API).
- `Index.html` — HTML iskeleti (CSS/JS dahil edilir).
- `Stylesheet.html` — stiller (responsive + yazdırma).
- `JavaScript.html` — istemci tarafı uygulama mantığı.
- `appsscript.json` — manifest (Web App yetkileri, saat dilimi).
