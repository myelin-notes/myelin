import type { SiteCopy } from './index';

const fr: SiteCopy = {
  meta: {
    title:
      'Myelin Notes : une app de prise de notes locale pour l’écriture manuscrite, le texte et les PDF',
    description:
      'Myelin Notes est une app de prise de notes native et locale pour Mac, Windows et Linux, bientôt sur iPhone, iPad et Android : un seul canevas où écriture manuscrite, texte, PDF, images et audio vivent dans la même note, sur votre propre appareil. Entièrement gratuite pour un usage personnel.',
  },

  topbar: {
    nav: 'Site',
    download: 'Télécharger',
    language: 'Langue',
    beta: 'Bêta',
    betaNote:
      'Myelin Notes est en bêta, et les formules tarifaires peuvent changer.',
  },

  sceneLabels: {
    ink: 'PDF',
    pages: 'Pages',
    'audio-search': 'Audio et recherche',
    linked: 'Notes liées',
    sync: 'Synchro et collab',
    'local-first': 'Local d’abord',
    import: 'Import',
    download: 'Télécharger',
  },
  faqKicker: 'Questions',

  hero: {
    eyebrow:
      'Myelin Notes · une app de prise de notes qui vit sur votre machine',
    headline: 'Écriture manuscrite, texte et PDF. Une seule note.',
    headlineMark: 'Une seule note.',
    subheadline:
      'Myelin Notes est une app de prise de notes native et locale : un seul canevas où encre, texte enrichi, PDF, images et audio cohabitent. Vos notes restent sur votre machine, et vous pouvez tout de même éditer en direct avec d’autres, sans serveur.',
    trustLine:
      'Gratuite pour un usage personnel · Aucun compte requis · Vos notes ne sont jamais derrière un paywall',
    ctaPrimary: 'Télécharger',
    ctaSecondary: 'Essayer dans le navigateur',
  },

  tryIt: {
    title: 'Essayez Myelin Notes dans votre navigateur',
    description:
      'Un canevas Myelin pour dessiner, écrire et prendre des notes, directement dans votre navigateur, qui l’enregistre. Téléchargez l’app pour profiter de toutes les fonctions.',
    badge: 'Version web limitée',
    limited:
      'Ceci est une version web limitée. L’app propose aussi une bibliothèque de notes, la recherche, l’enregistrement audio, l’export PDF et la synchronisation.',
  },

  ink: {
    pdfHeading: 'Écrivez directement sur vos PDF.',
    pdfBody:
      'Déposez un PDF sur le canevas et annotez-le avec la même encre que tout le reste : entourez une équation, surlignez une ligne, griffonnez dans les marges. Quand vous avez terminé, exportez le PDF annoté.',
  },

  pages: {
    heading: 'De vrais documents, directement sur le canevas.',
    body: 'Les cadres de page sont de vrais documents en texte enrichi : raccourcis Markdown, titres, listes et cases à cocher, tableaux, maths et blocs de code, exécutables avec Pro.',
  },

  audioSearch: {
    heading: 'Enregistrez. Transcrivez. Retrouvez sur le canevas.',
    audioBody:
      'Enregistrez cours ou réunions sur le canevas. Un modèle Whisper base intégré les transcrit sur l’appareil : vous pouvez retrouver des mots dans la transcription sans envoyer l’audio ailleurs. Pro ajoute des modèles plus précis.',
    searchBody:
      'Recherchez dans la bibliothèque par titre, étiquette, texte enregistré et transcription audio. Vous pouvez aussi rechercher dans un canevas ouvert.',
  },

  linked: {
    heading: 'Vos notes, connectées.',
    body: 'Les [[liens de notes]], les liens entrants et les aperçus au survol gardent les idées voisines à un clic. La palette de commandes vous emmène n’importe où, et l’historique des versions par fichier restaure n’importe quel état antérieur d’une note.',
  },

  importing: {
    heading: 'Emportez vos anciennes notes avec vous.',
    body: 'Importez vos notes depuis d’autres apps',
    sources: [
      {
        id: 'goodnotes',
        label: 'Importer depuis Goodnotes',
        detail:
          'Importez votre contenu Goodnotes en l’exportant sous forme de zip de PDF.',
      },
      {
        id: 'onenote',
        label: 'Importer depuis OneNote',
        detail:
          'Importez votre contenu OneNote depuis un bloc-notes .onepkg ou une section .one.',
      },
      {
        id: 'obsidian',
        label: 'Importer depuis Obsidian',
        detail: 'Importez votre contenu Obsidian avec le dossier du coffre.',
      },
      {
        id: 'notion',
        label: 'Importer depuis Notion',
        detail:
          'Importez votre contenu Notion en l’exportant en Markdown et CSV.',
      },
    ],
  },

  localFirst: {
    heading: 'Tout reste sur votre machine.',
    lede: 'Aucun cloud au milieu. Vos notes sont des fichiers ordinaires sur votre propre disque, et Myelin fonctionne entièrement hors ligne.',
    bullets: [
      'Vos notes sont des fichiers ordinaires sur votre disque, dans un format ouvert et sans conflits (Yjs). Rien n’est jamais verrouillé.',
      'Tout fonctionne hors ligne, sans compte et sans serveur au milieu.',
      'Avec Pro, amenez votre propre IA : les modèles se connectent via un serveur MCP local, jamais un cloud choisi pour vous.',
      'Importez depuis Obsidian ou GoodNotes, exportez en PDF, images ou JSON, et lisez chaque ligne du code source sur GitHub.',
    ],
  },

  sync: {
    heading: 'Synchronisez et collaborez, sans serveur au milieu.',
    kicker:
      'L’édition en temps réel suppose d’habitude un serveur qui détient vos notes. Myelin connecte plutôt les appareils directement.',
    tiers: [
      {
        badge: 'Disponible',
        live: true,
        title: 'Collaboration en direct',
        body: 'Deux appareils ayant la même note ouverte se trouvent automatiquement, puis éditent en parallèle via une connexion QUIC chiffrée directe entre eux (iroh).',
      },
      {
        badge: 'Disponible',
        live: true,
        title: 'Synchronisation GitHub',
        body: 'Indiquez à Myelin un dépôt et une branche, et votre espace de travail se synchronise entre vos appareils via un dépôt que vous contrôlez.',
      },
      {
        badge: 'Bientôt',
        title: 'Invitations',
        body: 'Invitez quelqu’un dans une seule note sans lui confier tout le dépôt, avec des rôles propriétaire, éditeur et lecteur qui décident de ce qu’il peut faire.',
      },
    ],
  },

  download: {
    body: 'Disponible en français, anglais, espagnol et chinois simplifié.',
    cta: 'Télécharger Myelin Notes',
    platforms: [
      {
        key: 'mac',
        name: 'macOS',
        label: 'Télécharger pour macOS',
        sub: 'macOS 10.15+',
      },
      {
        key: 'windows',
        name: 'Windows',
        label: 'Télécharger pour Windows',
        sub: 'Windows 10+',
      },
      {
        key: 'linux',
        name: 'Linux',
        label: 'Télécharger pour Linux',
        sub: 'AppImage',
      },
      {
        key: 'ios',
        name: 'iOS',
        label: 'Télécharger pour iOS',
        sub: 'iPhone et iPad',
      },
      {
        key: 'android',
        name: 'Android',
        label: 'Télécharger pour Android',
        sub: 'Téléphone et tablette',
      },
    ],
    comingSoon: 'Bientôt disponible',
    mobileBadge:
      'iPhone, iPad et Android arrivent : les mêmes notes, pas une visionneuse au rabais',
    faqTitle: 'FAQ',
    faqMarkdown: `# FAQ

## Est-ce vraiment gratuit ?

Oui. La version gratuite est gratuite pour un usage personnel, sans limite de durée et avec presque toutes les fonctionnalités. Myelin Pro est un achat unique de 49,99 USD, ou 29,99 USD pour les étudiants, qui ajoute les agents IA via MCP, l’exécution de code et des limites plus élevées. Vos notes ne sont jamais derrière un paywall.

## Où sont stockées mes notes ?

En local, sous forme de fichiers sur votre machine. Synchronisation GitHub optionnelle si vous les voulez dans un dépôt que vous contrôlez.

## Faut-il un compte ?

Non. Myelin Notes n’a aucun système de compte : vous le téléchargez, vous l’ouvrez, et vos notes sont sur votre disque. Vous ne vous connectez à GitHub que si vous activez la synchronisation GitHub, et c’est votre compte chez GitHub, pas chez nous.

## Est-ce open source ?

Pas tout à fait. Le code source est public : chacun peut le lire et vérifier ce que l’app fait de ses notes, et son usage est gratuit à des fins personnelles et non commerciales. Il est publié sous licence PolyForm Strict 1.0.0, ce qui signifie que vous ne pouvez ni le redistribuer ni publier de versions modifiées, et qu’un usage commercial nécessite une licence séparée.

## Puis-je collaborer avec d’autres ?

Oui, en direct et de pair à pair, dès aujourd’hui. Il n’y a pas de compte Myelin et rien au milieu. Les appareils se trouvent via la synchronisation GitHub, donc les deux côtés doivent avoir accès au même dépôt. Les carnets partagés avec permissions arrivent en v1.0.

## Puis-je importer depuis une autre app ?

Oui. Myelin importe un coffre Obsidian, un bloc-notes OneNote .onepkg ou une section .one, un dossier Goodnotes exporté en PDF, des fichiers Markdown, PDF, images et vidéos isolés, et un dossier d’espace de travail exporté depuis Myelin lui-même. Notion passe par son propre export Markdown et CSV, que l’importeur de fichiers lit ; un importeur Notion dédié qui conserve la hiérarchie des pages est sur la feuille de route.

## Fonctionne-t-il hors ligne ?

Entièrement. L’édition, la recherche plein texte et sémantique, la reconnaissance d’écriture, la transcription audio, l’annotation de PDF et l’export tournent tous sur votre machine, donc l’app se comporte exactement pareil sans réseau. Seules la synchronisation GitHub et la collaboration en direct ont besoin d’une connexion, et les deux sont optionnelles.

## Et pour iPhone, iPad et Android ?

Bientôt. Aujourd’hui Myelin Notes tourne sur Mac, Windows et Linux. Les apps mobiles sont en développement, et ce sont des versions natives plutôt qu’une visionneuse au rabais : les mêmes notes, le même canevas et la même synchronisation que sur ordinateur, avec l’Apple Pencil sur iPad et le S Pen ou un stylet actif sur Android.
`,
  },

  features: {
    meta: {
      title: 'Fonctionnalités | Myelin Notes',
      description:
        'Tout ce que fait Myelin Notes : formes qui se redressent toutes seules, règle et préréglages de stylo pour l’écriture manuscrite, citations et encre ancrée dans les PDF, pages avec diagrammes Mermaid, agents IA via MCP local, et plus encore.',
    },
    eyebrow: 'Fonctionnalités',
    headline: 'Tout ce que fait Myelin Notes.',
    subheadline:
      'La page d’accueil montre l’essentiel. Voici le détail : les outils pour l’écriture manuscrite, les PDF, les pages et le canevas, et la façon dont ils s’articulent.',
    jumpNav: 'Sections',
    sections: {
      handwriting: {
        label: 'Écriture manuscrite',
        heading:
          'Une encre qui se comporte comme un stylo, avec des astuces que le papier n’a pas.',
        lede: 'Écrivez au stylet, au doigt ou à la souris. Myelin redresse ce que vous voulez droit et laisse votre écriture telle qu’elle est.',
        details: [
          'Stylos sensibles à la pression, avec une stabilisation réglable pour des traits plus sûrs',
          'Rejet de la paume, et un mode Stylet ou Tactile pour choisir ce que font vos doigts',
          'Le bouton du stylet passe à la gomme, tout de suite ou une fois le stylet levé',
          'Une gomme par trait, ou une gomme précise qui n’efface que ce qu’elle touche',
          'Sélection au rectangle ou au lasso, pour déplacer, copier, verrouiller ou réordonner',
          'Des couleurs personnalisées enregistrées une fois pour toutes, et du texte dans la police de votre choix',
        ],
      },
      pdfs: {
        label: 'PDF',
        heading:
          'Des PDF dans lesquels on travaille, pas seulement qu’on regarde.',
        lede: 'Annotez, citez et réorganisez vos PDF sur le même canevas que le reste de vos notes, puis exportez le résultat.',
        details: [
          'Exportez le PDF annoté une fois terminé',
          'Allez à n’importe quelle page avec le navigateur de pages',
          'Affichez un PDF en Pages, ou côte à côte en Colonnes',
          'Posez un drapeau sur une page de PDF pour y revenir',
          'Trouvez des mots dans vos PDF avec la recherche du canevas',
        ],
      },
      pages: {
        label: 'Pages',
        heading: 'Des pages qui font plus que contenir du texte.',
        lede: 'Les cadres de page sont des documents en texte enrichi sur le canevas. Tapez / pour insérer ce que vous voulez, ou écrivez simplement en Markdown.',
        details: [
          'Raccourcis Markdown pour les titres, listes, citations et la mise en forme',
          'Listes de tâches, encadrés et tableaux',
          'Blocs de maths, et blocs de code exécutables avec Pro',
          '[[Liens de notes]] avec aperçu au survol, mis à jour quand vous renommez une note',
          'Images, vidéos, YouTube et cartes de lien intégrés',
          'Mise en page Pages, Colonnes ou Continu',
        ],
      },
      canvas: {
        label: 'Canevas',
        heading: 'Un canevas infini où l’on ne se perd pas.',
        lede: 'Placez pages, PDF, images, audio et encre où vous voulez, et revenez à n’importe quel endroit en une touche.',
        details: [
          'Des images à rogner, faire pivoter, verrouiller et ancrer à une page',
          'Prenez une photo avec votre caméra et déposez-la directement',
          'Des blocs LaTeX pour les équations, partout sur le canevas',
          'Thème clair ou sombre, ou celui du système',
          'Raccourcis clavier modifiables dans les Réglages',
        ],
      },
      sync: {
        label: 'Synchronisation en direct',
        heading: 'Écrivez à plusieurs, sans serveur qui garde vos notes.',
        lede: 'Ouvrez une note sur deux appareils et ils se connectent directement l’un à l’autre. Ce que vous écrivez sur l’un apparaît sur l’autre au fil de l’écriture.',
        details: [
          'Les appareils ayant la même note ouverte se trouvent d’eux-mêmes',
          'Les modifications passent par une connexion QUIC chiffrée de bout en bout (iroh)',
          'Les deux appareils doivent avoir accès au même dépôt de synchronisation GitHub',
          'Aucun compte Myelin requis',
        ],
      },
      agents: {
        label: 'Agents IA',
        heading: 'Votre propre IA, sur votre propre machine.',
        lede: 'Myelin n’a pas de chatbot intégré. Il fait tourner un serveur MCP local, pour que l’app d’IA que vous utilisez déjà puisse lire vos notes et, si vous l’autorisez, y écrire. Les agents IA font partie de Myelin Pro.',
        details: [
          'Le serveur n’écoute que sur 127.0.0.1, sur le port de votre choix',
          'Copiez l’invite d’installation depuis les Réglages pour connecter votre agent',
          'Les agents peuvent lire notes, liens, pages, PDF, images, écriture manuscrite et captures du canevas',
          'L’écriture reste désactivée tant que vous n’activez pas les écritures MCP directes dans les Réglages',
          'Une fois l’écriture activée, les agents peuvent créer notes, pages, LaTeX et encre, et modifier les étiquettes',
        ],
      },
      connect: {
        label: 'Trouver et relier',
        heading: 'Tout ce que vous écrivez se retrouve.',
        lede: 'L’audio, la recherche et les liens relient vos notes, si bien que l’idée du mois dernier n’est qu’à quelques touches.',
      },
      more: {
        label: 'Et plus encore',
        heading: 'Vos fichiers, votre synchronisation, votre langue.',
        lede: 'L’essentiel, en une liste.',
        details: [
          'Vos notes sont des fichiers ordinaires sur votre disque, dans un format ouvert (Yjs)',
          'Fonctionne entièrement hors ligne, sans compte',
          'Synchronisation entre appareils via un dépôt GitHub que vous contrôlez',
          'Import depuis Goodnotes, OneNote, Obsidian, Notion, Markdown et PDF',
          'Export en PDF, en Markdown, en coffre Obsidian ou en JSON de l’espace de travail',
          'En anglais, espagnol, français et chinois simplifié',
        ],
      },
    },
    clips: {
      shapes: {
        title: 'Formes redressées',
        body: 'Tracez à main levée un rectangle, une ellipse, un triangle ou une ligne, puis gardez le stylet immobile. La forme devient nette.',
        alt: 'Des formes tracées à main levée deviennent nettes quand le stylet reste immobile',
      },
      toolWheel: {
        title: 'Roue d’outils et préréglages de stylo',
        body: 'Un clic droit ouvre une roue de vos outils et stylos enregistrés, là où vous écrivez. Inutile de remonter à la barre d’outils.',
        alt: 'La roue d’outils s’ouvre au curseur et un stylo enregistré y est choisi',
      },
      ruler: {
        title: 'Règle',
        body: 'Activez la Règle, faites glisser sa poignée jusqu’à l’angle voulu et tracez le long de son bord pour une ligne parfaitement droite.',
        alt: 'La règle est tournée à 30 degrés et un trait tremblant le long de son bord devient parfaitement droit',
      },
      lasso: {
        title: 'Rangez après avoir écrit',
        body: 'Entourez un passage manuscrit au lasso pour le déplacer, ou tirez un coin pour le redimensionner. Sélectionnez un seul dessin pour le faire pivoter avec la poignée au-dessus.',
        alt: 'Un passage manuscrit est entouré au lasso, glissé sous son titre et réduit par un coin, puis une flèche pivote pour le désigner',
      },
      pdfQuote: {
        title: 'Citez vos PDF',
        body: 'Sélectionnez du texte dans un PDF, choisissez Citer et touchez une page pour l’y déposer, avec un lien vers sa source.',
        alt: 'Une phrase sélectionnée dans un PDF est citée dans une note sous forme de bloc de citation qui renvoie au PDF',
      },
      pdfAnchor: {
        title: 'Des notes qui restent sur la page',
        body: 'Ce que vous écrivez sur une page de PDF est attaché à cette page. Si vous déplacez le PDF ou changez sa disposition, vos notes restent au même endroit de la page. Ancrer à la page fixe aussi les images et les formes.',
        alt: 'Une formule de la page 2 d’un PDF est entourée et annotée, puis le PDF passe en Colonnes et l’encre suit sa page',
      },
      slash: {
        title: 'Insérez tout avec /',
        body: 'Tapez / dans une page pour les titres, tableaux, encadrés, maths et code. Un bloc de code mermaid dessine un diagramme, et Intégration transforme un lien en vidéo ou en carte de lien.',
        alt: 'Le menu / insère un bloc de code dont l’organigramme mermaid s’affiche en diagramme, puis Intégration transforme un lien YouTube en carte vidéo',
      },
      imageAnchor: {
        title: 'Des images qui suivent le texte',
        body: 'Ancrez une image à une page et le texte lui fait de la place. Écrivez au-dessus et l’image descend avec les mots.',
        alt: 'Une photo est ancrée dans une page, le texte lui fait de la place, puis la saisie au-dessus la fait descendre',
      },
      canvasStyle: {
        title: 'Un style pour chaque canevas',
        body: 'Choisissez une grille, des points, des lignes ou, avec Pro, votre propre image, et réglez les couleurs. Chaque canevas peut avoir le sien, et les Réglages fixent celui par défaut.',
        alt: 'Le panneau Style du canevas passe le fond en lignes et choisit une couleur de papier chaude',
      },
      flags: {
        title: 'Des drapeaux pour y revenir',
        body: 'Posez un drapeau avec l’outil Drapeau (B) et choisissez un type comme À faire ou À revoir, ou créez le vôtre. Passez d’un drapeau à l’autre sur un canevas, ou ouvrez Drapeaux pour les filtrer dans toutes vos notes.',
        alt: 'Un titre reçoit un drapeau À faire et une page de PDF un drapeau À revoir, la liste des drapeaux saute au PDF, puis la page Drapeaux filtre les drapeaux À revoir de toutes les notes',
      },
      liveCollab: {
        title: 'Collaboration en direct',
        body: 'L’encre apparaît sur l’autre écran trait par trait pendant que vous dessinez, et le texte lettre par lettre, dans les deux sens.',
        alt: 'L’encre tracée sur un Mac apparaît sur le PC d’Ada au fil de l’écriture, puis une tâche saisie par Ada apparaît lettre par lettre sur le Mac',
      },
      agents: {
        title: 'Votre app d’IA, en dialogue avec Myelin',
        body: 'La fenêtre de discussion représente l’app d’IA que vous utilisez : elle ne fait pas partie de Myelin. Via MCP sur votre machine, elle lit votre écriture manuscrite et ajoute au canevas une page de résumé tapé.',
        alt: 'Une app d’IA distincte lit des notes manuscrites dans Myelin via MCP et ajoute à côté une page de résumé tapé',
      },
    },
    notes: [
      {
        title: 'Enregistrement audio',
        body: 'Enregistrez un cours ou une réunion directement sur le canevas, ou importez un mémo vocal.',
      },
      {
        title: 'Transcription sur l’appareil',
        body: 'Un modèle Whisper intégré transcrit sur votre machine. Touchez l’horodatage d’une ligne pour lire à partir de là.',
      },
      {
        title: 'Recherche',
        body: 'Cherchez dans votre bibliothèque par titre, étiquettes, texte enregistré ou transcriptions, et trouvez n’importe quel mot sur le canevas ouvert.',
      },
      {
        title: 'Liens et liens entrants',
        body: 'Reliez vos notes avec des [[doubles crochets]], voyez chaque lien entrant et survolez un lien pour prévisualiser la note.',
      },
      {
        title: 'Vue graphe',
        body: 'Voyez comment vos notes sont reliées, et ouvrez n’importe laquelle depuis le graphe.',
      },
      {
        title: 'Étiquettes imbriquées',
        body: 'Étiquetez vos notes, imbriquez les étiquettes les unes dans les autres et filtrez la bibliothèque par n’importe laquelle.',
      },
      {
        title: 'Palette de commandes',
        body: 'Ouvrez une note, créez-en une ou ouvrez le graphe sans lâcher le clavier.',
      },
      {
        title: 'Historique des versions',
        body: 'Chaque note conserve ses versions antérieures, et chacune se restaure en un clic.',
      },
    ],
    closing: {
      heading: 'Essayez par vous-même.',
      body: 'Gratuit pour un usage personnel, sans compte. Téléchargez l’app, ou essayez d’abord un canevas dans votre navigateur.',
    },
  },

  pricing: {
    meta: {
      title: 'Tarifs | Myelin Notes',
      description:
        'Myelin Notes est gratuit pour un usage personnel. Myelin Pro est un achat unique de 49,99 USD, ou 29,99 USD pour les étudiants, pour les agents IA via MCP, l’exécution de code et des limites plus élevées.',
    },
    eyebrow: 'Tarifs',
    headline: 'Gratuit à l’usage. Pro quand vous voulez plus.',
    subheadline:
      'La version gratuite a presque tout. Pro est un achat unique qui débloque le reste et soutient le développement de Myelin.',
    free: {
      name: 'Gratuit',
      price: '0 USD',
      tagline: 'Pour un usage personnel, sans limite de durée.',
      includesLabel: 'Inclus',
      includes: [
        'Écriture manuscrite, PDF, pages et le canevas infini',
        'Enregistrement audio avec transcription sur l’appareil',
        'Synchronisation GitHub et collaboration en direct',
        'Import, export, recherche et liens',
        'Jusqu’à 6 préréglages de stylo personnalisés',
        '2 types de drapeau',
      ],
      cta: 'Télécharger',
    },
    pro: {
      name: 'Pro',
      price: '49,99 USD',
      priceNote: 'achat unique',
      tagline: 'Un seul paiement. Pas d’abonnement.',
      includesLabel: 'Tout ce qu’offre Gratuit, plus',
      includes: [
        'Agents IA via un serveur MCP local',
        'Exécution des blocs de code dans vos pages',
        'Types de drapeau illimités',
        'Préréglages de stylo personnalisés illimités',
        'Vos propres images en fond de canevas',
        'Modèles de transcription plus précis',
        'Soutenir le développement de Myelin',
      ],
      cta: 'Acheter Pro',
      licenseNote:
        'Vous recevez une clé de licence par e-mail. Elle débloque Pro sur jusqu’à 3 de vos appareils.',
    },
    student: {
      name: 'Étudiant',
      tagline:
        'Tout Pro, pour les étudiants ayant une adresse e-mail d’établissement.',
      price: '29,99 USD',
      note: 'Saisissez l’adresse e-mail de votre établissement et nous vous enverrons un lien vers le paiement au tarif étudiant.',
      emailLabel: 'E-mail de l’établissement',
      submit: 'Envoyer le lien',
      sending: 'Envoi…',
      sent: 'Consultez votre boîte de réception : le lien vous a été envoyé.',
      notAcademic:
        'Nous ne reconnaissons pas cette adresse comme celle d’un établissement. Contactez l’assistance si votre établissement manque.',
      failed: 'Nous n’avons pas pu envoyer le lien. Veuillez réessayer.',
    },
    faqTitle: 'Questions sur les tarifs',
    faqs: [
      {
        question: 'Comment débloquer Pro ?',
        answer:
          'Achetez Pro et vous recevez une clé de licence par e-mail. Saisissez-la dans l’app Myelin pour débloquer Pro sur cet appareil.',
      },
      {
        question: 'Sur combien d’appareils puis-je l’utiliser ?',
        answer:
          'Une clé de licence débloque Pro sur jusqu’à 3 de vos appareils.',
      },
      {
        question: 'Est-ce un abonnement ?',
        answer: 'Non. Pro est un achat unique.',
      },
      {
        question: 'Comment fonctionne le tarif étudiant ?',
        answer:
          'Saisissez l’adresse e-mail de votre établissement sur cette page. Si elle appartient à un établissement reconnu, nous vous envoyons un lien pour acheter Pro à 29,99 USD. Le lien est valable 24 heures.',
      },
      {
        question:
          'Qu’arrive-t-il à mes notes si je reste sur la version gratuite ?',
        answer:
          'Rien. Vos notes sont de simples fichiers sur votre disque, et la version gratuite les ouvre toutes.',
      },
    ],
  },

  linkLabels: {
    features: 'Fonctionnalités',
    pricing: 'Tarifs',
    privacy: 'Confidentialité',
    support: 'Assistance',
  },

  footer: {
    nav: 'Pied de page',
    tagline: 'Écriture manuscrite, texte et PDF. Une seule note.',
    platforms: 'Mac · Windows · Linux · iPhone, iPad et Android bientôt',
  },

  shots: {
    hero: 'Un PDF et un cadre de page saisi sur un même canevas : le stylet entoure une équation, trace une flèche vers la note, une ligne est tapée et « key result! » est écrit à la main',
    pdf: 'Un PDF dont une phrase est surlignée, une ligne soulignée et « E = mc² ! » écrit dans la marge, puis le PDF annoté est exporté',
    pageFrame:
      'Un cadre de page avec une liste de tâches et un bloc de code TypeScript qui s’exécute et affiche sa sortie à côté',
    audio:
      'Un enregistrement audio placé sur le canevas, enregistré, transcrit, puis retrouvé en cherchant « entropy »',
    graph:
      'La vue graphe de Myelin Notes, montrant les liens sortants et entrants d’une note',
  },

  canvas: {
    addCustomColor: 'Ajouter une couleur personnalisée (hex, ex. #3b82f6)',
  },
};

export default fr;
