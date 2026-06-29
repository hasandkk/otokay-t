/**
 * OtoKay-T — Oto / Motosiklet Servis Yönetim Uygulaması
 * Google Apps Script Web App (HTML Service) + Google Sheets (veritabanı)
 *
 * MİMARİ / PERFORMANS NOTLARI
 * - Her sayfa TEK SEFERDE getDataRange().getValues() ile okunur, JS tarafında işlenir.
 * - Yazma işlemleri setValues() ile toplu yapılır; gereksiz flush() çağrılmaz.
 * - Sık okunan listeler (müşteri/araç özeti, ayarlar) CacheService ile önbelleğe alınır.
 * - Yazma işlemlerinde LockService ile ID çakışması ve eşzamanlılık sorunları engellenir.
 * - Açılışta sadece özet veri yüklenir; servis detayları kullanıcı tıklayınca getirilir (lazy load).
 */

/* =========================================================================
 * SABİTLER
 * ========================================================================= */
var SHEETS = {
  MUSTERILER: 'Musteriler',
  ARACLAR: 'Araclar',
  SERVISLER: 'ServisKayitlari',
  ISCILIKLER: 'Iscilikler',
  PARCALAR: 'Parcalar',
  AYARLAR: 'Ayarlar'
};

var HEADERS = {
  Musteriler: ['MusteriID', 'Ad Soyad', 'Telefon', 'Notlar', 'Kayit Tarihi', 'Aktif'],
  Araclar: ['AracID', 'MusteriID', 'Plaka', 'Tur', 'Marka', 'Model', 'Yil', 'Sasi/Notlar', 'Aktif'],
  ServisKayitlari: ['ServisID', 'AracID', 'ServisNo', 'Tarih', 'Durum', 'Genel Not',
                    'Iscilik Toplam', 'Parca Toplam', 'KDV Orani', 'KDV Dahil',
                    'KDV Tutar', 'Genel Toplam'],
  Iscilikler: ['KalemID', 'ServisID', 'Aciklama', 'Tutar'],
  Parcalar: ['KalemID', 'ServisID', 'Parca Adi', 'Adet', 'Birim Fiyat', 'Tutar'],
  Ayarlar: ['Anahtar', 'Deger']
};

var DURUMLAR = ['Beklemede', 'Devam Ediyor', 'Tamamlandi', 'Teslim Edildi'];
var CACHE_TTL = 300; // saniye (5 dk)

/* =========================================================================
 * WEB APP GİRİŞ NOKTASI
 * ========================================================================= */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Teminat Group Servis')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Index.html içinden CSS / JS parçalarını dahil etmek için. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* =========================================================================
 * ALTYAPI YARDIMCILARI
 * ========================================================================= */

/** Verinin yazılacağı spreadsheet'i döndürür (script property SHEET_ID veya aktif dosya). */
function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('Spreadsheet bulunamadı. setupSpreadsheet() çalıştırın veya SHEET_ID ayarlayın.');
}

function getSheet_(name) {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Sayfa bulunamadı: ' + name + ' — setupSpreadsheet() çalıştırın.');
  return sh;
}

/** Bir sayfayı tek seferde okuyup, başlıklara göre nesne dizisine çevirir. */
function readObjects_(name) {
  var values = getSheet_(name).getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.join('') === '') continue; // boş satırı atla
    var obj = { _row: r + 1 };
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = row[c];
    out.push(obj);
  }
  return out;
}

/** Nesneyi sayfa başlık sırasına göre satır dizisine çevirir. */
function objToRow_(name, obj) {
  return HEADERS[name].map(function (h) {
    return obj[h] !== undefined && obj[h] !== null ? obj[h] : '';
  });
}

/** Bir satırı sayfanın sonuna toplu ekler. */
function appendRow_(name, obj) {
  var sh = getSheet_(name);
  sh.appendRow(objToRow_(name, obj));
}

/** Benzersiz ID üretir. */
function newId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

function cache_() { return CacheService.getScriptCache(); }

function clearCache_() {
  cache_().removeAll(['summary', 'settings']);
}

/** Tüm yazma işlemleri bu kilit altında çalışır. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function nowIso_() {
  return Utilities.formatDate(new Date(), 'Europe/Istanbul', 'yyyy-MM-dd HH:mm');
}

function num_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function round2_(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/* =========================================================================
 * KURULUM — Bir kez çalıştırılır (Apps Script editöründen)
 * ========================================================================= */
function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    ss = SpreadsheetApp.create('OtoKay-T Servis Veritabanı');
    PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  }
  Object.keys(SHEETS).forEach(function (key) {
    var name = SHEETS[key];
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    // Başlıkları yaz (yoksa)
    var firstRow = sh.getRange(1, 1, 1, HEADERS[name].length).getValues()[0];
    if (firstRow.join('') === '') {
      sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
    }
  });
  // Varsayılan Sheet1'i sil
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Sayfa1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  // Varsayılan ayarlar
  var ayarSh = ss.getSheetByName(SHEETS.AYARLAR);
  if (ayarSh.getLastRow() < 2) {
    ayarSh.getRange(2, 1, 6, 2).setValues([
      ['kdvOrani', 20],
      ['firmaAdi', 'Teminat Group'],
      ['firmaTelefon', ''],
      ['firmaAdres', ''],
      ['tema', 'dark'],
      ['sonServisNo', 0]
    ]);
  }
  clearCache_();
  return 'Kurulum tamam: ' + ss.getUrl();
}

/* =========================================================================
 * AYARLAR
 * ========================================================================= */
function getSettings() {
  var cached = cache_().get('settings');
  if (cached) return JSON.parse(cached);
  var rows = readObjects_(SHEETS.AYARLAR);
  var s = {};
  rows.forEach(function (r) { s[r['Anahtar']] = r['Deger']; });
  var out = {
    kdvOrani: num_(s.kdvOrani) || 20,
    firmaAdi: s.firmaAdi || 'Teminat Group',
    firmaTelefon: s.firmaTelefon || '',
    firmaAdres: s.firmaAdres || '',
    tema: s.tema || 'dark'
  };
  cache_().put('settings', JSON.stringify(out), CACHE_TTL);
  return out;
}

/** Sadece tema tercihini günceller (diğer ayarlara dokunmaz). */
function setTheme(tema) {
  return withLock_(function () {
    setSettingValue_('tema', tema === 'light' ? 'light' : 'dark');
    clearCache_();
    return tema;
  });
}

/** Ayarlar sayfasında tek bir anahtarı günceller / ekler. */
function setSettingValue_(key, value) {
  var sh = getSheet_(SHEETS.AYARLAR);
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === key) { sh.getRange(r + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value]);
}

function saveSettings(data) {
  return withLock_(function () {
    var sh = getSheet_(SHEETS.AYARLAR);
    var values = sh.getDataRange().getValues();
    var map = {};
    for (var r = 1; r < values.length; r++) map[values[r][0]] = r + 1; // anahtar -> satır no
    var toSet = {
      kdvOrani: num_(data.kdvOrani),
      firmaAdi: data.firmaAdi || '',
      firmaTelefon: data.firmaTelefon || '',
      firmaAdres: data.firmaAdres || ''
    };
    Object.keys(toSet).forEach(function (k) {
      if (map[k]) {
        sh.getRange(map[k], 2).setValue(toSet[k]);
      } else {
        sh.appendRow([k, toSet[k]]);
      }
    });
    clearCache_();
    return getSettings();
  });
}

/* =========================================================================
 * AÇILIŞ VERİSİ (özet, önbellekli)
 * ========================================================================= */
function getBootstrapData() {
  var url = '';
  try { url = getSpreadsheet_().getUrl(); } catch (e) {}
  return {
    settings: getSettings(),
    durumlar: DURUMLAR,
    stats: getStats_(),
    sheetUrl: url
  };
}

function getStats_() {
  var servisler = readObjects_(SHEETS.SERVISLER);
  var araclar = readObjects_(SHEETS.ARACLAR).filter(aktif_);
  var musteriler = readObjects_(SHEETS.MUSTERILER).filter(aktif_);
  var acik = servisler.filter(function (s) {
    return s['Durum'] !== 'Teslim Edildi';
  }).length;
  return {
    musteriSayisi: musteriler.length,
    aracSayisi: araclar.length,
    acikServis: acik,
    toplamServis: servisler.length
  };
}

function aktif_(o) {
  return o['Aktif'] === '' || o['Aktif'] === true || o['Aktif'] === 'TRUE' || o['Aktif'] === 1 || o['Aktif'] === undefined;
}

/* =========================================================================
 * RAPORLAR — Tüm iş emirleri (filtre + özet)
 * ========================================================================= */
/**
 * filters: { q, durum, baslangic ('yyyy-MM-dd'), bitis, acik (bool), page, pageSize }
 * Tek seferde tüm sayfaları okur, JS'te birleştirir ve filtreler.
 */
function getAllServices(filters) {
  filters = filters || {};
  var page = filters.page || 1;
  var pageSize = filters.pageSize || 25;
  var q = ('' + (filters.q || '')).toLowerCase().trim();
  var qPlaka = q.replace(/\s+/g, '');

  var araclar = readObjects_(SHEETS.ARACLAR);
  var aMap = {};
  araclar.forEach(function (a) { aMap[a['AracID']] = a; });
  var musteriler = readObjects_(SHEETS.MUSTERILER);
  var mMap = {};
  musteriler.forEach(function (m) { mMap[m['MusteriID']] = m; });

  var rows = readObjects_(SHEETS.SERVISLER).map(function (s) {
    var a = aMap[s['AracID']] || {};
    var m = mMap[a['MusteriID']] || {};
    return {
      ServisID: s['ServisID'],
      AracID: s['AracID'],
      ServisNo: s['ServisNo'],
      Tarih: '' + s['Tarih'],
      Durum: s['Durum'],
      Plaka: a['Plaka'] || '',
      Tur: a['Tur'] || '',
      Marka: a['Marka'] || '',
      Model: a['Model'] || '',
      MusteriAdi: m['Ad Soyad'] || '',
      Telefon: m['Telefon'] || '',
      GenelToplam: num_(s['Genel Toplam']),
      KdvTutar: num_(s['KDV Tutar'])
    };
  });

  // Filtreler
  if (filters.durum) rows = rows.filter(function (r) { return r.Durum === filters.durum; });
  if (filters.acik) rows = rows.filter(function (r) { return r.Durum !== 'Teslim Edildi'; });
  if (filters.baslangic) rows = rows.filter(function (r) { return r.Tarih.substring(0, 10) >= filters.baslangic; });
  if (filters.bitis) rows = rows.filter(function (r) { return r.Tarih.substring(0, 10) <= filters.bitis; });
  if (q) {
    rows = rows.filter(function (r) {
      return r.Plaka.toLowerCase().replace(/\s+/g, '').indexOf(qPlaka) > -1 ||
        r.MusteriAdi.toLowerCase().indexOf(q) > -1 ||
        ('' + r.ServisNo).toLowerCase().indexOf(q) > -1 ||
        ('' + r.Telefon).toLowerCase().indexOf(q) > -1;
    });
  }

  rows.sort(function (a, b) { return ('' + b.Tarih).localeCompare('' + a.Tarih); });

  // Özet (filtrelenmiş tüm set üzerinden)
  var ozet = {
    adet: rows.length,
    toplamCiro: 0,
    toplamKdv: 0,
    durumSayilari: { 'Beklemede': 0, 'Devam Ediyor': 0, 'Tamamlandi': 0, 'Teslim Edildi': 0 }
  };
  rows.forEach(function (r) {
    ozet.toplamCiro += r.GenelToplam;
    ozet.toplamKdv += r.KdvTutar;
    if (ozet.durumSayilari[r.Durum] !== undefined) ozet.durumSayilari[r.Durum]++;
  });
  ozet.toplamCiro = round2_(ozet.toplamCiro);
  ozet.toplamKdv = round2_(ozet.toplamKdv);

  var total = rows.length;
  var start = (page - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    total: total,
    page: page,
    pageSize: pageSize,
    ozet: ozet
  };
}

/* =========================================================================
 * MÜŞTERİLER
 * ========================================================================= */
function getCustomers(query, page, pageSize) {
  page = page || 1;
  pageSize = pageSize || 20;
  var q = (query || '').toString().toLowerCase().trim();
  var rows = readObjects_(SHEETS.MUSTERILER).filter(aktif_);
  if (q) {
    rows = rows.filter(function (m) {
      return (m['Ad Soyad'] + '' + m['Telefon']).toLowerCase().indexOf(q) > -1;
    });
  }
  rows.sort(function (a, b) {
    return ('' + b['Kayit Tarihi']).localeCompare('' + a['Kayit Tarihi']);
  });
  var total = rows.length;
  var start = (page - 1) * pageSize;
  var pageRows = rows.slice(start, start + pageSize).map(function (m) {
    return {
      MusteriID: m['MusteriID'],
      AdSoyad: m['Ad Soyad'],
      Telefon: m['Telefon'],
      Notlar: m['Notlar'],
      KayitTarihi: '' + m['Kayit Tarihi']
    };
  });
  return { items: pageRows, total: total, page: page, pageSize: pageSize };
}

function saveCustomer(data) {
  return withLock_(function () {
    if (data.MusteriID) {
      var sh = getSheet_(SHEETS.MUSTERILER);
      var rows = readObjects_(SHEETS.MUSTERILER);
      var hit = rows.filter(function (m) { return m['MusteriID'] === data.MusteriID; })[0];
      if (!hit) throw new Error('Müşteri bulunamadı.');
      sh.getRange(hit._row, 2, 1, 3).setValues([[data.AdSoyad, data.Telefon, data.Notlar || '']]);
    } else {
      data.MusteriID = newId_('M');
      appendRow_(SHEETS.MUSTERILER, {
        'MusteriID': data.MusteriID,
        'Ad Soyad': data.AdSoyad,
        'Telefon': data.Telefon,
        'Notlar': data.Notlar || '',
        'Kayit Tarihi': nowIso_(),
        'Aktif': true
      });
    }
    clearCache_();
    return data.MusteriID;
  });
}

function deleteCustomer(musteriId) {
  return withLock_(function () {
    var sh = getSheet_(SHEETS.MUSTERILER);
    var rows = readObjects_(SHEETS.MUSTERILER);
    var hit = rows.filter(function (m) { return m['MusteriID'] === musteriId; })[0];
    if (!hit) throw new Error('Müşteri bulunamadı.');
    sh.getRange(hit._row, HEADERS.Musteriler.indexOf('Aktif') + 1).setValue(false); // soft delete
    clearCache_();
    return true;
  });
}

/* =========================================================================
 * ARAÇLAR
 * ========================================================================= */
function getCustomerWithVehicles(musteriId) {
  var musteri = readObjects_(SHEETS.MUSTERILER).filter(function (m) {
    return m['MusteriID'] === musteriId;
  })[0];
  if (!musteri) throw new Error('Müşteri bulunamadı.');
  var araclar = readObjects_(SHEETS.ARACLAR).filter(function (a) {
    return a['MusteriID'] === musteriId && aktif_(a);
  });
  return {
    musteri: {
      MusteriID: musteri['MusteriID'],
      AdSoyad: musteri['Ad Soyad'],
      Telefon: musteri['Telefon'],
      Notlar: musteri['Notlar']
    },
    araclar: araclar.map(mapArac_)
  };
}

function mapArac_(a) {
  return {
    AracID: a['AracID'],
    MusteriID: a['MusteriID'],
    Plaka: a['Plaka'],
    Tur: a['Tur'],
    Marka: a['Marka'],
    Model: a['Model'],
    Yil: a['Yil'],
    Notlar: a['Sasi/Notlar']
  };
}

function saveVehicle(data) {
  return withLock_(function () {
    if (!data.MusteriID) throw new Error('Araç bir müşteriye bağlı olmalı.');
    data.Plaka = ('' + (data.Plaka || '')).toUpperCase().replace(/\s+/g, ' ').trim();
    if (data.AracID) {
      var sh = getSheet_(SHEETS.ARACLAR);
      var rows = readObjects_(SHEETS.ARACLAR);
      var hit = rows.filter(function (a) { return a['AracID'] === data.AracID; })[0];
      if (!hit) throw new Error('Araç bulunamadı.');
      sh.getRange(hit._row, 2, 1, 7).setValues([[
        data.MusteriID, data.Plaka, data.Tur, data.Marka || '',
        data.Model || '', data.Yil || '', data.Notlar || ''
      ]]);
    } else {
      data.AracID = newId_('A');
      appendRow_(SHEETS.ARACLAR, {
        'AracID': data.AracID,
        'MusteriID': data.MusteriID,
        'Plaka': data.Plaka,
        'Tur': data.Tur,
        'Marka': data.Marka || '',
        'Model': data.Model || '',
        'Yil': data.Yil || '',
        'Sasi/Notlar': data.Notlar || '',
        'Aktif': true
      });
    }
    clearCache_();
    return data.AracID;
  });
}

function deleteVehicle(aracId) {
  return withLock_(function () {
    var sh = getSheet_(SHEETS.ARACLAR);
    var rows = readObjects_(SHEETS.ARACLAR);
    var hit = rows.filter(function (a) { return a['AracID'] === aracId; })[0];
    if (!hit) throw new Error('Araç bulunamadı.');
    sh.getRange(hit._row, HEADERS.Araclar.indexOf('Aktif') + 1).setValue(false);
    clearCache_();
    return true;
  });
}

/* =========================================================================
 * ARAMA — Plaka / Müşteri adı / Telefon
 * ========================================================================= */
function search(query) {
  var q = (query || '').toString().toLowerCase().trim();
  if (!q) return { araclar: [] };
  var qPlaka = q.replace(/\s+/g, '');
  var musteriler = readObjects_(SHEETS.MUSTERILER).filter(aktif_);
  var mMap = {};
  musteriler.forEach(function (m) { mMap[m['MusteriID']] = m; });

  var araclar = readObjects_(SHEETS.ARACLAR).filter(aktif_);
  var results = [];
  araclar.forEach(function (a) {
    var m = mMap[a['MusteriID']];
    if (!m) return;
    var plaka = ('' + a['Plaka']).toLowerCase().replace(/\s+/g, '');
    var ad = ('' + m['Ad Soyad']).toLowerCase();
    var tel = ('' + m['Telefon']).toLowerCase();
    if (plaka.indexOf(qPlaka) > -1 || ad.indexOf(q) > -1 || tel.indexOf(q) > -1) {
      var arac = mapArac_(a);
      arac.MusteriAdi = m['Ad Soyad'];
      arac.Telefon = m['Telefon'];
      results.push(arac);
    }
  });
  return { araclar: results.slice(0, 50) };
}

/* =========================================================================
 * SERVİS KAYITLARI (İŞ EMRİ)
 * ========================================================================= */

/** Bir aracın tüm servis geçmişi (özet, kalemler hariç). */
function getVehicleHistory(aracId) {
  var arac = readObjects_(SHEETS.ARACLAR).filter(function (a) {
    return a['AracID'] === aracId;
  })[0];
  if (!arac) throw new Error('Araç bulunamadı.');
  var musteri = readObjects_(SHEETS.MUSTERILER).filter(function (m) {
    return m['MusteriID'] === arac['MusteriID'];
  })[0] || {};
  var servisler = readObjects_(SHEETS.SERVISLER)
    .filter(function (s) { return s['AracID'] === aracId; })
    .sort(function (a, b) { return ('' + b['Tarih']).localeCompare('' + a['Tarih']); })
    .map(mapServis_);
  var omurToplam = servisler.reduce(function (sum, s) { return sum + s.GenelToplam; }, 0);
  return {
    arac: mapArac_(arac),
    musteri: {
      MusteriID: musteri['MusteriID'],
      AdSoyad: musteri['Ad Soyad'],
      Telefon: musteri['Telefon']
    },
    servisler: servisler,
    omurToplam: round2_(omurToplam)
  };
}

function mapServis_(s) {
  return {
    ServisID: s['ServisID'],
    AracID: s['AracID'],
    ServisNo: s['ServisNo'],
    Tarih: '' + s['Tarih'],
    Durum: s['Durum'],
    GenelNot: s['Genel Not'],
    IscilikToplam: num_(s['Iscilik Toplam']),
    ParcaToplam: num_(s['Parca Toplam']),
    KdvOrani: num_(s['KDV Orani']),
    KdvDahil: s['KDV Dahil'] === true || s['KDV Dahil'] === 'TRUE',
    KdvTutar: num_(s['KDV Tutar']),
    GenelToplam: num_(s['Genel Toplam'])
  };
}

/** Yeni iş emri açar. */
function createService(aracId) {
  return withLock_(function () {
    var arac = readObjects_(SHEETS.ARACLAR).filter(function (a) {
      return a['AracID'] === aracId;
    })[0];
    if (!arac) throw new Error('Araç bulunamadı.');
    var servisNo = nextServisNo_();
    var settings = getSettings();
    var id = newId_('S');
    appendRow_(SHEETS.SERVISLER, {
      'ServisID': id,
      'AracID': aracId,
      'ServisNo': servisNo,
      'Tarih': nowIso_(),
      'Durum': 'Beklemede',
      'Genel Not': '',
      'Iscilik Toplam': 0,
      'Parca Toplam': 0,
      'KDV Orani': settings.kdvOrani,
      'KDV Dahil': false,
      'KDV Tutar': 0,
      'Genel Toplam': 0
    });
    return id;
  });
}

function nextServisNo_() {
  var sh = getSheet_(SHEETS.AYARLAR);
  var values = sh.getDataRange().getValues();
  var rowNo = -1, current = 0;
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === 'sonServisNo') { rowNo = r + 1; current = num_(values[r][1]); break; }
  }
  var next = current + 1;
  if (rowNo === -1) {
    sh.appendRow(['sonServisNo', next]);
  } else {
    sh.getRange(rowNo, 2).setValue(next);
  }
  var yil = new Date().getFullYear();
  return yil + '-' + ('0000' + next).slice(-4);
}

/** Servis detayı: iş emri + işçilik + parça kalemleri (lazy load). */
function getServiceDetail(servisId) {
  var servis = readObjects_(SHEETS.SERVISLER).filter(function (s) {
    return s['ServisID'] === servisId;
  })[0];
  if (!servis) throw new Error('Servis kaydı bulunamadı.');
  var iscilikler = readObjects_(SHEETS.ISCILIKLER)
    .filter(function (i) { return i['ServisID'] === servisId; })
    .map(function (i) {
      return { KalemID: i['KalemID'], Aciklama: i['Aciklama'], Tutar: num_(i['Tutar']) };
    });
  var parcalar = readObjects_(SHEETS.PARCALAR)
    .filter(function (p) { return p['ServisID'] === servisId; })
    .map(function (p) {
      return {
        KalemID: p['KalemID'], ParcaAdi: p['Parca Adi'],
        Adet: num_(p['Adet']), BirimFiyat: num_(p['Birim Fiyat']), Tutar: num_(p['Tutar'])
      };
    });
  var arac = readObjects_(SHEETS.ARACLAR).filter(function (a) {
    return a['AracID'] === servis['AracID'];
  })[0] || {};
  var musteri = readObjects_(SHEETS.MUSTERILER).filter(function (m) {
    return m['MusteriID'] === arac['MusteriID'];
  })[0] || {};
  return {
    servis: mapServis_(servis),
    iscilikler: iscilikler,
    parcalar: parcalar,
    arac: mapArac_(arac),
    musteri: {
      MusteriID: musteri['MusteriID'],
      AdSoyad: musteri['Ad Soyad'],
      Telefon: musteri['Telefon']
    }
  };
}

function updateServiceStatus(servisId, durum) {
  return withLock_(function () {
    if (DURUMLAR.indexOf(durum) === -1) throw new Error('Geçersiz durum.');
    var sh = getSheet_(SHEETS.SERVISLER);
    var hit = readObjects_(SHEETS.SERVISLER).filter(function (s) {
      return s['ServisID'] === servisId;
    })[0];
    if (!hit) throw new Error('Servis kaydı bulunamadı.');
    sh.getRange(hit._row, HEADERS.ServisKayitlari.indexOf('Durum') + 1).setValue(durum);
    return true;
  });
}

/** İş emri üst bilgilerini (not, KDV oranı, KDV dahil mi, tarih) günceller. */
function updateServiceMeta(servisId, meta) {
  return withLock_(function () {
    var sh = getSheet_(SHEETS.SERVISLER);
    var hit = readObjects_(SHEETS.SERVISLER).filter(function (s) {
      return s['ServisID'] === servisId;
    })[0];
    if (!hit) throw new Error('Servis kaydı bulunamadı.');
    var H = HEADERS.ServisKayitlari;
    if (meta.GenelNot !== undefined) sh.getRange(hit._row, H.indexOf('Genel Not') + 1).setValue(meta.GenelNot);
    if (meta.Tarih !== undefined) sh.getRange(hit._row, H.indexOf('Tarih') + 1).setValue(meta.Tarih);
    if (meta.KdvOrani !== undefined) sh.getRange(hit._row, H.indexOf('KDV Orani') + 1).setValue(num_(meta.KdvOrani));
    if (meta.KdvDahil !== undefined) sh.getRange(hit._row, H.indexOf('KDV Dahil') + 1).setValue(!!meta.KdvDahil);
    recalcService_(servisId);
    return getServiceDetail(servisId);
  });
}

/* ---- İşçilik kalemleri ---- */
function addIscilik(servisId, aciklama, tutar) {
  return withLock_(function () {
    appendRow_(SHEETS.ISCILIKLER, {
      'KalemID': newId_('I'),
      'ServisID': servisId,
      'Aciklama': aciklama,
      'Tutar': round2_(num_(tutar))
    });
    recalcService_(servisId);
    return getServiceDetail(servisId);
  });
}

function deleteIscilik(servisId, kalemId) {
  return withLock_(function () {
    deleteKalem_(SHEETS.ISCILIKLER, kalemId);
    recalcService_(servisId);
    return getServiceDetail(servisId);
  });
}

/* ---- Parça kalemleri ---- */
function addParca(servisId, parcaAdi, adet, birimFiyat) {
  return withLock_(function () {
    var a = num_(adet) || 1;
    var bf = round2_(num_(birimFiyat));
    appendRow_(SHEETS.PARCALAR, {
      'KalemID': newId_('P'),
      'ServisID': servisId,
      'Parca Adi': parcaAdi,
      'Adet': a,
      'Birim Fiyat': bf,
      'Tutar': round2_(a * bf)
    });
    recalcService_(servisId);
    return getServiceDetail(servisId);
  });
}

function deleteParca(servisId, kalemId) {
  return withLock_(function () {
    deleteKalem_(SHEETS.PARCALAR, kalemId);
    recalcService_(servisId);
    return getServiceDetail(servisId);
  });
}

function deleteKalem_(sheetName, kalemId) {
  var sh = getSheet_(sheetName);
  var hit = readObjects_(sheetName).filter(function (k) {
    return k['KalemID'] === kalemId;
  })[0];
  if (!hit) throw new Error('Kalem bulunamadı.');
  sh.deleteRow(hit._row);
}

/** İşçilik + parça toplamlarını ve KDV'yi yeniden hesaplayıp servise yazar. */
function recalcService_(servisId) {
  var servis = readObjects_(SHEETS.SERVISLER).filter(function (s) {
    return s['ServisID'] === servisId;
  })[0];
  if (!servis) return;
  var iscilikToplam = readObjects_(SHEETS.ISCILIKLER)
    .filter(function (i) { return i['ServisID'] === servisId; })
    .reduce(function (sum, i) { return sum + num_(i['Tutar']); }, 0);
  var parcaToplam = readObjects_(SHEETS.PARCALAR)
    .filter(function (p) { return p['ServisID'] === servisId; })
    .reduce(function (sum, p) { return sum + num_(p['Tutar']); }, 0);

  // Fiyatlar her zaman NET (KDV hariç) girilir; KDV daima üzerine eklenir.
  // "KDV Dahil" yalnızca bir GÖSTERİM bayrağıdır (kalemleri KDV eklenmiş gösterir),
  // hesaplanan toplamları değiştirmez.
  var araToplam = iscilikToplam + parcaToplam;
  var oran = num_(servis['KDV Orani']) / 100;
  var kdvDahil = servis['KDV Dahil'] === true || servis['KDV Dahil'] === 'TRUE';
  var kdvTutar = araToplam * oran;
  var genelToplam = araToplam + kdvTutar;
  var sh = getSheet_(SHEETS.SERVISLER);
  var H = HEADERS.ServisKayitlari;
  // Tek setValues ile bitişik kolonları toplu yaz (Iscilik Toplam ... Genel Toplam)
  var startCol = H.indexOf('Iscilik Toplam') + 1;
  sh.getRange(servis._row, startCol, 1, 6).setValues([[
    round2_(iscilikToplam),
    round2_(parcaToplam),
    num_(servis['KDV Orani']),
    kdvDahil,
    round2_(kdvTutar),
    round2_(genelToplam)
  ]]);
}

/** Bir iş emrini ve tüm kalemlerini siler. */
function deleteService(servisId) {
  return withLock_(function () {
    [SHEETS.ISCILIKLER, SHEETS.PARCALAR].forEach(function (sheetName) {
      var sh = getSheet_(sheetName);
      var rows = readObjects_(sheetName).filter(function (k) {
        return k['ServisID'] === servisId;
      });
      // Alttan üste sil ki satır numaraları kaymasın
      rows.sort(function (a, b) { return b._row - a._row; })
        .forEach(function (k) { sh.deleteRow(k._row); });
    });
    var ssh = getSheet_(SHEETS.SERVISLER);
    var hit = readObjects_(SHEETS.SERVISLER).filter(function (s) {
      return s['ServisID'] === servisId;
    })[0];
    if (hit) ssh.deleteRow(hit._row);
    return true;
  });
}

/* =========================================================================
 * MÜŞTERİ ÖZETİ (yazdır / WhatsApp)
 * ========================================================================= */
function getSummary(servisId) {
  var d = getServiceDetail(servisId);
  var settings = getSettings();
  return {
    firma: settings,
    servis: d.servis,
    arac: d.arac,
    musteri: d.musteri,
    iscilikler: d.iscilikler,
    parcalar: d.parcalar
  };
}
