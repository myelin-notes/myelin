import type en from './en';

const tr: typeof en = {
  common: {
    close: 'Kapat',
    cancel: 'İptal',
    done: 'Bitti',
    clear: 'Temizle',
    copy: 'Kopyala',
    copied: 'Kopyalandı',
    you: 'Siz',
    none: 'Yok',
    never: 'Hiçbir zaman',
    or: 'veya',
  },
  plan: {
    title: 'Myelin Notes Pro’ya yükseltin',
    description:
      'Tek seferlik bir satın alma: geliştirmeyi destekleyin ve harika özelliklerin kilidini açın!',
    haveLicense: 'Lisansım var',
    features: {
      agents: {
        title: 'MCP üzerinden yapay zekâ ajanları',
        description:
          'Zaten kullandığınız yapay zekâ uygulaması notlarınızı okusun ve izin verdiğinizde onlara yazsın.',
      },
      code: {
        title: 'Kod bloklarını çalıştırın',
        description:
          'Bir sayfadaki kodu çalıştırın ve çıktısını hemen yanında görün.',
      },
      canvasImage: {
        title: 'Kendi tuval arka planınız',
        description: 'Notlarınızın arkasında istediğiniz görseli kullanın.',
      },
      transcription: {
        title: 'Daha doğru yazıya dökme',
        description:
          'Özellikle İngilizce dışındaki dillerde daha doğru yazıya döken, cihazda çalışan daha büyük modeller indirin.',
      },
      handwriting: {
        title: 'El yazınızda arama yapın',
        description:
          'Elle yazdığınız kelimeleri tuval aramasıyla bulun. Mürekkep cihazınızda tanınır.',
      },
      limits: {
        title: 'Daha yüksek sınırlar',
        description:
          '8’e kadar bayrak türü, not başına sınırsız bayrak ve 16 kalem hazır ayarı.',
      },
    },
    upgrade: 'Yükselt',
    purchaseFailed: 'Satın alma tamamlanamadı.',
  },
  tabBar: {
    library: 'Kütüphane',
    home: 'Ana sayfa',
    settings: 'Ayarlar',
  },
  updater: {
    action: 'Güncelle',
    installing: 'Güncelleniyor',
    available: (version: string) =>
      `${version} sürümü mevcut. Yükleyin ve yeniden başlatın.`,
    failed: 'Güncelleme başarısız oldu',
  },
  windowControls: {
    minimize: 'Simge durumuna küçült',
    maximize: 'Büyüt',
    restore: 'Geri yükle',
  },
  colorPicker: {
    customColor: 'Özel renk',
    addColor: 'Renk ekle',
  },
  sidebar: {
    searchPlaceholder: 'Kütüphanenizde arayın...',
    explorer: 'Gezgin',
    tags: 'Etiketler',
    collapse: 'Kenar çubuğunu daralt',
    expand: 'Kenar çubuğunu genişlet',
    close: 'Kenar çubuğunu kapat',
    resize: 'Kenar çubuğunu yeniden boyutlandır',
    resizeTags: 'Etiketleri yeniden boyutlandır',
    graph: 'Grafiği aç',
  },
  commandPalette: {
    title: 'Komut Paleti',
    placeholder: 'Komut ara...',
    searchPlaceholder: 'Not ara...',
    loading: 'Yükleniyor...',
    noCommandResults: 'Eşleşen komut yok',
    noNoteResults: 'Eşleşen not yok',
    noteResultDescription: 'Tuval notu',
    footer: 'Gezinmek için ok tuşları, çalıştırmak için Enter',
    sections: {
      commands: 'Komutlar',
      notes: 'Notlar',
      recent: 'Son notlar',
    },
    commands: {
      openNote: {
        label: 'Not aç',
        description: 'Son açılan veya eşleşen bir tuvale geçin',
      },
      createNote: {
        label: 'Not oluştur',
        description: 'Kütüphane kökünde yeni bir tuval başlatın',
      },
      openGraph: {
        label: 'Grafiği aç',
        description: 'Tuval notları arasındaki açık bağlantıları haritalayın',
      },
      openFlags: {
        label: 'Bayrakları aç',
        description: 'Tüm notlarınızdaki bayraklara göz atın ve düzenleyin',
      },
      importMarkdown: {
        label: 'Markdown içe aktar',
        description: 'Bir Markdown dosyasından tuval oluşturun',
      },
      importMarkdownToCanvas: {
        label: 'Markdown içe aktar',
        description: 'Bu tuvale bir Markdown sayfa çerçevesi ekleyin',
      },
      switchView: {
        label: 'Kütüphane görünümünü değiştir',
        description: 'Kütüphaneyi liste ve ızgara arasında değiştirin',
      },
      refreshRepository: {
        label: 'Depoyu yenile',
        description: 'En son uzak değişiklikleri kütüphaneye çekin',
      },
    },
    errors: {
      createNote: 'Not oluşturulamadı',
      refreshRepository: 'Depo yenilenemedi',
    },
  },
  library: {
    title: 'Dijital Kütüphane',
    emptyState: {
      title: 'Kütüphaneniz boş',
      description:
        'Fikirleri, notları ve araştırmaları toplamaya başlamak için bir tuval oluşturun.',
      cta: 'Yeni Tuval',
    },
    recentlyOpened: 'Son Açılanlar',
    betaFeedback: {
      title: 'Beta geri bildirimi',
      description:
        'Bir hata mı buldunuz, bir fikriniz mi var? Kısa bir formla bize iletin.',
    },
    searchPlaceholder: 'Stüdyoda ara...',
    explorer: 'Gezgin',
    sortLabel: (label: string) => `Sıralama: ${label}`,
    sortModes: {
      'name-asc': 'Ad (A-Z)',
      'name-desc': 'Ad (Z-A)',
      modified: 'Son değiştirilen',
      created: 'Son oluşturulan',
    },
    viewModeLabel: (label: string) => `Görünüm: ${label}`,
    viewModes: {
      tree: 'Liste',
      grid: 'Izgara',
    },
    fileTypes: {
      mcanvas: 'Tuval',
    },
    createNew: {
      button: 'Yeni',
      folder: 'Yeni Klasör',
      canvas: 'Yeni Tuval',
      import: 'İçe aktar',
      untitledCanvas: 'Adsız Tuval',
      unnamedFolder: 'Adsız Klasör',
    },
    importPicker: {
      title: 'İçe aktar',
      description: 'Kütüphanenize ne getirmek istediğinizi seçin.',
    },
    importSources: {
      files: {
        label: 'Dosyalar',
        description: 'Bilgisayarınızdan Markdown, PDF, görsel ve video.',
        title: 'Dosyaları İçe Aktar',
        scanning: 'Dosyalar okunuyor...',
        empty: 'Seçilen dosyaların hiçbiri içe aktarılamıyor',
        selected: (count: number) => `${count} dosya seçildi`,
        nativeFile:
          'Yerel .goodnotes dosyaları henüz desteklenmiyor. Bir Goodnotes klasörünü PDF olarak dışa aktarın, ardından ZIP dosyasını içe aktarın.',
        summary: (count: number) => `${count} dosya içe aktarıldı`,
      },
      jupyter_notebook: {
        label: 'Jupyter Notebook',
        description:
          'Markdown ve kod hücreleriyle bir .ipynb defteri. Biçim v4 veya daha yeni.',
        title: 'Jupyter Defterlerini İçe Aktar',
        scanning: 'Defterler okunuyor...',
        empty: 'Seçilen dosyaların hiçbiri defter değil',
      },
      goodnotes_zip: {
        label: 'Goodnotes’tan içe aktar',
        description: 'PDF olarak dışa aktarılmış bir Goodnotes klasörü.',
        title: 'Goodnotes ZIP İçe Aktar',
        scanning: 'Arşiv okunuyor...',
        empty: 'Bu ZIP dosyasında PDF bulunamadı',
        pdfs: (count: number) => `${count} PDF`,
        summary: (count: number) => `${count} PDF içe aktarıldı`,
      },
      onenote: {
        label: 'OneNote’tan içe aktar',
        description:
          'OneNote’tan dışa aktarılmış bir .onepkg defteri veya .one bölümü.',
        title: 'OneNote İçe Aktar',
        scanning: 'Defter okunuyor...',
        empty: 'Bu defterde sayfa bulunamadı',
        pages: (count: number) => `${count} sayfa`,
        sections: (count: number) => `${count} bölüm`,
        summary: (count: number) => `${count} sayfa içe aktarıldı`,
        skipped: (count: number) => `${count} sayfa içe aktarılamadı`,
        skippedSections: (count: number) => `${count} bölüm okunamadı`,
      },
      obsidian_vault: {
        label: 'Obsidian’dan içe aktar',
        description: 'Notları ve ekleriyle birlikte bir kasa klasörü.',
        title: 'Obsidian Kasasını İçe Aktar',
        scanning: 'Kasa taranıyor...',
        empty: 'Bu kasada desteklenen dosya bulunamadı',
      },
      workspace_json: {
        label: 'Çalışma Alanı JSON',
        description: 'Myelin’den dışa aktarılmış bir klasör.',
        title: 'Çalışma Alanı JSON İçe Aktar',
        scanning: 'Klasör taranıyor...',
        empty: 'Bu klasörde JSON not veya medya bulunamadı',
      },
    },
    importMarkdown: {
      unsupportedFile: 'Bir Markdown dosyası seçin (.md, .markdown veya .mdx).',
      failed: 'Markdown içe aktarma başarısız oldu',
    },
    importDialog: {
      notes: (count: number) => `${count} not`,
      media: (count: number) => `${count} medya dosyası`,
      skippedFiles: (count: number) =>
        `Desteklenmeyen ${count} dosya atlanacak`,
      conflict: {
        label: 'Bu adla bir klasör zaten var',
        rename: 'İkisini de koru (yeniden adlandır)',
        replace: 'Mevcut olanın yerine koy',
      },
      progress: {
        importing: (current: number, total: number) =>
          `${current} / ${total} içe aktarılıyor...`,
        preparing: 'İçe aktarma hazırlanıyor...',
        cancelling: 'İptal ediliyor...',
      },
      summary: {
        title: 'İçe aktarma tamamlandı',
        cancelled: 'İçe aktarma iptal edildi',
        imported: (notes: number, media: number) =>
          `${notes} not ve ${media} medya dosyası içe aktarıldı`,
        skipped: (count: number) => `Desteklenmeyen ${count} dosya atlandı`,
      },
      buttons: {
        import: 'İçe aktar',
        cancel: 'İptal',
        done: 'Bitti',
      },
    },
    repositoryLoading: 'Depo yükleniyor...',
    refreshRepository: {
      label: 'Depoyu yenile',
      loading: 'Depo yenileniyor...',
      failed: 'Depo yenileme başarısız oldu',
    },
    semanticTags: {
      title: 'Anlamsal Etiketler',
      empty: 'Henüz etiket yok',
      emptyHint: 'Kütüphanenizi filtrelemek için bir tane oluşturun.',
      insights: 'Stüdyo İstatistikleri',
      addTag: 'Yeni etiket',
      addChild: (tag: string) => `#${tag} altına etiket ekle`,
      toggleChildren: (tag: string) => `#${tag} altındaki etiketleri aç/kapat`,
      placeholder: 'Etiket adı...',
      deleteTag: (tag: string) => `#${tag} etiketini sil`,
      deleteUsedTitle: 'Kullanılan etiket silinsin mi?',
      deleteUsedDescription: (tag: string, count: number) =>
        `#${tag} etiketi ${count} öğede kullanılıyor. Silmek, eşleşen alt etiketleri de bu öğelerden kaldırır.`,
      deleteUsedAction: 'Etiketi sil',
      stats: {
        totalFiles: 'Toplam Dosya',
        folders: 'Klasörler',
        uniqueTags: 'Benzersiz Etiketler',
      },
    },
    explorerTree: {
      preparingIndex: 'Notlar dizine ekleniyor… Daha fazla sonuç görünebilir.',
      indexingUnavailable:
        'Notlar dizine eklenemedi. Kayıtlı içerik araması daha sonra yeniden denenecek.',
      indexingNotes: (indexed: number, total: number) =>
        `Notlar dizine ekleniyor… ${indexed}/${total}. Daha fazla sonuç görünebilir.`,
      indexingFailed: (count: number) => `${count} not dizine eklenemedi.`,
      repositorySetupRequired:
        'Depo kurulumu gerekli. Dosyaları görmek için kurulumu Ayarlar’da tamamlayın.',
      emptySearch: 'Sonuç bulunamadı',
      emptyFilter: 'Seçilen etiketlerle eşleşen öğe yok',
      emptyDefault: 'Henüz dosya yok',
      selectedCount: (count: number) => `${count} öğe`,
    },
    templates: {
      title: 'Şablonlar',
      blankCanvas: 'Boş tuval',
      fromTemplate: 'Şablondan',
      saveAsTemplate: 'Şablon olarak kaydet',
      newTemplate: 'Yeni şablon',
      importTemplate: 'Şablonu içe aktar',
      importFailed: 'Şablon içe aktarılamadı.',
      emptyFolder:
        'Yeni tuvalleri bir şablondan başlatın. Bir tuvali şablona dönüştürmek için üzerine uzun basın veya sağ tıklayın ve “Şablon olarak kaydet”i seçin.',
      exportTemplate: 'Şablonu dışa aktar',
      savedAsTemplate: (name: string) => `“${name}” şablon olarak kaydedildi`,
      saveFailed: 'Şablon kaydedilemedi.',
      exportFailed: 'Şablon dışa aktarılamadı.',
    },
    folderSettings: {
      menuItem: 'Klasör ayarları…',
      title: 'Klasör ayarları',
      defaultTemplate: 'Varsayılan şablon',
      defaultTemplateHint:
        'Bu klasörde düz “Yeni tuval” varsayılan şablonu kullanır.',
      noTemplate: 'Yok',
      nameRule: 'Yeni tuval adı',
      ruleNone: 'Yok',
      ruleCustom: 'Özel',
      ruleInherit: 'Üst klasörden devral',
      pattern: 'Ad deseni',
      insertToken: 'Değişken ekle',
      preview: 'Önizleme',
      save: 'Kaydet',
      saveFailed: 'Klasör ayarları kaydedilemedi.',
    },
    itemMenu: {
      moveTo: 'Taşı…',
      moveHere: 'Buraya taşı',
      workspace: 'Çalışma alanı',
      back: 'Geri',
      loadError: 'Klasörler yüklenemedi.',
      moveError: 'Öğeler taşınamadı.',

      rename: 'Yeniden adlandır',
      manageTags: 'Etiketleri Yönet',
      color: 'Renk',
      versionHistory: 'Sürüm Geçmişi',
      revealInFileManager: 'Dosya Yöneticisinde Göster',
      remove: 'Kaldır',
    },
    renameReferencesDialog: {
      title: 'Bağlantılı anmalar güncellensin mi?',
      description: (mentionCount: number, noteCount: number) =>
        `Diğer ${noteCount} nottaki ${mentionCount} bağlantılı anma, yeni adla eşleşecek şekilde yeniden yazılacak.`,
      always: 'Sormadan her zaman güncelle',
      yes: 'Güncelle',
      no: 'Atla',
    },
    tagDialog: {
      title: 'Etiketleri Yönet',
      description: (name: string) => `Etiketler: ${name}`,
      activeTags: 'Etkin Etiketler',
      noTags: 'Henüz etiket yok',
      available: 'Kullanılabilir',
      createNew: 'Yeni etiket oluştur',
      placeholder: 'Etiket adı...',
    },
  },
  flagsPage: {
    title: 'Bayraklar',
    searchPlaceholder: 'Bayrak, not, klasör ara...',
    empty: 'Henüz bayrak yok.',
    allTypes: 'Tümü',
    noMatches: 'Eşleşen bayrak yok.',
    loadFailed: 'Bayraklar yüklenemedi',
    selectAll: 'Tümünü seç',
    selected: (count: number) => `${count} seçildi`,
    changeType: 'Türü değiştir',
    delete: 'Sil',
    deleteTitle: (count: number) => `${count} bayrak silinsin mi?`,
    deleteDescription: 'Notlarından kaldırılacaklar.',
    editFailed: 'Bayraklar güncellenemedi',
  },
  graph: {
    title: 'Grafik',
    explicitLinks: 'Açık bağlantılar',
    searchPlaceholder: 'Grafikte ara...',
    recenter: 'Ortala',
    zoomIn: 'Yakınlaştır',
    zoomOut: 'Uzaklaştır',
    tags: 'Etiketler',
    openNote: 'Notu aç',
    emptySelection: 'Bağlantılarını incelemek için bir not seçin.',
    noCanvasNotes: 'Henüz tuval notu yok.',
    noLinks:
      'Bu grafiği bağlamak için notlar arasına açık bağlantılar ekleyin.',
    loadFailed: 'Grafik yüklenemedi.',
    outgoing: 'Giden bağlantılar',
    backlinks: 'Geri bağlantılar',
    graphStats: (notes: number, links: number) =>
      `${notes} not, ${links} bağlantı`,
    linkCount: (incoming: number, outgoing: number) =>
      `${outgoing} giden, ${incoming} geri bağlantı`,
  },
  versionHistory: {
    title: 'Sürüm Geçmişi',
    description: (name: string) => `Önceki sürümler: ${name}`,
    empty: 'Henüz sürüm yok',
    loadFailed: 'Sürüm geçmişi yüklenemedi',
    restore: 'Geri yükle',
    restoring: 'Geri yükleniyor...',
    restored: 'Sürüm geri yüklendi',
    restoreFailed: 'Sürüm geri yüklenemedi',
  },
  settings: {
    theme: {
      title: 'Tema',
      eyebrow: 'Görünüm',
      options: {
        light: 'Açık',
        dark: 'Koyu',
        system: 'Sistem',
      },
    },
    canvasStyle: {
      title: 'Tuval Stili',
      eyebrow: 'Yüzey Katmanı',
      options: {
        grid: 'Izgara',
        dots: 'Noktalar',
        blank: 'Boş',
        lines: 'Çizgiler',
        image: 'Görsel',
      },
      backgroundColor: {
        label: 'Arka plan rengi',
        description:
          'Desenin arkasındaki tuvali tema rengiyle veya seçtiğiniz bir renkle doldurun.',
        options: {
          theme: 'Varsayılan',
          custom: 'Özel',
        },
        confirm: 'Uygula',
      },
      sections: {
        pattern: 'Desen',
        colors: 'Renkler',
      },
      patternColor: {
        label: 'Desen rengi',
        description: 'Izgara, nokta veya çizgilerin rengi.',
      },
      image: {
        label: 'Arka plan görseli',
        description: 'Tuval boyunca döşenir. Büyük görseller küçültülür.',
        choose: 'Görsel seç',
        failed: 'Bu görsel yüklenemedi',
      },
      perCanvas: {
        button: 'Tuval stili',
        followingDefault:
          'Ayarlar’daki varsayılan kullanılıyor. Burada yapılan her değişiklik yalnızca bu tuvale uygulanır.',
        custom: 'Bu tuvalin kendi stili var.',
        reset: 'Varsayılanı kullan',
      },
    },
    language: {
      title: 'Dil',
      eyebrow: 'Arayüz',
    },
    input: {
      title: 'Giriş',
      eyebrow: 'Kalem ve Dokunma',
      mode: {
        label: 'Çizim girişi',
        description:
          'Kalem: ekran kalemiyle çizin, parmağınızla kaydırın. Dokunma: parmağınızla çizin, iki parmakla kaydırın veya yakınlaştırın.',
        options: {
          pen: 'Kalem',
          touch: 'Dokunma',
        },
      },
      penBarrelButtonImmediate: {
        label: 'Hemen silgiye geç',
        description:
          'Kalem düğmesine basılır basılmaz silgiye geçin. Kapalıyken geçiş, kalem kaldırıldıktan sonra uygulanır.',
      },
      toolbarSide: {
        label: 'Araç çubuğu tarafı',
        description:
          'Araç çubuğunun tuvalin hangi kenarında duracağı. Solak yazanlar sağı tercih edebilir.',
        options: {
          left: 'Sol',
          right: 'Sağ',
        },
      },
    },
    pageFrameEditing: {
      title: 'Sayfa Çerçevesi Düzenleme',
      eyebrow: 'Belge Görünümü',
      defaultPageLayout: {
        label: 'Varsayılan sayfa düzeni',
        description:
          'Yeni belgelerin içeriği nasıl düzenleyeceğini seçin. Sütunlar yalnızca PDF’lere, Kesintisiz yalnızca sayfa çerçevelerine uygulanır.',
        options: {
          vertical: 'Sayfalar',
          horizontal: 'Sütunlar',
          continuous: 'Kesintisiz',
        },
      },
      fitWholePage: {
        label: 'Düzenlerken tüm sayfayı sığdır',
        description:
          'Sayfa çerçevesi düzenleme moduna girerken tam sayfa yüksekliğini göstermek için uzaklaştırın.',
      },
      hoverPreview: {
        label: 'Not bağlantıları için üzerine gelince önizleme göster',
        description:
          'Bağlantılı bir notun üzerine geldiğinizde küçük resmini ve başlığını gösterin.',
      },
      requireModifier: {
        label: (key: string) =>
          `Bağlantıları izlemek için ${key} ile tıklamayı gerektir`,
        description: (key: string) =>
          `Kapalıyken normal bir tıklama not bağlantılarını ve köprüleri izler. Açıkken izlemek için ${key} tuşunu basılı tutun; böylece tek tıklamalar imleci yerleştirir.`,
      },
      renameReferences: {
        label:
          'Notları yeniden adlandırdıktan sonra bağlantıları her zaman güncelle',
        description:
          'Kapalıyken Myelin Notes, bir not yeniden adlandırıldıktan sonra bağlantılı anmaları değiştirmeden önce sorar.',
      },
    },
    repository: {
      title: 'Depo',
      eyebrow: 'Eşitleme',
      kinds: {
        local: {
          label: 'Yerel',
          description: 'Notlar yalnızca bu cihazda saklanır',
        },
        github: {
          label: 'GitHub',
          description: 'Özel bir GitHub deposuyla eşitleyin',
        },
        googleDrive: {
          label: 'Google Drive',
          description: 'Google Drive’ınızdaki bir klasörle eşitleyin',
        },
      },
      auth: {
        title: 'Depo Kimlik Doğrulaması',
        descriptions: {
          awaitingRedirect: (provider: string) =>
            `Tarayıcınızda ${provider} ile oturum açmayı tamamlayın`,
          connected: 'Oturum açma tamamlandı',
          unavailable: 'Kimlik doğrulama kullanılamıyor',
          signIn: 'Bu depoyu bağlamak için oturum açın',
        },
        errors: {
          readState: 'Kimlik doğrulama durumu okunamadı.',
          signIn: 'Oturum açılamadı.',
        },
        buttons: {
          signIn: 'Oturum aç',
          signOut: 'Oturumu kapat',
        },
        browserCallback: {
          title: (provider: string) => `${provider} hesabında oturum açıldı`,
          message: 'Bu sekmeyi kapatıp Myelin Notes’a dönebilirsiniz.',
        },
        notices: {
          credentialReset: (provider: string) =>
            `${provider} oturumunuzun süresi doldu ve sıfırlandı. Lütfen yeniden bağlanın.`,
        },
      },
      authStatus: {
        checking: 'Denetleniyor',
        authorizing: 'Yetkilendiriliyor',
        connected: 'Bağlı',
        disconnected: 'Bağlı değil',
      },
      sync: {
        title: 'Depo Eşitleme',
        queuedChanges: 'Sıradaki değişiklikler',
        lastSync: 'Son eşitleme',
        remoteRepository: 'Uzak Depo',
        driveFolder: 'Drive Klasörü',
        status: {
          setupRequired: {
            label: 'Kurulum gerekli',
            description:
              'Eşitlemeyi etkinleştirmek için oturum açın ve bir depo seçin.',
          },
          loading: {
            label: 'Yükleniyor',
            description:
              'Önbellekteki depo yükleniyor ve uzak depo denetleniyor.',
          },
          syncing: {
            label: 'Eşitleniyor',
            description: 'Uzak depoyla değişiklikler alışveriş ediliyor.',
          },
          pending: {
            label: 'Beklemede',
            description: (count: number, online: boolean) =>
              online
                ? `${count} değişiklik yüklenmek üzere sırada.`
                : `${count} değişiklik, uzak eşitleme düzelene kadar yerel olarak sırada.`,
          },
          issue: {
            label: 'Sorun',
            onlineDescription:
              'Depo yapılandırıldı, ancak son eşitleme denemesi başarısız oldu.',
            offlineDescription:
              'Uzak eşitleme kullanılamıyor. Önbellekteki veriler yerel olarak kullanılabilir.',
          },
          synced: {
            label: 'Eşitlendi',
            upToDate: 'Uzak depo güncel.',
            ready: 'Depo eşitlemeye hazır.',
          },
        },
      },
      fields: {
        owner: {
          select: 'Sahip seçin',
          loading: 'Hesap yükleniyor...',
          error: 'GitHub hesabı yüklenemedi.',
          you: 'Siz',
          org: 'Kuruluş',
        },
        repo: {
          pickOwner: 'Sahip seçin',
          select: 'Depo seçin',
          loading: 'Depolar yükleniyor...',
          error: 'Depolar yüklenemedi.',
          empty: 'Depo yok',
        },
        branch: {
          pickRepo: 'Depo seçin',
          select: 'Dal seçin',
          loading: 'Dallar yükleniyor...',
          error: 'Dallar yüklenemedi.',
          empty: 'Dal yok',
        },
        folder: {
          label: 'Drive klasörü adı',
          placeholder: 'Myelin',
          error: 'Drive klasörü açılamadı.',
        },
      },
    },
    dataExport: {
      title: 'Veriler',
      eyebrow: 'Çalışma Alanı',
      export: {
        label: 'Obsidian Kasası olarak dışa aktar',
        description:
          'Tüm çalışma alanınızı Obsidian uyumlu bir kasa olarak bir klasöre kaydedin. Notlar ön bilgili (frontmatter) Markdown’a dönüşür; diğer dosyalar kopyalanır ve klasör yapısı korunur.',
        button: 'Dışa aktar',
        defaultVaultName: 'Myelin Notes Kasası',
        loading: 'Obsidian kasası dışa aktarılıyor...',
        progress: (current: number, total: number) =>
          `${current} / ${total} dışa aktarılıyor...`,
        failed: 'Obsidian kasası dışa aktarılamadı',
        succeeded: (notes: number, media: number) =>
          `${notes} not ve ${media} medya dosyası dışa aktarıldı.`,
      },
      exportJson: {
        label: 'Çalışma Alanını JSON olarak dışa aktar',
        description:
          'Tüm çalışma alanınızı JSON olarak bir klasöre kaydedin. Her not; çizgilerini, metnini ve gömülü medyasını (ikili dosyalar base64 olarak) kodlayan bir JSON dosyasına dönüşür; diğer dosyalar kopyalanır ve klasör yapısı korunur.',
        button: 'Dışa aktar',
        defaultExportName: 'Myelin Notes JSON Dışa Aktarımı',
        loading: 'Çalışma alanı JSON olarak dışa aktarılıyor...',
        progress: (current: number, total: number) =>
          `${current} / ${total} dışa aktarılıyor...`,
        failed: 'JSON dışa aktarma başarısız oldu',
        succeeded: (notes: number, media: number) =>
          `${notes} not ve ${media} medya dosyası dışa aktarıldı.`,
      },
    },
    transcription: {
      title: 'Yazıya Dökme',
      eyebrow: 'Cihazda',
      label: 'Konuşmadan metne modeli',
      description:
        'Ses kayıtlarını aranabilir metne dönüştürür. Tamamen bu cihazda çalışır, bu yüzden ses cihazdan hiç çıkmaz. Büyük modeller daha doğrudur ama daha yavaştır.',
      models: {
        base: {
          label: 'Temel',
          description:
            'Her cihazda hızlı. Net konuşma için yeterli ama daha çok hata yapar.',
        },
        small: {
          label: 'Küçük',
          description:
            'Temel’den daha doğru. Çoğu tablet ve bilgisayarda iyi çalışır.',
        },
        'large-v3-turbo': {
          label: 'Large v3 Turbo',
          description:
            'En doğrusu. Yalnızca bilgisayarlar için, en iyi GPU ile çalışır. Eski makinelerde canlı dökümler geride kalabilir.',
        },
      },
      size: (megabytes: number) => `${megabytes} MB`,
      download: 'İndir',
      included: 'Dahil',
      delete: 'Modeli sil',
      downloadFailed: 'Model indirilemedi',
    },
    privacy: {
      title: 'Gizlilik',
      eyebrow: 'Kullanım Verileri',
      analytics: {
        label: 'Anonim kullanım analizlerini paylaş',
        description:
          'Myelin Notes’u geliştirmeye yardımcı olmak için anonim ürün analizleri ve hata raporları gönderin. Kapalıyken hiçbir şey gönderilmez.',
      },
      policy: {
        label: 'Gizlilik politikası',
        description:
          'Cihazınızdan neyin çıktığı, kimin aldığı ve ne kadar süre saklandığı. trymyelin.app’i tarayıcınızda açar.',
      },
    },
    mcp: {
      title: 'Model Context Protocol',
      eyebrow: 'Yapay Zekâ Ajanları',
      enabled: {
        label: 'Yerel MCP sunucusunu etkinleştir',
        description:
          'Çalışan bu Myelin Notes uygulamasını 127.0.0.1 üzerinde yerel yapay zekâ ajanlarına açın.',
      },
      port: {
        label: 'Yerel port',
        description: 'Alandan çıktığınızda sunucu yeni portta yeniden başlar.',
      },
      installPrompt: {
        label: 'Ajan kurulum istemi',
        description:
          'Ajanınızı çalışan bu uygulamaya bağlamak için bunu ajanınıza kopyalayın.',
        prompt: (endpoint: string) =>
          `Çalışan bu masaüstü uygulaması için Myelin Notes MCP sunucusunu kur. ${endpoint} uç noktasıyla Streamable HTTP kullan. Sunucuya myelin adını ver. Bu sunucu bu bilgisayara yereldir, bu yüzden Myelin Notes MCP etkin olarak açık kalmalıdır.`,
      },
      directWrites: {
        label: 'Doğrudan MCP yazmalarına izin ver',
        description:
          'Ajanların sayfa çerçeveleri oluşturmasına ve sayfa çerçevesi Markdown’ını değiştirmesine izin verin.',
      },
      startFailed: (port: number) =>
        `MCP sunucusu ${port} portunda başlatılamadı`,
    },
    keybinds: {
      title: 'Kısayol Tuşları',
      resetAll: 'Tümünü sıfırla',
      pressKey: 'Bir tuşa basın...',
      pressKeyOrButton: 'Bir tuşa veya düğmeye basın...',
      unbound: 'Atanmamış',
      empty: 'Henüz kayıtlı kısayol yok. Bir tuval açtığınızda görünürler.',
      categories: {
        app: 'Uygulama',
        canvas: 'Tuval',
        editor: 'Düzenleyici',
      },
      actions: {
        'app:command-palette': {
          label: 'Komut Paleti',
          description: 'Uygulama komutlarını ve not gezintisini açın',
        },
        'canvas:undo': {
          label: 'Geri Al',
          description: 'Son tuval değişikliğini geri alın',
        },
        'canvas:redo': {
          label: 'Yinele',
          description: 'Geri alınan son tuval değişikliğini yeniden uygulayın',
        },
        'canvas:select-all': {
          label: 'Tümünü Seç',
          description: 'Tuvaldeki her şeyi seçin',
        },
        'canvas:find': {
          label: 'Tuvalde Bul',
          description: 'Bu tuvaldeki metin ve el yazısında arayın',
        },
        'canvas:pan': {
          label: 'Kaydır',
          description: 'Tuvali sürüklemek için basılı tutun',
        },
        'canvas:delete': {
          label: 'Sil',
          description: 'Seçili öğeleri kaldırın',
        },
        'canvas:tool-select': {
          label: 'Seçim Aracı',
          description: 'Öğeleri seçin ve taşıyın',
        },
        'canvas:tool-pen': {
          label: 'Kalem Aracı',
          description: 'Kalemle çizin',
        },
        'canvas:tool-highlighter': {
          label: 'Vurgulayıcı Aracı',
          description: 'Yarı saydam mürekkeple vurgulayın',
        },
        'canvas:tool-eraser': {
          label: 'Silgi Aracı',
          description: 'Çizgileri silin',
        },
        'canvas:tool-text': {
          label: 'Metin Aracı',
          description: 'Yeni bir metin düğümü oluşturun',
        },
        'canvas:tool-flag': {
          label: 'Bayrak Aracı',
          description: 'Bayrak yerleştirin',
        },
        'canvas:tool-wheel': {
          label: 'Araç Çarkı',
          description: 'Araç çarkını imlecin olduğu yerde açın',
        },
        'canvas:flag-previous': {
          label: 'Önceki Bayrak',
          description: 'Bu tuvaldeki önceki bayrağa gidin',
        },
        'canvas:flag-next': {
          label: 'Sonraki Bayrak',
          description: 'Bu tuvaldeki sonraki bayrağa gidin',
        },
        'canvas:insert-frame': {
          label: 'Sayfa Çerçevesi Ekle',
          description: 'Tuvale yeni bir sayfa çerçevesi yerleştirin',
        },
        'canvas:insert-embed': {
          label: 'Medya Ekle',
          description: 'Görsel, PDF veya dosya ekleyin',
        },
        'editor:bold': {
          label: 'Kalın',
          description: 'Kalın biçimlendirmeyi aç/kapat',
        },
        'editor:italic': {
          label: 'İtalik',
          description: 'İtalik biçimlendirmeyi aç/kapat',
        },
        'editor:underline': {
          label: 'Altı Çizili',
          description: 'Altı çizili biçimlendirmeyi aç/kapat',
        },
        'editor:strikethrough': {
          label: 'Üstü Çizili',
          description: 'Üstü çizili biçimlendirmeyi aç/kapat',
        },
        'editor:code': {
          label: 'Kod',
          description: 'Satır içi kod biçimlendirmesini aç/kapat',
        },
      },
    },
    pro: {
      title: 'Myelin Notes Pro',
      eyebrow: 'Yükselt',
      active: 'Etkin',
      thanks: {
        label: 'Pro etkin',
        description:
          'Myelin’i desteklediğiniz için teşekkürler. Keyfini çıkarın!',
      },
      key: {
        label: 'Lisans anahtarı',
        description:
          'Satın alma e-postanızdaki anahtarı yapıştırın. Bir anahtar en fazla 3 cihazda çalışır.',
        descriptionAndroid:
          'Zaten bir lisans anahtarınız var mı? Buraya girin.',
        action: 'Etkinleştir',
      },
      buy: {
        label: 'Pro satın al',
        description: 'Myelin web sitesinden tek seferlik satın alma.',
        descriptionIos:
          'Apple cihazlarınızda Pro’nun kilidini açan tek seferlik satın alma.',
        descriptionAndroid: 'Google Play üzerinden tek seferlik satın alma.',
        action: 'Pro satın al',
      },
      restore: {
        label: 'Satın alımları geri yükle',
        description:
          'Bu Apple Kimliği ile zaten satın aldığınız Pro’nun kilidini açın.',
        action: 'Geri yükle',
        none: 'Bu Apple Kimliği için App Store satın alımı bulunamadı.',
      },
      email: {
        label: 'Zaten Pro’nuz var mı?',
        description:
          'Satın alırken kullandığınız e-posta adresini girin, size bir kod gönderelim.',
        codeSent: 'Size e-postayla gönderdiğimiz 8 haneli kodu girin.',
        codeLabel: 'Kod',
        send: 'Kod gönder',
        verify: 'Doğrula',
      },
      desktop: {
        label: 'Pro’yu bilgisayarınızda kullanın',
        description:
          'E-postanızı girin, size Mac, Windows veya Linux için bir lisans anahtarı gönderelim. 1 bilgisayarda çalışır.',
        send: 'Anahtar gönder',
        sent: 'Lisans anahtarınız için gelen kutunuzu kontrol edin.',
      },
      deactivate: {
        label: 'Bu cihaz',
        description:
          'Başka bir cihaza yer açmak için Pro’yu bu cihazdan kaldırın.',
        action: 'Devre dışı bırak',
      },
      errors: {
        invalid: 'Bu anahtar veya kod geçerli değil.',
        limit:
          'Bu anahtar zaten izin verilen sayıda cihazda etkin. Önce birinde devre dışı bırakın.',
        failed: 'Lisans sunucusuna ulaşılamadı. Lütfen tekrar deneyin.',
      },
    },
    about: {
      title: 'Hakkında',
      eyebrow: 'Uygulama',
      version: {
        label: 'Sürüm',
        description: 'Şu anda yüklü olan Myelin Notes sürümü.',
      },
    },
  },
  canvas: {
    openNoteLinkFailed: 'Not bağlantısı açılamadı',
    openBacklinkFailed: 'Geri bağlantı açılamadı',
    autocomplete: {
      suggestions: 'Otomatik tamamlama önerileri',
      searching: 'Aranıyor...',
      noMatches: 'Eşleşme yok.',
      loadFailed: 'Öneriler yüklenemedi.',
    },
    kind: 'Tuval',
    frame: {
      noteKind: 'Not',
      pdfKind: 'PDF',
      addBlankPage: 'Boş sayfa ekle',
      deletePage: 'Sayfayı sil',
      displayNameLabel: 'Sayfa çerçevesi görünen adı',
      menu: 'Menü',
      openMenu: 'Çerçeve menüsünü aç',
      rename: 'Yeniden adlandır',
      pages: 'Sayfalar',
      continuous: 'Kesintisiz',
      columns: 'Sütunlar',
      figureCaptionPlaceholder: 'Altyazı ekleyin',
      letterSize: 'Letter',
      a4Size: 'A4',
      customSize: 'Özel',
      customSizeHint:
        'Genişliği ayarlamak için sayfanın yan kenarlarını sürükleyin.',
      pageNumbers: 'Sayfa numaraları',
      pageSetup: 'Sayfa yapısı',
      pageSize: 'Boyut',
      pageMargins: 'Kenar boşlukları',
      inchesUnit: 'inç',
      export: 'Dışa aktar',
    },
    export: {
      title: 'Dışa aktar',
      exportCanvasPdf: 'Tuvali PDF olarak dışa aktar',
      format: 'Biçim',
      includeAnnotations: 'Ek açıklamaları dahil et',
      annotationsHint: 'Sayfadaki çizimler ve notlar',
      exporting: 'Dışa aktarılıyor…',
      tryAgain: 'Tekrar dene',
      exportedWithWarnings: 'Uyarılarla dışa aktarıldı',
      complete: 'Dışa aktarma tamamlandı',
    },
    search: {
      placeholder: 'Tuvalde bul',
      noResults: 'Sonuç yok',
      next: 'Sonraki eşleşme',
      previous: 'Önceki eşleşme',
    },
    codeOutput: {
      title: 'Kod çıktısı',
      running: 'Çalışıyor',
      stop: 'Durdur',
      stopped: 'Durduruldu',
      failed: 'Başarısız',
      exitCode: (code: number | null) => `Çıkış ${code}`,
      doneIn: (duration: string) => `${duration} içinde bitti`,
      empty: 'Çıktı yok',
      droppedLines: (count: number) => `… önceki ${count} satır atıldı`,
    },
    textFormatting: {
      bold: 'Kalın',
      italic: 'İtalik',
      underline: 'Altı çizili',
      strikethrough: 'Üstü çizili',
      font: 'Yazı tipi',
      color: 'Renk',
      sans: 'Sans',
      serif: 'Serif',
      mono: 'Mono',
      custom: 'Özel',
    },
    statusBar: {
      fps: (fps: number) => `${fps} fps`,
      fitContent: 'İçeriği görünüme sığdır',
      lockZoom: 'Yakınlaştırmayı kilitle',
      unlockZoom: 'Yakınlaştırma kilidini aç',
    },
    slashInsert: {
      pageBreak: {
        title: 'Sayfa sonu',
        subtitle: 'Yeni bir sayfa başlatın',
      },
      heading1: {
        title: 'Başlık 1',
        subtitle: 'Bu bloğu üst düzey bir başlığa dönüştürün',
      },
      heading2: {
        title: 'Başlık 2',
        subtitle: 'Bu bloğu bir bölüm başlığına dönüştürün',
      },
      heading3: {
        title: 'Başlık 3',
        subtitle: 'Bu bloğu küçük bir başlığa dönüştürün',
      },
      quote: {
        title: 'Alıntı',
        subtitle: 'Bu bloğu bir alıntı bloğuna dönüştürün',
      },
      callout: {
        title: 'Bilgi kutusu',
        subtitle: 'Vurgulanmış bir not kutusu ekleyin',
      },
      bulletList: {
        title: 'Madde işaretli liste',
        subtitle: 'Bu bloğu madde işaretli bir liste öğesine dönüştürün',
      },
      numberedList: {
        title: 'Numaralı liste',
        subtitle: 'Bu bloğu numaralı bir liste öğesine dönüştürün',
      },
      todo: {
        title: 'Yapılacak',
        subtitle: 'Bu bloğu işaretlenebilir bir yapılacak öğesine dönüştürün',
      },
      paragraph: {
        title: 'Paragraf',
        subtitle: 'Bu bloğu düz gövde metnine geri döndürün',
      },
      table: {
        title: 'Tablo',
        subtitle: 'Başlık ve gövde satırları olan bir tablo ekleyin',
      },
      codeBlock: {
        title: 'Kod bloğu',
        subtitle: 'Çitlenmiş bir kod bloğu ekleyin',
      },
      mathBlock: {
        title: 'Matematik bloğu',
        subtitle: 'Çitlenmiş bir matematik bloğu ekleyin',
      },
      bold: {
        title: 'Kalın',
        subtitle: '**kalın** markdown ekleyin',
      },
      italic: {
        title: 'İtalik',
        subtitle: '*italik* markdown ekleyin',
      },
      link: {
        title: 'Bağlantı',
        subtitle: '[etiket](url) markdown ekleyin',
      },
      noteLink: {
        title: 'Not bağlantısı',
        subtitle: 'Başka bir nota [[not]] bağlantısı ekleyin',
      },
      inlineCode: {
        title: 'Satır içi kod',
        subtitle: '`kod` markdown ekleyin',
      },
      embed: {
        title: 'Yerleştir',
        subtitle:
          '![alt](url) ekleyin: görseller, videolar, YouTube, bağlantı kartları',
      },
      today: {
        title: 'Bugün',
        subtitle: 'Bugünün tarihini ekleyin',
      },
      tomorrow: {
        title: 'Yarın',
        subtitle: 'Yarının tarihini ekleyin',
      },
      yesterday: {
        title: 'Dün',
        subtitle: 'Dünün tarihini ekleyin',
      },
      now: {
        title: 'Şimdi',
        subtitle: 'Geçerli tarih ve saati ekleyin',
      },
    },
    backlinks: {
      title: 'Geri bağlantılar',
      linkedMentions: 'Bağlantılı anmalar',
    },
    flags: {
      title: 'Bayraklar',
      untitled: 'Bayrak',
      pdfPage: (fileName: string, page: number) => `${fileName} · s.${page}`,
      rename: 'Yeniden adlandır',
      remove: 'Kaldır',
      previous: 'Önceki bayrak',
      next: 'Sonraki bayrak',
      changeType: 'Bayrak türünü değiştir',
    },
    flagTypes: {
      todo: 'Yapılacak',
      review: 'İncele',
      newFlag: 'Yeni bayrak',
      edit: 'Bayrağı düzenle',
      remove: 'Bayrağı sil',
      name: 'Bayrak adı',
      removeTitle: (name: string) => `“${name}” silinsin mi?`,
      removeDescription: (count: number) =>
        count === 1
          ? '1 bayrak bu türü kullanıyor. Notlarınızdan da silinecek.'
          : `${count} bayrak bu türü kullanıyor. Notlarınızdan da silinecekler.`,
      removeConfirm: 'Sil',
    },
    toolbar: {
      clickForOptions: 'seçenekler için tıklayın',
      customizeWheel: 'Araçlar ve hazır ayarlar',
      insert: 'Ekle',
      ruler: 'Cetvel',
      canvasTools: 'Tuval araçları',
    },
    selectionToolbar: {
      anchor: 'Sayfaya sabitle',
      unanchor: 'Sayfadan ayır',
      makeSpace: 'Sayfada yer aç',

      label: 'Seçim sırası',
      copy: 'Kopyala',
      copied: 'Panoya kopyalandı',
      cut: 'Kes',
      moveHigher: 'Öne getir',
      moveLower: 'Geriye gönder',
      delete: 'Sil',
      lock: 'Kilitle',
      unlock: 'Kilidi aç',
      crop: 'Kırp',
      applyCrop: 'Kırpmayı uygula',
      openSource: 'Kaynak bağlantısını aç',
      editPoints: 'Noktaları düzenle',
      finishEditingPoints: 'Nokta düzenlemeyi bitir',
      bold: 'Kalın',
      italic: 'İtalik',
    },
    pdfNavigator: {
      previousPage: 'Önceki sayfa',
      nextPage: 'Sonraki sayfa',
      goToPage: 'Sayfaya git',
      pageNumber: 'Sayfa numarası',
    },
    pdfQuote: {
      quote: 'Alıntıla',
      sourceMissing: 'Alıntılanan PDF bu notta değil.',
    },
    insert: {
      title: 'Ekle',
      soon: 'Yakında',
      paste: {
        label: 'Yapıştır',
        description: 'Panodan yapıştırın',
      },
      frame: {
        label: 'Sayfa çerçevesi',
        description: 'İçine yazacağınız yeni bir sayfa',
      },
      embed: {
        label: 'Görsel veya PDF',
        description: 'Dosyaları bırakın veya bir URL yapıştırın',
      },
      photo: {
        label: 'Fotoğraf çek',
        description: 'Bir fotoğraf çekip ekleyin',
      },
      latex: {
        label: 'LaTeX',
        description: 'Denklem yazabileceğiniz bir matematik bloğu',
      },
      audio: {
        label: 'Ses',
        description: 'Sesli not kaydedin veya içe aktarın',
      },
    },
    camera: {
      requesting: 'Kamera açılıyor...',
      unavailable: 'Kamera kullanılamıyor',
      takePhoto: 'Fotoğraf çek',
      cancel: 'İptal',
      captureFailed: 'Fotoğraf çekilemedi',
    },
    audioPlayer: {
      requestingMic: 'Mikrofon isteniyor...',
      requestingMicAccess: 'Mikrofon erişimi isteniyor',
      micUnavailable: 'Mikrofon kullanılamıyor',
      tapToRecord: 'Kaydetmek için dokunun',
      waitingForRecording: 'Kayıt bekleniyor',
      startRecording: 'Kaydı başlat',
      stopRecording: 'Kaydı durdur',
      processingRecording: 'Kayıt işleniyor...',
      tryRecordingAgain: 'Tekrar kaydetmeyi dene',
      playAudio: 'Sesi oynat',
      pauseAudio: 'Sesi duraklat',
      transcribe: 'Sesi yazıya dök',
      transcribing: 'Ses yazıya dökülüyor...',
      transcribingOn: (peer: string) => `${peer} üzerinde yazıya dökülüyor...`,
      transcriptionUnavailable:
        'Yazıya dökme, bunu destekleyen bir cihaz gerektirir',
      playFrom: (time: string) => `${time} konumundan oynat`,
      showTranscript: 'Dökümü göster',
      hideTranscript: 'Dökümü gizle',
      noSpeechDetected: 'Konuşma algılanmadı',
      transcriptionFailed: 'Yazıya dökme başarısız oldu',
    },
    toolShelf: {
      title: 'Araçlar ve hazır ayarlar',
      empty: 'Çark devre dışı - sağ tıklama onu açmaz.',
      tools: 'Araçlar',
      presets: 'Hazır ayarlar',
    },
    toolPresets: {
      label: (tool: string, size: number) => `${tool} · ${size}px`,
      save: 'Geçerli kalemi hazır ayar olarak kaydet',
      saveShort: 'Hazır ayar olarak kaydet',
      saveNeedsPen: 'Önce kalemi veya vurgulayıcıyı seçin.',
      saveFull: (max: number) => `Hazır ayarlar dolu - ${max} / ${max}.`,
      wheelFull: (max: number) => `Çark dolu - ${max} / ${max}.`,
      updateToCurrent: 'Geçerli olanla güncelle',
      showInWheel: 'Çarkta göster',
      removeFromWheel: 'Çarktan kaldır',
      toolbarLabel: 'Kalem hazır ayarları',
      delete: 'Hazır ayarı sil',
    },
    tools: {
      select: 'Seç',
      pen: 'Kalem',
      highlighter: 'Vurgulayıcı',
      eraser: 'Silgi',
      text: 'Metin',
      flag: 'Bayrak',
    },
    toolOptions: {
      color: 'Renk',
      stroke: 'Çizgi',
      size: 'Boyut',
      font: 'Yazı tipi',
      fontSize: 'Yazı Boyutu',
      mode: 'Mod',
      rectangle: 'Dikdörtgen',
      lasso: 'Kement',
      precise: 'Hassas',
      fine: (value: number) => `İnce (${value})`,
      medium: (value: number) => `Orta (${value})`,
      bold: (value: number) => `Kalın (${value})`,
      pressure: 'Basınç',
      stabilization: 'Sabitleme',
      lineStyle: 'Çizgi',
      solid: 'Düz',
      dashed: 'Kesikli',
      addCustomColor: 'Özel renk ekle',
      deleteColor: 'Rengi sil',
      decreaseFontSize: 'Yazı boyutunu küçült',
      increaseFontSize: 'Yazı boyutunu büyüt',
      flagType: 'Bayrak',
    },
    embedComposer: {
      dropToEmbed: 'Yerleştirmek için bırakın',
      title: 'Medya ekle',
      subtitle: 'Bir görsel veya PDF yapıştırın, bırakın ya da seçin.',
      readyToEmbed: 'Yerleştirmeye hazır',
      embedPdf: 'PDF yerleştir',
      embedImage: 'Görsel yerleştir',
      urlPlaceholder: 'Bir URL yapıştırın',
      fetch: 'Getir',
      browse: 'Göz atmak için tıklayın',
      dropFiles: 'veya dosyaları buraya bırakın',
      pasteFromClipboard: 'panodan yapıştırın',
      embedded: 'yerleştirildi',
      errors: {
        unsupportedUrl: 'Bu bağlantı bir görsele veya PDF’e işaret etmiyor.',
        fetchFailed: 'Bu bağlantı getirilemedi.',
        embedFailed: 'Bu dosya yerleştirilemedi.',
        unsupportedType: 'Desteklenmeyen medya türü',
        unsupportedDesc: (type: string) => `${type} şu anda desteklenmiyor`,
      },
    },
    peerSync: {
      title: 'Eşler Arası Eşitleme',
      host: 'iroh ile barındır',
      joinPlaceholder: 'Paylaşım kodu',
      join: 'Katıl',
      waitingForPeer: 'Eş bekleniyor...',
      shareCode: 'Bu kodu bir eşle paylaşın',
      connecting: 'Bağlanıyor...',
      connected: 'Bağlandı',
      sync: 'Eşitle',
      localPeer: 'Yerel eş',
      writer: 'Yazıcı',
      writerActive: 'Yazıcı etkin',
      standby: 'Beklemede',
      repository: 'Depo',
      lastRemoteSync: 'Son uzak eşitleme',
      remotePeers: 'Uzak eşler',
      noRemotePeers: 'Uzak eş yok',
      livePaused: 'Canlı eşitleme duraklatıldı',
      peerModes: {
        'owner-device': 'Sahip cihaz',
      },
      repositoryStatus: {
        localOnly: 'Yalnızca yerel',
        initializing: 'Başlatılıyor',
        offline: 'Çevrimdışı',
        queued: (count: number) => `${count} sırada`,
        remoteSynced: 'Uzakla eşitlendi',
        idle: 'Boşta',
      },
      sessionPhase: {
        idle: 'Boşta',
        pulling: 'Çekiliyor',
        pushing: 'Gönderiliyor',
        closed: 'Kapalı',
        live: (phase: string) => `Canlı / ${phase}`,
      },
    },
  },
  dialogs: {
    closeSrOnly: 'Kapat',
  },
  whatsNew: {
    title: 'Yenilikler',
    dismiss: 'Anladım',
    back: 'Geri',
    next: 'İleri',
    pdfQuote: {
      title: 'PDF’lerden alıntı yapın',
      description:
        'Bir PDF’te metin seçip Alıntıla’yı seçin, ardından alıntıyı geldiği yere bağlantıyla bırakmak için bir sayfaya dokunun.',
    },
    pdfAnchoring: {
      title: 'Notları PDF sayfalarına sabitleyin',
      description:
        'Bir PDF sayfasına yazdıklarınız o sayfaya bağlanır. PDF’i taşısanız veya düzenini değiştirseniz de notlarınız sayfada aynı yerde kalır. Sayfaya sabitle, görselleri ve şekilleri de aynı şekilde sabitler.',
    },
    flags: {
      title: 'Tuvalinizdeki yerleri bayrakla işaretleyin',
      description:
        'Bayrak bırakmak için Bayrak aracını (B) kullanın, türünü seçin veya kendinizinkini oluşturun. Tuvalin üstündeki listeden ya da [ ve ] tuşlarıyla bayraklar arasında geçin; tüm notlarınızdaki bayrakları görmek için sağ üstten Bayraklar’ı açın.',
    },
    canvasStyle: {
      title: 'Her tuvale kendi stilini verin',
      description:
        'Izgara, nokta, çizgi veya kendi görselinizi seçin ve renkleri ayarlayın. Tuval stili yalnızca bulunduğunuz tuvali değiştirir; varsayılanı Ayarlar belirler.',
    },
    ruler: {
      title: 'Cetvelle düz çizgiler çizin',
      description:
        'Araç çubuğundan Cetvel’i açın, açıyı ayarlamak için düğmesini sürükleyin ve kenarı boyunca çizin.',
    },
    rotate: {
      title: 'Görselleri, şekilleri ve çizimleri döndürün',
      description:
        'Birini seçin ve üstündeki tutamacı sürükleyin. 15°’lik adımlarla hizalamak için Shift’i basılı tutun.',
    },
  },
  onboarding: {
    skip: 'Kurulumu atla',
    back: 'Geri',
    continue: 'Devam',
    finish: 'Bitir',
    stepLabel: (current: number, total: number) => `Adım ${current} / ${total}`,
    welcome: {
      eyebrow: 'Hoş geldiniz',
      title: 'Myelin Notes',
      description:
        'El yazısı ve metin için sonsuz tuvalinizi birkaç hızlı adımda kurun.',
      language: 'Dil',
      start: 'Başlayın',
    },
    input: {
      eyebrow: 'Kalem ve Dokunma',
      title: 'Nasıl çizeceksiniz?',
      description:
        'Parmağınızın tuvalde ne yapacağını burada veya daha sonra Ayarlar’da değiştirebilirsiniz.',
    },
    privacy: {
      eyebrow: 'Gizlilik',
      title: 'Myelin Notes’u geliştirmeye yardım edin',
      description:
        'Analizler varsayılan olarak kapalıdır. Myelin Notes’u geliştirmeye yardımcı olmak için açın.',
      collected:
        'Hangi özellikleri kullandığınızı, uygulama sürümünü ve çökme raporlarını topluyoruz.',
      notCollected:
        'Notlarınızı, dosya adlarınızı veya el yazınızı asla toplamayız. Android’de Google’ın el yazısı tanıyıcısı Google’a kullanım ölçümleri gönderir, yazdıklarınızı asla göndermez.',
      policy: 'Gizlilik politikasını okuyun',
    },
    sync: {
      eyebrow: 'Eşitleme',
      title: 'Notlarınızı nereye kaydetmek istersiniz?',
      description:
        'Notlar bu cihaza kaydedilir, ancak yedeklemek ve cihazlar arasında eşitlemek için GitHub veya Google Drive bağlayabilirsiniz.',
      later: 'Bunu daha sonra Ayarlar’da kurabilirsiniz.',
      incomplete:
        'Depolama seçeneklerinden birinin kurulumunu tamamlamanız gerekir. Bunu daha sonra Ayarlar’da değiştirebilirsiniz.',
    },
    sample: {
      eyebrow: 'Tuval',
      title: 'Örnek bir tuvalle başlamak ister misiniz?',
      description:
        'Denemeniz için birkaç özellik içeren bir tuval oluşturacağız.',
      start: 'Tuvali aç',
      skip: 'Boş başla',
      canvasName: 'Başlarken',
      highlights: {
        frame:
          'Kod, matematik ve bir Mermaid diyagramı içeren bir sayfa çerçevesi',
        canvas: 'Yanındaki tuvale yerleştirilmiş metin ve LaTeX',
        syntax: 'Markdown kısayollarının listesi',
        checklist: 'Başlamanız için kısa bir kontrol listesi',
      },
    },
    starter: {
      frameName: 'Temeller',
      title: 'Başlarken',
      intro:
        'Bu bir sayfa çerçevesi, yani tuvalde duran bir belge. Onu taşıyabilir, yeniden boyutlandırabilir veya yanına başkalarını ekleyebilirsiniz.',
      tipTitle: 'Eklemek için / tuşuna basın',
      tipBody:
        'Başlık, tablo, kod, matematik, yerleştirme ve tarih eklemek için bir sayfa çerçevesinde `/` yazın.',
      codeHeading: 'Kod blokları',
      codeBody: 'Kod bloğu başlatmak için üç ters tırnak ve bir dil adı yazın.',
      mathHeading: 'Matematik',
      mathBody:
        '$E = mc^2$ gibi satır içi matematik cümlenin içinde kalır, `$$` ise matematiği kendi satırına koyar:',
      diagramHeading: 'Mermaid diyagramları',
      diagramBody:
        'Bir kod bloğunu diyagrama dönüştürmek için dilini `mermaid` olarak ayarlayın.',
      diagramNodes: {
        idea: 'Fikir',
        note: 'Not',
        canvas: 'Tuval',
      },
      syntaxHeading: 'Markdown kısayolları',
      syntaxColumns: {
        type: 'Bunu yazın',
        get: 'Elde edilen',
      },
      syntaxRows: {
        checklist: 'Bir kontrol listesi',
        callout: 'Yukarıdaki gibi bir bilgi kutusu',
        math: 'Bir matematik bloğu',
      },
      linkTip:
        'Başka bir nota bağlantı vermek için iki köşeli parantez yazın; otomatik tamamlama adı dolduracaktır.',
      mediaHeading: 'Görseller, PDF’ler ve video',
      mediaBody:
        'Bir dosyayı tuvale sürükleyin veya bir sayfada / yazıp Yerleştir’i seçin; bu YouTube bağlantılarında da çalışır.',
      checklistHeading: 'Kendiniz deneyin',
      checklistDone: 'Başlangıç tuvalini açın',
      checklistTodo1: 'Kendi sayfa çerçevenizi ekleyin',
      checklistTodo2: 'İçine bir şeyler yazın',
      canvas: {
        heading: 'Bu tuval',
        body: 'Üzerinde istediğiniz yere metin kutuları ve LaTeX blokları koyabilir, sonra onları taşıyabilir, yeniden boyutlandırabilir veya bir sayfanın yanına hizalayabilirsiniz.',
        latexCaption: 'Tuvaldeki bir LaTeX bloğu:',
        toolbarHint:
          'Başka bir şey eklemek için araç çubuğunun üstündeki + düğmesini kullanın.',
      },
    },
  },
  mediaMigration: {
    title: 'Depolama iyileştiriliyor',
    description:
      'Lütfen bu işlem bitene kadar Myelin’i açık tutun. Diğer cihazlarınızdaki Myelin’i de güncelleyin, aksi halde görseller, PDF’ler ve sesler orada boş görünebilir.',
    preparing: 'Hazırlanıyor…',
    progress: (completed: number, total: number) =>
      `${completed} / ${total} belge`,
    finishing: 'Yükleme tamamlanıyor…',
    unreachable:
      'Deponuza şu anda ulaşılamıyor. Yeniden erişilebilir olduğunda bu işlem kendiliğinden tamamlanacak.',
    continueWithoutWaiting: 'Beklemeden devam et',
  },
  shutdown: {
    title: 'Değişiklikler kaydediliyor…',
    description: 'Çıkmadan önce bekleyen değişiklikler deponuzla eşitleniyor.',
    progress: (count: number) => `${count} değişiklik eşitleniyor…`,
    forceQuit: 'Yine de çık',
    forceQuitHint:
      'Eşitlenmemiş değişiklikler sırada kalır ve bir sonraki açılışta yeniden denenir.',
  },
};

export default tr;
