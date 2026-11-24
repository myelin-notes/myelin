import type { SiteCopy } from './index';
import { formatPrice } from './prices';

const tr: SiteCopy = {
  meta: {
    title: 'Myelin Notes | Platformlar Arası Not Alma Uygulaması',
    description:
      'Mac, Windows ve Linux için Myelin Notes ile el yazısını, klavyeyle yazılan notları ve PDF’leri bir araya getirin. Çevrimdışı çalışır, hesap gerektirmez. Kişisel kullanım için ücretsiz.',
  },

  topbar: {
    nav: 'Site',
    download: 'İndir',
    language: 'Dil',
    beta: 'Beta',
    betaNote:
      'Myelin Notes beta aşamasında ve fiyatlandırma planları değişebilir.',
  },

  sceneLabels: {
    ink: 'PDF’ler',
    pages: 'Sayfalar',
    'audio-search': 'Ses ve arama',
    linked: 'Bağlantılı notlar',
    sync: 'Eşitleme ve iş birliği',
    'local-first': 'Önce yerel',
    import: 'İçe aktarma',
    download: 'İndir',
  },
  faqKicker: 'Sorular',

  hero: {
    eyebrow: 'Mac, Windows ve Linux için platformlar arası not alma uygulaması',
    headline: 'Myelin Notes: el yazısı, klavye ve PDF’ler. Tek not.',
    headlineMark: 'Tek not.',
    subheadline:
      'Myelin Notes; Mac, Windows ve Linux için platformlar arası bir not alma uygulamasıdır. El yazısını, klavyeyle yazılan notları ve PDF’leri tek bir tuvalde birleştirin. Çevrimdışı çalışır ve kişisel kullanım için ücretsizdir.',
    trustLine:
      'Kişisel kullanım için ücretsiz · Hesap gerekmez · Notlarınız asla ücretli duvarın arkasına kilitlenmez',
    ctaPrimary: 'İndir',
    ctaSecondary: 'Tarayıcınızda deneyin',
  },

  tryIt: {
    title: 'Myelin Notes’u tarayıcınızda deneyin',
    description:
      'Doğrudan tarayıcınızda çizebileceğiniz, yazabileceğiniz ve not alabileceğiniz bir Myelin tuvali; bu tarayıcıya kaydedilir. Tüm özellikler için uygulamayı indirin.',
    badge: 'Sınırlı web önizlemesi',
    limited:
      'Bu sınırlı bir web önizlemesidir. Uygulamada ayrıca not kütüphanesi, arama, ses kaydı, PDF dışa aktarma ve eşitleme bulunur.',
  },

  ink: {
    pdfHeading: 'Doğrudan PDF’lerinizin üzerine yazın.',
    pdfBody:
      'Bir PDF’i tuvale bırakın ve onu diğer her şeyle aynı mürekkeple işaretleyin: bir denklemi daire içine alın, bir satırı vurgulayın, kenar boşluklarına not düşün. İşiniz bitince açıklamalı PDF’i dışa aktarın.',
  },

  pages: {
    heading: 'Gerçek belgeler, doğrudan tuvalde.',
    body: 'Sayfa çerçeveleri tam teşekküllü zengin metin belgeleridir: Markdown kısayolları, başlıklar, listeler ve onay kutuları, tablolar, matematik ve Pro ile çalıştırabileceğiniz kod blokları. Jupyter defterleri doğrudan bir sayfa çerçevesine aktarılır.',
  },

  audioSearch: {
    heading: 'Kaydedin. Yazıya dökün. Tuvalde bulun.',
    audioBody:
      'Dersleri veya toplantıları tuvalde kaydedin. Uygulamayla gelen Whisper base modeli bunları cihazda yazıya döker; böylece sesi hiçbir yere göndermeden dökümdeki kelimeleri bulabilirsiniz. Pro daha doğru modeller ekler.',
    searchBody:
      'Kütüphanenizde not başlığına, etiketlere ve kayıtlı metin ya da ses dökümlerine göre arayın. Açık bir tuvalin içindeki eşleşmeleri de bulun.',
  },

  linked: {
    heading: 'Notlarınız, birbirine bağlı.',
    body: '[[Not bağlantıları]], geri bağlantılar ve üzerine gelince açılan önizleme kartları, ilgili fikirleri bir adım ötede tutar. Komut paleti sizi her yere götürür ve dosya başına sürüm geçmişi bir notun herhangi bir önceki halini geri yükler.',
  },

  importing: {
    heading: 'Eski notlarınızı yanınızda getirin.',
    body: 'Notlarınızı diğer uygulamalardan içe aktarın',
    sources: [
      {
        id: 'goodnotes',
        label: 'Goodnotes’tan içe aktar',
        detail:
          'Goodnotes içeriğinizi PDF’lerden oluşan bir zip olarak dışa aktararak içe aktarın.',
      },
      {
        id: 'onenote',
        label: 'OneNote’tan içe aktar',
        detail:
          'OneNote içeriğinizi bir .onepkg defterinden veya .one bölümünden içe aktarın.',
      },
      {
        id: 'obsidian',
        label: 'Obsidian’dan içe aktar',
        detail: 'Obsidian içeriğinizi kasa klasörüyle içe aktarın.',
      },
      {
        id: 'notion',
        label: 'Notion’dan içe aktar',
        detail:
          'Notion içeriğinizi Markdown ve CSV olarak dışa aktararak içe aktarın.',
      },
    ],
  },

  localFirst: {
    heading: 'Her şey kendi bilgisayarınızda.',
    lede: 'Arada bulut yok. Notlarınız kendi diskinizdeki sıradan dosyalardır ve Myelin tamamen çevrimdışı çalışır.',
    bullets: [
      'Notlarınız diskinizde, açık ve çakışmasız bir biçimde (Yjs) duran düz dosyalardır. Hiçbir şey kilitli kalmaz.',
      'Her şey tamamen çevrimdışı çalışır; hesap da yok, arada sunucu da.',
      'Notlarınız kendi bilgisayarınızda kalır.',
      'Pro ile kendi yapay zekânızı getirin: modeller, bizim seçtiğimiz bir buluta değil, yerel bir MCP sunucusuna bağlanır.',
      'Obsidian veya GoodNotes’tan içe aktarın; PDF, görsel veya JSON olarak dışa aktarın ve kaynak kodun her satırını GitHub’da okuyun.',
    ],
  },

  sync: {
    heading: 'Arada sunucu olmadan eşitleyin ve birlikte çalışın.',
    kicker:
      'Gerçek zamanlı düzenleme genellikle notlarınızı tutan bir sunucu demektir. Myelin bunun yerine cihazları doğrudan birbirine bağlar.',
    tiers: [
      {
        badge: 'Bugün',
        live: true,
        title: 'Canlı iş birliği',
        body: 'Aynı not açık olan iki cihaz birbirini otomatik olarak bulur, ardından doğrudan aralarında kurulan şifreli bir QUIC bağlantısı (iroh) üzerinden eş zamanlı düzenler.',
      },
      {
        badge: 'Bugün',
        live: true,
        title: 'GitHub eşitleme',
        body: 'Myelin’e bir depo ve dal gösterin; çalışma alanınız, kontrolü sizde olan bir depo üzerinden cihazlar arasında eşitlensin.',
      },
      {
        badge: 'Yakında',
        title: 'Davetler',
        body: 'Tüm depoyu teslim etmeden birini tek bir nota dahil edin; sahip, düzenleyici ve görüntüleyici rolleri neler yapabileceklerini belirler.',
      },
    ],
  },

  download: {
    body: 'Türkçe, İngilizce, İspanyolca, Fransızca ve Basitleştirilmiş Çince olarak sunulur.',
    cta: 'Myelin Notes’u indir',
    platforms: [
      {
        key: 'mac',
        name: 'macOS',
        label: 'macOS için indir',
        sub: 'macOS 10.15+',
      },
      {
        key: 'windows',
        name: 'Windows',
        label: 'Windows için indir',
        sub: 'Windows 10+',
      },
      {
        key: 'linux',
        name: 'Linux',
        label: 'Linux için indir',
        sub: 'AppImage',
      },
      {
        key: 'ios',
        name: 'iOS',
        label: 'iOS için indir',
        sub: 'iPhone ve iPad',
      },
      {
        key: 'android',
        name: 'Android',
        label: 'Android için indir',
        sub: 'Telefon ve tablet',
      },
    ],
    comingSoon: 'Kapalı beta',
    mobileBadge:
      'iPhone, iPad ve Android kapalı betada: aynı notlar, kısıtlı bir görüntüleyici değil',
    faqTitle: 'SSS',
    faqMarkdown: `# SSS

## Gerçekten ücretsiz mi?

Evet. Ücretsiz sürüm kişisel kullanım için ücretsizdir; süre sınırı yoktur ve neredeyse tüm özellikleri içerir. Myelin Notes Pro, ${formatPrice('tr', 'pro')} (öğrenciler için ${formatPrice('tr', 'student')}) tutarında tek seferlik bir satın almadır ve MCP üzerinden yapay zekâ ajanları, çalıştırılabilir kod, el yazısı tanıma ve daha yüksek sınırlar ekler. Notlarınız asla ücretli duvarın arkasına kilitlenmez.

## Notlarım nerede saklanıyor?

Yerel olarak, bilgisayarınızda dosyalar halinde. İsterseniz kontrolü sizde olan bir depoda tutmak için isteğe bağlı GitHub eşitlemesi var.

## Hesaba ihtiyacım var mı?

Hayır. Myelin Notes’un hiçbir hesap sistemi yoktur: indirirsiniz, açarsınız ve notlarınız diskinizdedir. GitHub ile yalnızca GitHub eşitlemesini açarsanız oturum açarsınız; o da bizdeki değil, GitHub’daki hesabınızdır.

## Açık kaynak mı?

Tam olarak değil. Kaynak kodu herkese açıktır; böylece herkes okuyup uygulamanın notlarıyla ne yaptığını kontrol edebilir ve kişisel ya da ticari olmayan diğer amaçlarla kullanımı ücretsizdir. PolyForm Strict 1.0.0 ile lisanslanmıştır; yani yeniden dağıtamaz veya değiştirilmiş sürümlerini yayımlayamazsınız ve ticari kullanım ayrı bir lisans gerektirir.

## Başkalarıyla birlikte çalışabilir miyim?

Evet, bugün, canlı ve eşler arası. Myelin hesabı yok ve arada duran hiçbir şey yok. Cihazlar birbirini GitHub eşitlemesi üzerinden bulur, bu yüzden her iki tarafın da aynı depoya erişimi olmalıdır. İzinli paylaşılan defterler v1.0 ile geliyor.

## Başka bir uygulamadan içe aktarabilir miyim?

Evet. Myelin bir Obsidian kasasını, bir OneNote .onepkg defterini veya .one bölümünü, PDF olarak dışa aktarılmış bir Goodnotes klasörünü, tek tek Markdown dosyalarını, PDF’leri, Jupyter defterlerini, görselleri ve videoları ve Myelin’in kendisinden dışa aktarılmış bir çalışma alanı klasörünü içe aktarır. Notion içerikleri, dosya içe aktarıcının okuduğu kendi Markdown ve CSV dışa aktarımıyla gelir; sayfa hiyerarşisini koruyan özel bir Notion içe aktarıcısı yol haritasında.

## Çevrimdışı çalışır mı?

Tamamen. Düzenleme, ses dökümü, PDF açıklama ve dışa aktarma tamamen kendi bilgisayarınızda çalışır; bu yüzden uygulama ağ kapalıyken de aynı şekilde davranır. Yalnızca GitHub eşitlemesi ve canlı iş birliği bağlantı gerektirir ve ikisi de isteğe bağlıdır.

## iPhone, iPad ve Android ne olacak?

Kapalı betada. Bugün Myelin Notes, Mac, Windows ve Linux’ta herkese açık olarak sunuluyor. Mobil uygulamalar kapalı betada ve kısıtlı bir görüntüleyici değil, yerel derlemeler: masaüstü uygulamalarla aynı notlar, aynı tuval ve aynı eşitleme; iPad’de Apple Pencil, Android’de ise S Pen veya aktif kalem desteğiyle.
`,
  },

  features: {
    meta: {
      title: 'Özellikler | Myelin Notes',
      description:
        'Myelin Notes’un yapabildiği her şey: şekil yakalama, el yazısı için cetvel ve kalem hazır ayarları, PDF alıntıları ve sabitlenmiş mürekkep, Mermaid diyagramlı sayfalar, yerel MCP üzerinden yapay zekâ ajanları ve daha fazlası.',
    },
    eyebrow: 'Özellikler',
    headline: 'Myelin Notes’un yapabildiği her şey.',
    subheadline:
      'Ana sayfa genel resmi gösterir. Burası ayrıntılar: el yazısı, PDF’ler, sayfalar ve tuval için araçlar ve bunların birbirine nasıl uyduğu.',
    jumpNav: 'Bölümler',
    sections: {
      handwriting: {
        label: 'El yazısı',
        heading:
          'Kalem gibi hissettiren, kâğıtta olmayan birkaç numarası olan mürekkep.',
        lede: 'Ekran kalemi, parmak veya fareyle yazın. Myelin düz olmasını istediğinizi düzeltir, el yazınızı ise size bırakır.',
        details: [
          'Daha dengeli çizgiler için ayarlanabilir sabitlemeli, basınca duyarlı kalemler',
          'Avuç içi algılama ve parmaklarınızın ne yapacağı için Kalem veya Dokunma modu',
          'Kalem düğmesi hemen ya da kalem kalktığında silgiye geçer',
          'Çizgi silgisi veya yalnızca dokunduğu yeri silen hassas silgi',
          'Dikdörtgen veya kement seçimi, ardından taşıma, kopyalama, kilitleme veya sıralama',
          'Bir kez kaydedip tekrar kullandığınız özel renkler ve seçtiğiniz yazı tipinde metin',
          'Pro ile elle yazdığınız kelimeleri bulun; tanıma cihazınızda yapılır (henüz Linux’ta değil)',
        ],
      },
      pdfs: {
        label: 'PDF’ler',
        heading: 'Yalnızca baktığınız değil, üzerinde çalıştığınız PDF’ler.',
        lede: 'PDF’lere notlarınızın geri kalanıyla aynı tuvalde açıklama ekleyin, alıntı yapın ve onları yeniden düzenleyin, ardından sonucu dışa aktarın.',
        details: [
          'İşiniz bitince açıklamalı PDF’i dışa aktarın',
          'Sayfa gezginiyle herhangi bir sayfaya atlayın',
          'Bir PDF’i Sayfalar olarak ya da yan yana Sütunlar olarak dizin',
          'Geri dönmek için bir PDF sayfasını bayrakla işaretleyin',
          'Tuval aramasıyla PDF’lerin içindeki kelimeleri bulun',
        ],
      },
      pages: {
        label: 'Sayfalar',
        heading: 'Metin tutmaktan fazlasını yapan sayfalar.',
        lede: 'Sayfa çerçeveleri tuvaldeki zengin metin belgeleridir. Eklemek istediğiniz her şey için / yazın ya da doğrudan Markdown yazın.',
        details: [
          'Başlıklar, listeler, alıntılar ve biçimlendirme için Markdown kısayolları',
          'Yapılacaklar listeleri, bilgi kutuları ve tablolar',
          'Matematik blokları ve Pro ile çalıştırabileceğiniz kod blokları',
          'Üzerine gelince önizlenen ve bir notu yeniden adlandırdığınızda güncellenen [[not bağlantıları]]',
          'Gömülü görseller, videolar, YouTube ve bağlantı kartları',
          'Sayfalar, Sütunlar veya Kesintisiz düzen',
        ],
      },
      code: {
        label: 'Kod',
        heading: 'Notlarınızın yanında duran defterler.',
        lede: 'Kod bloklarını doğrudan bir sayfada çalıştırın ve çıktıyı düz metinden tablolara ve grafiklere kadar tuvalde görün. Jupyter defterlerinizi de yanınızda getirin.',
        details: [
          'Python, JavaScript, TypeScript, Ruby, Bash, Go, Rust, C ve C++',
          'Zaten yüklü olan araç zincirleriyle kendi bilgisayarınızda çalışır',
          'pandas DataFrame’leri tablo, matplotlib figürleri görsel olarak gösterilir',
          '.ipynb defterlerini Markdown ve kod hücreleriyle içe aktarın',
        ],
      },
      canvas: {
        label: 'Tuval',
        heading: 'Yolunuzu bulmanın kolay kaldığı sonsuz bir tuval.',
        lede: 'Sayfaları, PDF’leri, görselleri, sesleri ve mürekkebi istediğiniz yere koyun ve tek tuşla herhangi bir noktaya geri dönün.',
        details: [
          'Kırpabileceğiniz, döndürebileceğiniz, kilitleyebileceğiniz ve bir sayfaya sabitleyebileceğiniz görseller',
          'Kameranızla fotoğraf çekip doğrudan tuvale bırakın',
          'Tuvalin her yerinde denklemler için LaTeX blokları',
          'Açık veya koyu tema ya da sisteme uyma',
          'Klavye kısayollarını Ayarlar’dan yeniden atayın',
        ],
      },
      sync: {
        label: 'Canlı eşitleme',
        heading: 'Notlarınızı tutan bir sunucu olmadan birlikte yazın.',
        lede: 'Bir notu iki cihazda açın, cihazlar doğrudan birbirine bağlansın. Birinde yazdığınız, siz yazarken diğerinde görünür.',
        details: [
          'Aynı not açık olan cihazlar birbirini kendiliğinden bulur',
          'Düzenlemeler uçtan uca şifreli bir QUIC bağlantısı (iroh) üzerinden iletilir',
          'Her iki cihazın da aynı GitHub eşitleme deposuna erişimi olmalıdır',
          'Myelin hesabı gerekmez',
        ],
      },
      agents: {
        label: 'Yapay zekâ ajanları',
        heading: 'Kendi yapay zekânızı, kendi bilgisayarınızda getirin.',
        lede: 'Myelin’de yerleşik bir sohbet botu yok. Bunun yerine yerel bir MCP sunucusu çalıştırır; böylece zaten kullandığınız yapay zekâ uygulaması notlarınızı okuyabilir ve izin verdiğinizde onlara yazabilir.',
        details: [
          'Sunucu yalnızca 127.0.0.1 üzerinde, seçtiğiniz bir portta dinler',
          'Ajanınızı bağlamak için kurulum istemini Ayarlar’dan kopyalayın',
          'Ajanlar notları, bağlantıları, sayfaları, PDF’leri, görselleri, el yazısını ve tuval ekran görüntülerini okuyabilir',
          'Ayarlar’da doğrudan MCP yazmalarını açana kadar yazma kapalı kalır',
          'Yazma açıkken ajanlar not, sayfa, LaTeX ve mürekkep oluşturabilir ve etiketleri düzenleyebilir',
        ],
      },
      connect: {
        label: 'Bul ve bağla',
        heading: 'Yazdığınız her şey bulunabilir kalır.',
        lede: 'Ses, arama ve bağlantılar notlarınızı birbirine bağlar; böylece geçen ayın fikri birkaç tuş uzaklıkta kalır.',
      },
      more: {
        label: 'Ve dahası',
        heading: 'Dosyalarınız, eşitlemeniz, diliniz.',
        lede: 'Temeller, tek bir listede.',
        details: [
          'Notlar diskinizde açık bir biçimde (Yjs) duran düz dosyalardır',
          'Hesap olmadan, tamamen çevrimdışı çalışır',
          'Kontrolü sizde olan bir GitHub deposu üzerinden cihazlar arasında eşitleyin',
          'Goodnotes, OneNote, Obsidian, Notion, Jupyter, Markdown ve PDF’lerden içe aktarın',
          'PDF, Markdown, Obsidian kasası veya çalışma alanı JSON’u olarak dışa aktarın',
          'Türkçe, İngilizce, İspanyolca, Fransızca ve Basitleştirilmiş Çince',
        ],
      },
    },
    clips: {
      shapes: {
        title: 'Şekil yakalama',
        body: 'Kabaca bir dikdörtgen, elips, üçgen veya çizgi çizin ve kalemi sabit tutun. Temiz bir şekle dönüşür.',
        alt: 'Kalemle çizilen kaba şekiller, kalem sabit tutulunca temiz şekillere dönüşüyor',
      },
      toolWheel: {
        title: 'Araç çarkı ve kalem hazır ayarları',
        body: 'Araçlarınızın ve kayıtlı kalemlerinizin çarkını tam yazdığınız yerde açmak için sağ tıklayın. Araç çubuğuna gitmeye gerek yok.',
        alt: 'Araç çarkı imlecin olduğu yerde açılıyor ve içinden kayıtlı bir kalem hazır ayarı seçiliyor',
      },
      ruler: {
        title: 'Cetvel',
        body: 'Cetveli açın, düğmesini istediğiniz açıya sürükleyin ve kusursuz düz bir çizgi için kenarı boyunca çizin.',
        alt: 'Cetvel 30 dereceye çevriliyor ve kenarı boyunca çizilen titrek bir çizgi kusursuz düz çıkıyor',
      },
      lasso: {
        title: 'Yazdıktan sonra toparlayın',
        body: 'Bir el yazısı parçasını kementle seçip yerine sürükleyin ya da yeniden boyutlandırmak için bir köşesinden çekin. Tek bir çizimi seçip üstündeki tutamaçla döndürün.',
        alt: 'El yazısı kementle seçilip başlığının altına sürükleniyor ve bir köşeden küçültülüyor, ardından bir ok ona doğru döndürülüyor',
      },
      pdfQuote: {
        title: 'PDF’lerden alıntı yapın',
        body: 'Bir PDF’te metin seçin, Alıntıla’yı seçin ve alıntıyı geldiği yere bağlantıyla bırakmak için bir sayfaya dokunun.',
        alt: 'Bir PDF’te seçilen bir cümle, PDF’e geri bağlantı veren bir alıntı bloğu olarak nota aktarılıyor',
      },
      pdfAnchor: {
        title: 'Sayfada kalan notlar',
        body: 'Bir PDF sayfasına yazdıklarınız o sayfaya bağlanır. PDF’i taşısanız veya düzenini değiştirseniz de notlarınız sayfada aynı yerde kalır. Sayfaya sabitle, görselleri ve şekilleri de aynı şekilde sabitler.',
        alt: 'Bir PDF’in 2. sayfasındaki bir formül daire içine alınıp açıklanıyor, ardından üstüne boş bir sayfa ekleniyor ve mürekkep sayfasıyla birlikte aşağı kayıyor',
      },
      slash: {
        title: '/ ile her şeyi ekleyin',
        body: 'Başlıklar, tablolar, bilgi kutuları, matematik ve kod için bir sayfada / yazın. mermaid kod bloğu bir diyagram çizer, Yerleştir ise bir bağlantıyı video veya bağlantı kartına dönüştürür.',
        alt: '/ menüsü, mermaid akış şeması diyagram olarak görüntülenen bir kod bloğu ekliyor, ardından Yerleştir bir YouTube bağlantısını video kartına dönüştürüyor',
      },
      imageAnchor: {
        title: 'Metninizle birlikte akan görseller',
        body: 'Bir görseli sayfaya sabitleyin, metin ona yer açsın. Üstüne yazın, görsel kelimelerle birlikte aşağı kaysın.',
        alt: 'Bir sayfadaki fotoğraf sabitleniyor, metin ona yer açıyor ve üstüne yazmak onu aşağı taşıyor',
      },
      jupyter: {
        title: 'Jupyter defterleri, içe aktarılmış',
        body: 'Bir .ipynb dosyasını içe aktarın; Markdown ve kod hücreleri bir sayfaya dönüşsün. Bir hücreyi çalıştırıp tablosunu veya grafiğini geri alın, ardından yanına kalemle notlarınızı yazın.',
        alt: 'Bir Jupyter defteri sayfa olarak içe aktarılıyor, bir pandas hücresi tabloya, bir matplotlib hücresi çizgi grafiğine dönüşüyor ve kalem zirveyi gösteren bir okla "launch week" yazıyor',
      },
      canvasStyle: {
        title: 'Her tuval için bir stil',
        body: 'Izgara, nokta, çizgi veya Pro ile kendi görselinizi seçin ve renkleri ayarlayın. Her tuvalin kendi stili olabilir; varsayılanı Ayarlar belirler.',
        alt: 'Tuval stili paneli arka planı çizgilere çeviriyor ve sıcak bir kâğıt rengi seçiyor',
      },
      flags: {
        title: 'Geri dönmek için bayraklar',
        body: 'Bayrak aracıyla (B) bir bayrak bırakın ve Yapılacak veya İncele gibi bir tür seçin ya da kendinizinkini oluşturun. Bir tuvaldeki bayraklar arasında geçin ya da tüm notlarınızda filtrelemek için Bayraklar’ı açın.',
        alt: 'Bir başlığa Yapılacak, bir PDF sayfasına İncele bayrağı ekleniyor, bayrak listesi PDF’e atlıyor, ardından Bayraklar sayfası notlar genelinde İncele bayraklarını filtreliyor',
      },
      liveCollab: {
        title: 'Canlı iş birliği',
        body: 'Siz çizdikçe mürekkep diğer ekranda çizgi çizgi, yazdıkça metin harf harf görünür; her iki yönde de.',
        alt: 'Mac’te çizilen mürekkep, yazıldığı anda Ada’nın bilgisayarında beliriyor, ardından Ada’nın yazdığı bir yapılacak Mac’te harf harf görünüyor',
      },
      agents: {
        title: 'Yapay zekâ uygulamanız, Myelin ile konuşuyor',
        body: 'Buradaki sohbet penceresi kullandığınız yapay zekâ uygulamasını temsil eder: Myelin’in bir parçası değildir. Bilgisayarınızdaki MCP üzerinden el yazınızı okur ve tuvale yazılı bir özet sayfası ekler.',
        alt: 'Ayrı bir yapay zekâ uygulaması, MCP üzerinden Myelin’deki el yazısı notları okuyor ve yanlarına yazılı bir özet sayfası ekliyor',
      },
      handwritingSearch: {
        title: 'El yazısı tanıma',
        body: 'Pro ile Myelin el yazınızı cihazınızda tanır; böylece tuvaldeki Bul ve kütüphane araması elle yazdığınız kelimeleri eşleştirir.',
        alt: 'Bul alanına “entropy” yazmak, onu içeren her el yazısı nota atlayıp onu seçiyor',
      },
    },
    notes: [
      {
        title: 'Ses kaydı',
        body: 'Bir dersi veya toplantıyı doğrudan tuvale kaydedin ya da bir sesli notu içe aktarın.',
      },
      {
        title: 'Cihazda yazıya dökme',
        body: 'Uygulamayla gelen bir Whisper modeli bilgisayarınızda yazıya döker. Oradan oynatmak için herhangi bir satırın zaman damgasına dokunun.',
      },
      {
        title: 'Arama',
        body: 'Kütüphanenizde başlığa, etiketlere ve kayıtlı metin ya da dökümlere göre arayın ve açık tuvaldeki herhangi bir kelimeyi bulun.',
      },
      {
        title: 'Bağlantılar ve geri bağlantılar',
        body: 'Notları [[çift köşeli parantez]] ile bağlayın, tüm geri bağlantıları görün ve notu önizlemek için bir bağlantının üzerine gelin.',
      },
      {
        title: 'Grafik görünümü',
        body: 'Notlarınızın birbirine nasıl bağlandığını görün ve herhangi birini grafikten açın.',
      },
      {
        title: 'İç içe etiketler',
        body: 'Notlarınızı etiketleyin, etiketleri iç içe yerleştirin ve kütüphaneyi herhangi birine göre filtreleyin.',
      },
      {
        title: 'Komut paleti',
        body: 'Klavyeden ayrılmadan bir not açın, yenisini oluşturun veya grafiği açın.',
      },
      {
        title: 'Sürüm geçmişi',
        body: 'Her not önceki sürümlerini saklar ve herhangi biri tek tıkla geri yüklenir.',
      },
    ],
    closing: {
      heading: 'Kendiniz görün.',
      body: 'Kişisel kullanım için ücretsiz, hesap gerekmez. Uygulamayı indirin ya da önce tarayıcınızda bir tuval deneyin.',
    },
  },

  pricing: {
    meta: {
      title: 'Fiyatlandırma | Myelin Notes',
      description: `Myelin Notes kişisel kullanım için ücretsizdir. Myelin Notes Pro; MCP üzerinden yapay zekâ ajanları, çalıştırılabilir kod, el yazısı tanıma ve daha yüksek sınırlar için ${formatPrice('tr', 'pro')} (öğrenciler için ${formatPrice('tr', 'student')}) tutarında tek seferlik bir satın almadır.`,
    },
    eyebrow: 'Fiyatlandırma',
    headline: 'Kullanımı ücretsiz. Daha fazlasını istediğinizde Pro.',
    subheadline:
      'Ücretsiz sürümde neredeyse her şey var. Pro, geri kalanların kilidini açan ve Myelin’in gelişimini destekleyen tek seferlik bir satın almadır.',
    free: {
      name: 'Ücretsiz',
      price: formatPrice('tr', 'free'),
      tagline: 'Kişisel kullanım için, süre sınırı olmadan.',
      includesLabel: 'İçerir',
      includes: [
        'El yazısı, PDF’ler, sayfalar ve sonsuz tuval',
        'Cihazda yazıya dökmeli ses kaydı',
        'GitHub eşitleme ve canlı iş birliği',
        'İçe aktarma, dışa aktarma, arama ve bağlantılar',
        '2’ye kadar bayrak türü',
        'Not başına 25’e kadar bayrak',
        '6’ya kadar özel kalem hazır ayarı',
      ],
      cta: 'İndir',
    },
    pro: {
      name: 'Pro',
      price: formatPrice('tr', 'pro'),
      priceNote: 'tek seferlik satın alma',
      tagline: 'Bir kez ödeyin. Abonelik yok.',
      includesLabel: 'Ücretsiz’deki her şey, artı',
      includes: [
        'Yerel bir MCP sunucusu üzerinden yapay zekâ ajanları',
        'Sayfalarınızda kod bloklarını çalıştırın',
        '8’e kadar bayrak türü',
        'Not başına sınırsız bayrak',
        '16’ya kadar özel kalem hazır ayarı',
        'Tuval arka planı olarak kendi görselleriniz',
        'Daha doğru yazıya dökme modelleri',
        'Aramanın yazdıklarınızı bulması için el yazısı tanıma',
        'Myelin’in gelişimini destekleyin',
      ],
      cta: 'Pro satın al',
      licenseNote:
        'E-postayla bir lisans anahtarı alırsınız. Pro’nun kilidini, herhangi bir platformdaki en fazla 3 cihazınızda açar.',
      checkoutFailed: 'Ödeme sayfası açılamadı. Lütfen tekrar deneyin.',
    },
    student: {
      name: 'Öğrenci',
      tagline: 'Okul e-posta adresi olan öğrenciler için Pro’daki her şey.',
      price: formatPrice('tr', 'student'),
      note: 'Okul e-posta adresinizi girin, size öğrenci ödeme sayfasının bağlantısını gönderelim.',
      emailLabel: 'Okul e-postası',
      submit: 'Bağlantı gönder',
      sending: 'Gönderiliyor…',
      sent: 'Öğrenci ödeme bağlantısı için gelen kutunuzu kontrol edin.',
      notAcademic:
        'Bunu bir okul e-posta adresi olarak tanımıyoruz. Okulunuz listede yoksa destekle iletişime geçin.',
      failed: 'Bağlantı gönderilemedi. Lütfen tekrar deneyin.',
      linkExpired:
        'Bu öğrenci bağlantısının süresi doldu. Aşağıdan yenisini isteyin.',
    },
    faqTitle: 'Fiyatlandırma soruları',
    faqs: [
      {
        question: 'Pro’nun kilidini nasıl açarım?',
        answer:
          'Pro’yu bu web sitesinden satın aldıktan sonra, Ayarlar → Myelin Notes Pro bölümüne gireceğiniz bir lisans anahtarını size e-postayla göndeririz. iPhone, iPad ve Android’de bunun yerine satın alırken kullandığınız e-postayı girersiniz.',
      },
      {
        question: 'Kaç cihazda kullanabilirim?',
        answer:
          'Bir anahtarı herhangi bir platformda en fazla 3 cihazda kullanabilirsiniz. Yeni bir cihaza taşımak için önce eski bir cihazda devre dışı bırakın.',
      },
      {
        question: 'Pro’yu App Store’dan veya Google Play’den alırsam ne olur?',
        answer:
          'Satın alımınız telefonunuzda veya tabletinizde Pro’nun kilidini açar ve seçtiğiniz ek bir platform için bir lisans anahtarıyla gelir. Anahtarı almak için telefonunuzda veya tabletinizde Ayarlar → Myelin Notes Pro bölümüne e-postanızı girin.',
      },
      {
        question: 'Öğrenci fiyatlandırması nasıl işliyor?',
        answer: `Yukarıya okul e-postanızı girin; okulunuzu tanırsak size Pro’yu ${formatPrice('tr', 'student')} karşılığında satın almanız için bir bağlantı göndeririz. Bağlantının süresi 24 saat sonra dolar.`,
      },
      {
        question: 'Abonelik mi?',
        answer: 'Hayır. Pro tek seferlik bir satın almadır.',
      },
      {
        question: 'Ücretsiz sürümde kalırsam notlarıma ne olur?',
        answer:
          'Hiçbir şey. Notlarınız diskinizdeki düz dosyalardır ve ücretsiz sürüm hepsini açar.',
      },
    ],
  },

  linkLabels: {
    features: 'Özellikler',
    pricing: 'Fiyatlandırma',
    privacy: 'Gizlilik',
    support: 'Destek',
  },

  footer: {
    nav: 'Alt bilgi',
    tagline: 'El yazısı, klavye ve PDF’ler. Tek not.',
    platforms: 'Mac · Windows · Linux · iPhone, iPad ve Android kapalı betada',
  },

  shots: {
    hero: 'Tek bir tuvalde bir PDF ve yazılı bir sayfa çerçevesi; bir kalem bir denklemi daire içine alıyor, nota bir ok çiziyor, bir satır yazılıyor ve elle "key result!" yazılıyor',
    pdf: 'Bayes teoremi üzerine bir ders slaydı PDF\'i; bir madde vurgulanıyor, formül kırmızı mürekkeple daire içine alınıyor ve yanına "flip it!" yazılıyor, ardından açıklamalı PDF dışa aktarılıyor',
    pageFrame:
      'Bir kontrol listesi ve çalışıp çıktısını yanında gösteren bir TypeScript kod bloğu içeren bir sayfa çerçevesi',
    audio:
      'Tuvale yerleştirilen bir ses kaydı kaydediliyor, yazıya dökülüyor, ardından "entropy" aranarak bulunuyor',
    graph:
      'Bir notun giden bağlantılarını ve geri bağlantılarını gösteren Myelin Notes grafik görünümü',
  },

  canvas: {
    addCustomColor: 'Özel renk ekleyin (hex, örn. #3b82f6)',
  },
};

export default tr;
