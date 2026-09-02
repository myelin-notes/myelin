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
  },

  sceneLabels: {
    hero: 'Myelin',
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
    headline: 'Écriture manuscrite, texte\net PDF. Une seule note.',
    subheadline:
      'Myelin Notes est une app de prise de notes native et locale : un seul canevas où encre, texte enrichi, PDF, images et audio cohabitent. Vos notes restent sur votre machine, et vous pouvez tout de même éditer en direct avec d’autres, sans serveur.',
    trustLine:
      'Entièrement gratuite pour un usage personnel · Aucun compte requis · Vos notes ne sont jamais derrière un paywall',
    ctaPrimary: 'Télécharger',
    ctaSecondary: 'Voir en action',
  },

  ink: {
    annotation: 'dessinez une forme + maintenez. essayez !',
    recognized: 'reconnue !',
    pdfHeading: 'Écrivez directement\nsur vos PDF.',
    pdfBody:
      'Déposez un PDF sur le canevas et annotez-le avec la même encre que tout le reste : entourez une équation, surlignez une ligne, griffonnez dans les marges. Quand vous avez terminé, exportez le PDF annoté.',
    pdfAnnotation: 'l’encre va directement sur la page',
  },

  pages: {
    heading: 'De vrais documents,\ndirectement sur le canevas.',
    body: 'Les cadres de page sont de vrais documents en texte enrichi : raccourcis Markdown, titres, listes et cases à cocher, tableaux, maths et blocs de code exécutables.',
    annotation: 'une vraie page éditable. cliquez dedans.',
    pageTitle: 'Cours 12 · Potentiels d’action',
    pageMarkdown: `# Potentiels d’action

Le potentiel de repos du neurone se situe près de **-70 mV**, maintenu par la pompe sodium-potassium.

## Aujourd’hui

- [x] Rappel sur le potentiel de repos
- [ ] Dépolarisation et cascade des canaux Na+
- [ ] Pourquoi la myéline accélère la conduction

| Phase | Canal | Sens |
| --- | --- | --- |
| Dépolarisation | Na+ s’ouvre | entrant |
| Repolarisation | K+ s’ouvre | sortant |

Le potentiel de membrane suit :

$$V_m = \\frac{RT}{F} \\ln \\frac{[K^+]_{out}}{[K^+]_{in}}$$

\`\`\`python
tau = 2.0  # constante de temps membranaire, ms
v = -70.0
for step in range(3):
    v += (0 - v) / tau
    print(round(v, 1))
\`\`\`
`,
  },

  audioSearch: {
    heading: 'Enregistrez. Retrouvez.\nMême votre écriture.',
    audioBody:
      'Enregistrez cours ou réunions sur le canevas. Un modèle Whisper base intégré les transcrit sur l’appareil : chaque enregistrement devient cherchable et aucun audio ne quitte votre machine.',
    searchBody:
      'La recherche plein texte et sémantique tourne en local, sur un modèle all-MiniLM-L6-v2 intégré. L’écriture manuscrite est reconnue sur macOS via le framework Vision d’Apple, et les transcriptions audio sont cherchables aussi.',
    audioMock: {
      title: 'Cours 12 · Potentiels d’action',
      duration: '48:12',
      transcriptLabel: 'Transcription · sur l’appareil',
      transcript:
        '…la gaine de myéline isole l’axone, si bien que le signal saute de nœud en nœud au lieu de ramper…',
      match: 'gaine de myéline',
    },
    searchMock: {
      query: 'nœud de ranvier',
      results: [
        {
          kind: 'page',
          title: 'Cours 12 · Potentiels d’action',
          snippet: '…le signal saute entre les nœuds de Ranvier…',
        },
        {
          kind: 'ink',
          title: 'Tableau blanc · schéma de myélinisation',
          snippet: 'Correspondance manuscrite, OCR sur l’appareil',
        },
        {
          kind: 'audio',
          title: 'Enregistrement · Cours 12',
          snippet: 'Correspondance dans la transcription à 31:42',
        },
      ],
    },
  },

  linked: {
    heading: 'Vos notes, connectées.',
    body: 'Les [[liens de notes]], les liens entrants et les aperçus au survol gardent les idées voisines à un clic. La palette de commandes vous emmène n’importe où, et l’historique des versions par fichier restaure n’importe quel état antérieur d’une note.',
  },

  importing: {
    heading: 'Emportez vos anciennes\nnotes avec vous.',
    body: 'Importez vos notes depuis d’autres apps',
    annotation: 'sans copier-coller.',
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
    heading: 'Tout reste\nsur votre machine.',
    lede: 'Aucun cloud au milieu. Vos notes sont des fichiers ordinaires sur votre propre disque, et Myelin fonctionne entièrement hors ligne.',
    bullets: [
      'Vos notes sont des fichiers ordinaires sur votre disque, dans un format ouvert et sans conflits (Yjs). Rien n’est jamais verrouillé.',
      'Tout fonctionne hors ligne, sans compte et sans serveur au milieu.',
      'La recherche, les plongements sémantiques et l’OCR de l’écriture manuscrite (macOS) tournent sur votre propre machine.',
      'Amenez votre propre IA : les modèles se connectent via un serveur MCP local, jamais un cloud choisi pour vous.',
      'Importez depuis Obsidian ou GoodNotes, exportez en PDF, images ou JSON, et lisez chaque ligne du code source sur GitHub.',
    ],
  },

  sync: {
    heading: 'Synchronisez et collaborez,\nsans serveur au milieu.',
    kicker:
      'L’édition en temps réel suppose d’habitude un serveur qui détient vos notes. Myelin connecte plutôt les appareils directement.',
    cursorYou: 'vous',
    cursorPeer: 'ada',
    sharedNote: 'même note,\ndeux machines',
    tiers: [
      {
        shipped: true,
        badge: 'Disponible',
        title: 'Collaboration en direct',
        body: 'Deux appareils ayant la même note ouverte se trouvent automatiquement, puis éditent en parallèle via une connexion QUIC chiffrée directe entre eux (iroh).',
      },
      {
        shipped: true,
        badge: 'Disponible',
        title: 'Synchronisation GitHub',
        body: 'Indiquez à Myelin un dépôt et une branche, et votre espace de travail se synchronise entre vos appareils via un dépôt que vous contrôlez.',
      },
      {
        shipped: false,
        badge: 'Bientôt',
        title: 'Invitations',
        body: 'Invitez quelqu’un dans une seule note sans lui confier tout le dépôt, avec des rôles propriétaire, éditeur et lecteur qui décident de ce qu’il peut faire.',
      },
    ],
  },

  download: {
    heading: 'Télécharger',
    body: 'Disponible en français, anglais, espagnol et chinois simplifié.',
    cta: 'Télécharger Myelin Notes',
    autoUpdates: 'mises à jour\nautomatiques incluses',
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
    otherPlatforms: 'Aussi disponible pour',
    comingSoon: 'Bientôt disponible',
    mobileBadge:
      'iPhone, iPad et Android arrivent : les mêmes notes, pas une visionneuse au rabais',
    faqTitle: 'FAQ',
    faqMarkdown: `# FAQ

## Est-ce vraiment gratuit ?

Oui, entièrement gratuit pour un usage personnel.

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

  linkLabels: {
    privacy: 'Confidentialité',
  },

  footer: {
    nav: 'Pied de page',
    tagline: 'Écriture manuscrite, texte et PDF. Une seule note.',
    download: 'Télécharger Myelin',
    platforms: 'Mac · Windows · Linux · iPhone, iPad et Android bientôt',
  },

  shots: {
    library:
      'La bibliothèque Myelin Notes avec dossiers, cartes de notes, étiquettes et recherche',
    pdf: 'Un PDF intégré sur le canevas Myelin, avec une équation encadrée et une flèche dessinée à l’encre à côté',
    pageFrame:
      'Un cadre de page Myelin avec titres, liens de notes, liste de tâches, maths en ligne et blocs de code exécutés avec leur sortie à côté',
    audio:
      'Un enregistrement sur le canevas Myelin, sa forme d’onde dessinée au fil de la capture',
    graph:
      'La vue graphe de Myelin Notes, montrant les liens sortants et entrants d’une note',
  },

  canvas: {
    rail: {
      label: 'Sections',
      previous: 'Section précédente',
      next: 'Section suivante',
      scrollHint: 'Faites défiler pour explorer',
    },
    palette: {
      label: 'Palette de commandes',
      placeholder: 'Aller n’importe où dans le carnet',
      empty: 'Aucun résultat. Essayez le nom d’une scène ou « télécharger ».',
      groupGoTo: 'Aller à',
      groupGetIt: 'L’obtenir',
      download: 'Télécharger Myelin Notes',
    },
    addCustomColor: 'Ajouter une couleur personnalisée (hex, ex. #3b82f6)',
  },

  // Not yet tuned against rendered glyph widths; see the note in en.ts.
  decorations: {
    heroUnderline: { dx: 4, dy: 290, width: 640 },
    localFirstHighlight: { dx: 150, dy: 292, width: 410 },
    syncUnderline: { dx: 0, dy: 310, width: 480 },
  },
};

export default fr;
