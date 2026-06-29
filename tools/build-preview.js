/**
 * build-preview.js
 * Apps Script dosyalarını (Index/Stylesheet/JavaScript.html) alıp,
 * google.script.run yerine sahte (mock) bir backend koyarak tek dosyalık,
 * tarayıcıda doğrudan açılabilen bir preview.html üretir.
 *
 * Kullanım:  node tools/build-preview.js
 * Çıktı:     preview.html
 *
 * NOT: Bu yalnızca DENEME/ÖNİZLEME içindir. Veriler bellekte tutulur,
 * sayfa yenilenince sıfırlanır. Gerçek kullanım için README'deki Apps Script
 * kurulumunu izleyin.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const styles = read('Stylesheet.html');     // <style>...</style>
const appJs = read('JavaScript.html');       // <script>...</script>
let index = read('Index.html');

// include() çağrılarını kaldır (preview'da gerek yok)
index = index.replace(/<\?!=\s*include\([^)]*\);?\s*\?>/g, '');

// Index.html'in <body> içeriğini al
const bodyMatch = index.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
const bodyInner = bodyMatch ? bodyMatch[1] : index;

const mock = `
<script>
/* ============ SAHTE BACKEND (yalnızca önizleme) ============ */
(function () {
  function uid(p){ return p + '_' + Math.random().toString(36).slice(2,10); }
  function num(v){ var n = Number(v); return isNaN(n) ? 0 : n; }
  function r2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }
  function now(){
    var d = new Date(), p = function(x){ return ('0'+x).slice(-2); };
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
  }

  // ---- Başlangıç (örnek) verisi ----
  var DB = {
    settings: { kdvOrani: 20, firmaAdi: 'OtoKay-T Servis', firmaTelefon: '0212 555 12 34', firmaAdres: 'Sanayi Mah. 5. Sok. No:12, İstanbul' },
    sonServisNo: 2,
    musteriler: [
      { MusteriID:'M_ahmet', AdSoyad:'Ahmet Yılmaz', Telefon:'0532 111 22 33', Notlar:'Düzenli müşteri', KayitTarihi:'2026-01-10 09:00', Aktif:true },
      { MusteriID:'M_zeynep', AdSoyad:'Zeynep Kaya', Telefon:'0505 444 55 66', Notlar:'', KayitTarihi:'2026-03-02 14:20', Aktif:true }
    ],
    araclar: [
      { AracID:'A_34abc', MusteriID:'M_ahmet', Plaka:'34 ABC 123', Tur:'Otomobil', Marka:'Renault', Model:'Clio', Yil:'2018', Notlar:'', Aktif:true },
      { AracID:'A_34xyz', MusteriID:'M_ahmet', Plaka:'34 XYZ 789', Tur:'Otomobil', Marka:'Fiat', Model:'Egea', Yil:'2021', Notlar:'', Aktif:true },
      { AracID:'A_06moto', MusteriID:'M_zeynep', Plaka:'06 MTR 35', Tur:'Motosiklet', Marka:'Honda', Model:'PCX 125', Yil:'2022', Notlar:'Kasko var', Aktif:true }
    ],
    servisler: [
      { ServisID:'S_1', AracID:'A_34abc', ServisNo:'2026-0001', Tarih:'2026-05-15 10:30', Durum:'Teslim Edildi', GenelNot:'Periyodik bakım', KdvOrani:20, KdvDahil:false },
      { ServisID:'S_2', AracID:'A_34abc', ServisNo:'2026-0002', Tarih:'2026-06-20 16:00', Durum:'Devam Ediyor', GenelNot:'', KdvOrani:20, KdvDahil:false }
    ],
    iscilikler: [
      { KalemID:'I_1', ServisID:'S_1', Aciklama:'Yağ ve filtre değişim işçiliği', Tutar:500 },
      { KalemID:'I_2', ServisID:'S_1', Aciklama:'Genel kontrol', Tutar:250 },
      { KalemID:'I_3', ServisID:'S_2', Aciklama:'Balata değişimi', Tutar:400 }
    ],
    parcalar: [
      { KalemID:'P_1', ServisID:'S_1', ParcaAdi:'Motor yağı 5W30', Adet:4, BirimFiyat:180, Tutar:720 },
      { KalemID:'P_2', ServisID:'S_1', ParcaAdi:'Yağ filtresi', Adet:1, BirimFiyat:150, Tutar:150 },
      { KalemID:'P_3', ServisID:'S_2', ParcaAdi:'Ön fren balatası', Adet:1, BirimFiyat:850, Tutar:850 }
    ]
  };

  var DURUMLAR = ['Beklemede','Devam Ediyor','Tamamlandi','Teslim Edildi'];

  function mapArac(a){ return { AracID:a.AracID, MusteriID:a.MusteriID, Plaka:a.Plaka, Tur:a.Tur, Marka:a.Marka, Model:a.Model, Yil:a.Yil, Notlar:a.Notlar }; }
  function mapServis(s){
    return { ServisID:s.ServisID, AracID:s.AracID, ServisNo:s.ServisNo, Tarih:s.Tarih, Durum:s.Durum, GenelNot:s.GenelNot,
      IscilikToplam:num(s.IscilikToplam), ParcaToplam:num(s.ParcaToplam), KdvOrani:num(s.KdvOrani),
      KdvDahil:!!s.KdvDahil, KdvTutar:num(s.KdvTutar), GenelToplam:num(s.GenelToplam) };
  }
  function byId(arr, key, val){ return arr.filter(function(x){ return x[key]===val; })[0]; }

  function recalc(servisId){
    var s = byId(DB.servisler,'ServisID',servisId); if(!s) return;
    var it = DB.iscilikler.filter(function(i){return i.ServisID===servisId;}).reduce(function(a,i){return a+num(i.Tutar);},0);
    var pt = DB.parcalar.filter(function(p){return p.ServisID===servisId;}).reduce(function(a,p){return a+num(p.Tutar);},0);
    var ara = it+pt, oran = num(s.KdvOrani)/100, kdv, gen;
    if(s.KdvDahil){ gen = ara; kdv = ara - (ara/(1+oran)); } else { kdv = ara*oran; gen = ara+kdv; }
    s.IscilikToplam=r2(it); s.ParcaToplam=r2(pt); s.KdvTutar=r2(kdv); s.GenelToplam=r2(gen);
  }
  // İlk yüklemede toplamları hesapla
  DB.servisler.forEach(function(s){ recalc(s.ServisID); });

  var Backend = {
    getBootstrapData: function(){
      var acik = DB.servisler.filter(function(s){return s.Durum!=='Teslim Edildi';}).length;
      return { settings:DB.settings, durumlar:DURUMLAR, stats:{
        musteriSayisi: DB.musteriler.filter(function(m){return m.Aktif;}).length,
        aracSayisi: DB.araclar.filter(function(a){return a.Aktif;}).length,
        acikServis: acik, toplamServis: DB.servisler.length
      }};
    },
    search: function(q){
      q = (q||'').toLowerCase().trim(); var qp = q.replace(/\\s+/g,'');
      if(!q) return {araclar:[]};
      var out = [];
      DB.araclar.filter(function(a){return a.Aktif;}).forEach(function(a){
        var m = byId(DB.musteriler,'MusteriID',a.MusteriID); if(!m) return;
        var pl=(''+a.Plaka).toLowerCase().replace(/\\s+/g,''), ad=(''+m.AdSoyad).toLowerCase(), tel=(''+m.Telefon).toLowerCase();
        if(pl.indexOf(qp)>-1 || ad.indexOf(q)>-1 || tel.indexOf(q)>-1){
          var x = mapArac(a); x.MusteriAdi=m.AdSoyad; x.Telefon=m.Telefon; out.push(x);
        }
      });
      return {araclar: out.slice(0,50)};
    },
    getCustomers: function(query,page,pageSize){
      page=page||1; pageSize=pageSize||20; var q=(query||'').toLowerCase().trim();
      var rows = DB.musteriler.filter(function(m){return m.Aktif;});
      if(q) rows = rows.filter(function(m){return (m.AdSoyad+''+m.Telefon).toLowerCase().indexOf(q)>-1;});
      rows.sort(function(a,b){return (''+b.KayitTarihi).localeCompare(''+a.KayitTarihi);});
      var total=rows.length, start=(page-1)*pageSize;
      var items = rows.slice(start,start+pageSize).map(function(m){
        return {MusteriID:m.MusteriID, AdSoyad:m.AdSoyad, Telefon:m.Telefon, Notlar:m.Notlar, KayitTarihi:m.KayitTarihi};
      });
      return {items:items, total:total, page:page, pageSize:pageSize};
    },
    saveCustomer: function(d){
      if(d.MusteriID){ var m=byId(DB.musteriler,'MusteriID',d.MusteriID); if(!m) throw new Error('Müşteri bulunamadı'); m.AdSoyad=d.AdSoyad; m.Telefon=d.Telefon; m.Notlar=d.Notlar||''; }
      else { d.MusteriID=uid('M'); DB.musteriler.push({MusteriID:d.MusteriID, AdSoyad:d.AdSoyad, Telefon:d.Telefon, Notlar:d.Notlar||'', KayitTarihi:now(), Aktif:true}); }
      return d.MusteriID;
    },
    deleteCustomer: function(id){ var m=byId(DB.musteriler,'MusteriID',id); if(m) m.Aktif=false; return true; },
    getCustomerWithVehicles: function(id){
      var m=byId(DB.musteriler,'MusteriID',id); if(!m) throw new Error('Müşteri bulunamadı');
      return { musteri:{MusteriID:m.MusteriID, AdSoyad:m.AdSoyad, Telefon:m.Telefon, Notlar:m.Notlar},
        araclar: DB.araclar.filter(function(a){return a.MusteriID===id && a.Aktif;}).map(mapArac) };
    },
    saveVehicle: function(d){
      d.Plaka=(''+(d.Plaka||'')).toUpperCase().replace(/\\s+/g,' ').trim();
      if(d.AracID){ var a=byId(DB.araclar,'AracID',d.AracID); if(!a) throw new Error('Araç bulunamadı');
        a.MusteriID=d.MusteriID; a.Plaka=d.Plaka; a.Tur=d.Tur; a.Marka=d.Marka||''; a.Model=d.Model||''; a.Yil=d.Yil||''; a.Notlar=d.Notlar||''; }
      else { d.AracID=uid('A'); DB.araclar.push({AracID:d.AracID, MusteriID:d.MusteriID, Plaka:d.Plaka, Tur:d.Tur, Marka:d.Marka||'', Model:d.Model||'', Yil:d.Yil||'', Notlar:d.Notlar||'', Aktif:true}); }
      return d.AracID;
    },
    deleteVehicle: function(id){ var a=byId(DB.araclar,'AracID',id); if(a) a.Aktif=false; return true; },
    getVehicleHistory: function(aracId){
      var a=byId(DB.araclar,'AracID',aracId); if(!a) throw new Error('Araç bulunamadı');
      var m=byId(DB.musteriler,'MusteriID',a.MusteriID)||{};
      var ss = DB.servisler.filter(function(s){return s.AracID===aracId;}).sort(function(x,y){return (''+y.Tarih).localeCompare(''+x.Tarih);}).map(mapServis);
      var omur = ss.reduce(function(a,s){return a+s.GenelToplam;},0);
      return { arac:mapArac(a), musteri:{MusteriID:m.MusteriID, AdSoyad:m.AdSoyad, Telefon:m.Telefon}, servisler:ss, omurToplam:r2(omur) };
    },
    createService: function(aracId){
      var a=byId(DB.araclar,'AracID',aracId); if(!a) throw new Error('Araç bulunamadı');
      DB.sonServisNo++; var no = new Date().getFullYear()+'-'+('0000'+DB.sonServisNo).slice(-4);
      var id=uid('S');
      DB.servisler.push({ServisID:id, AracID:aracId, ServisNo:no, Tarih:now(), Durum:'Beklemede', GenelNot:'', KdvOrani:DB.settings.kdvOrani, KdvDahil:false, IscilikToplam:0, ParcaToplam:0, KdvTutar:0, GenelToplam:0});
      return id;
    },
    getServiceDetail: function(servisId){
      var s=byId(DB.servisler,'ServisID',servisId); if(!s) throw new Error('Servis bulunamadı');
      var a=byId(DB.araclar,'AracID',s.AracID)||{}; var m=byId(DB.musteriler,'MusteriID',a.MusteriID)||{};
      return {
        servis: mapServis(s),
        iscilikler: DB.iscilikler.filter(function(i){return i.ServisID===servisId;}).map(function(i){return {KalemID:i.KalemID, Aciklama:i.Aciklama, Tutar:num(i.Tutar)};}),
        parcalar: DB.parcalar.filter(function(p){return p.ServisID===servisId;}).map(function(p){return {KalemID:p.KalemID, ParcaAdi:p.ParcaAdi, Adet:num(p.Adet), BirimFiyat:num(p.BirimFiyat), Tutar:num(p.Tutar)};}),
        arac: mapArac(a), musteri:{MusteriID:m.MusteriID, AdSoyad:m.AdSoyad, Telefon:m.Telefon}
      };
    },
    updateServiceStatus: function(id,durum){ var s=byId(DB.servisler,'ServisID',id); if(s) s.Durum=durum; return true; },
    updateServiceMeta: function(id,meta){
      var s=byId(DB.servisler,'ServisID',id); if(!s) throw new Error('bulunamadı');
      if(meta.GenelNot!==undefined) s.GenelNot=meta.GenelNot;
      if(meta.Tarih!==undefined) s.Tarih=meta.Tarih;
      if(meta.KdvOrani!==undefined) s.KdvOrani=num(meta.KdvOrani);
      if(meta.KdvDahil!==undefined) s.KdvDahil=!!meta.KdvDahil;
      recalc(id); return Backend.getServiceDetail(id);
    },
    addIscilik: function(id,ac,tu){ DB.iscilikler.push({KalemID:uid('I'), ServisID:id, Aciklama:ac, Tutar:r2(num(tu))}); recalc(id); return Backend.getServiceDetail(id); },
    deleteIscilik: function(id,kid){ DB.iscilikler=DB.iscilikler.filter(function(i){return i.KalemID!==kid;}); recalc(id); return Backend.getServiceDetail(id); },
    addParca: function(id,ad,adet,bf){ var a=num(adet)||1, b=r2(num(bf)); DB.parcalar.push({KalemID:uid('P'), ServisID:id, ParcaAdi:ad, Adet:a, BirimFiyat:b, Tutar:r2(a*b)}); recalc(id); return Backend.getServiceDetail(id); },
    deleteParca: function(id,kid){ DB.parcalar=DB.parcalar.filter(function(p){return p.KalemID!==kid;}); recalc(id); return Backend.getServiceDetail(id); },
    deleteService: function(id){ DB.servisler=DB.servisler.filter(function(s){return s.ServisID!==id;}); DB.iscilikler=DB.iscilikler.filter(function(i){return i.ServisID!==id;}); DB.parcalar=DB.parcalar.filter(function(p){return p.ServisID!==id;}); return true; },
    getSummary: function(servisId){ var d=Backend.getServiceDetail(servisId); return {firma:DB.settings, servis:d.servis, arac:d.arac, musteri:d.musteri, iscilikler:d.iscilikler, parcalar:d.parcalar}; },
    saveSettings: function(d){ DB.settings={kdvOrani:num(d.kdvOrani), firmaAdi:d.firmaAdi||'', firmaTelefon:d.firmaTelefon||'', firmaAdres:d.firmaAdres||''}; return DB.settings; }
  };

  // google.script.run taklidi (her erişimde taze handler seti)
  function makeRunner(){
    var ok, fail;
    var runner = { withSuccessHandler:function(f){ok=f;return runner;}, withFailureHandler:function(f){fail=f;return runner;} };
    Object.keys(Backend).forEach(function(name){
      runner[name] = function(){
        var args = arguments;
        setTimeout(function(){ try{ var r=Backend[name].apply(null,args); ok&&ok(r); }catch(e){ fail&&fail(e); } }, 80);
      };
    });
    return runner;
  }
  window.google = { script: { get run(){ return makeRunner(); }, host:{close:function(){}} } };
})();
</script>
`;

const html =
`<!DOCTYPE html>
<html lang="tr">
<head>
<base target="_top">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OtoKay-T — Önizleme</title>
${styles}
</head>
<body>
<div style="background:#7c2d12;color:#fff;text-align:center;padding:6px;font-size:13px">
  ⚠️ ÖNİZLEME MODU — sahte verilerle, kayıtlar kalıcı değildir. Gerçek kullanım için Apps Script kurulumu (README) gerekir.
</div>
${bodyInner}
${mock}
${appJs}
</body>
</html>`;

fs.writeFileSync(path.join(root, 'preview.html'), html, 'utf8');
console.log('preview.html oluşturuldu (' + html.length + ' bayt)');
