import type en from './en';

const fr: typeof en = {
  common: {
    close: 'Fermer',
    cancel: 'Annuler',
    clear: 'Effacer',
    copy: 'Copier',
    copied: 'Copié',
    you: 'Vous',
    none: 'Aucun',
    never: 'Jamais',
    or: 'ou',
  },
  tabBar: {
    library: 'Bibliothèque',
    home: 'Accueil',
    settings: 'Réglages',
  },
  updater: {
    action: 'Mettre à jour',
    installing: 'Mise à jour',
    available: (version: string) =>
      `La version ${version} est disponible. Installez-la et redémarrez.`,
    failed: 'Échec de la mise à jour',
  },
  sidebar: {
    searchPlaceholder: 'Rechercher dans votre bibliothèque...',
    searchModeText: 'Texte',
    searchModeSemantic: 'Sémantique',
    explorer: 'Explorateur',
    tags: 'Étiquettes',
    collapse: 'Réduire la barre latérale',
    expand: 'Développer la barre latérale',
    graph: 'Ouvrir le graphe',
  },
  commandPalette: {
    title: 'Palette de commandes',
    placeholder: 'Rechercher des commandes...',
    searchPlaceholder: 'Rechercher des notes...',
    loading: 'Chargement...',
    noCommandResults: 'Aucune commande correspondante',
    noNoteResults: 'Aucune note correspondante',
    noteResultDescription: 'Note canevas',
    footer: 'Flèches pour naviguer, Entrée pour exécuter',
    sections: {
      commands: 'Commandes',
      notes: 'Notes',
      recent: 'Notes récentes',
    },
    commands: {
      openNote: {
        label: 'Ouvrir une note',
        description: 'Aller à un canevas récent ou correspondant',
      },
      createNote: {
        label: 'Créer une note',
        description:
          'Démarrer un nouveau canevas à la racine de la bibliothèque',
      },
      openGraph: {
        label: 'Ouvrir le graphe',
        description:
          'Cartographier les liens explicites entre les notes canevas',
      },
      importMarkdown: {
        label: 'Importer du Markdown',
        description: 'Créer un canevas à partir d’un fichier Markdown',
      },
      importMarkdownToCanvas: {
        label: 'Importer du Markdown',
        description: 'Ajouter un cadre de page Markdown à ce canevas',
      },
      switchView: {
        label: 'Changer la vue de la bibliothèque',
        description: 'Basculer la bibliothèque entre liste et grille',
      },
      refreshRepository: {
        label: 'Actualiser le dépôt',
        description:
          'Récupérer les dernières modifications distantes dans la bibliothèque',
      },
    },
    errors: {
      createNote: 'Impossible de créer la note',
      refreshRepository: 'Impossible d’actualiser le dépôt',
    },
  },
  library: {
    title: 'Bibliothèque numérique',
    emptyState: {
      title: 'Votre bibliothèque est vide',
      description:
        'Créez un canevas pour commencer à rassembler idées, notes et recherches.',
      cta: 'Nouveau canevas',
    },
    recentlyOpened: 'Ouverts récemment',
    betaFeedback: {
      title: 'Retours sur la bêta',
      description:
        'Un bug ou une idée ? Dites-le-nous dans un court formulaire.',
    },
    searchPlaceholder: 'Rechercher dans le studio...',
    semanticSearchLabel: 'Recherche sémantique',
    explorer: 'Explorateur',
    sortLabel: (label: string) => `Tri : ${label}`,
    sortModes: {
      'name-asc': 'Nom (A-Z)',
      'name-desc': 'Nom (Z-A)',
      modified: 'Modifiés récemment',
      created: 'Créés récemment',
    },
    viewModeLabel: (label: string) => `Vue : ${label}`,
    viewModes: {
      tree: 'Liste',
      grid: 'Grille',
    },
    fileTypes: {
      mcanvas: 'Canevas',
    },
    createNew: {
      button: 'Nouveau',
      folder: 'Nouveau dossier',
      canvas: 'Nouveau canevas',
      import: 'Importer',
      untitledCanvas: 'Canevas sans titre',
      unnamedFolder: 'Dossier sans nom',
    },
    importPicker: {
      title: 'Importer',
      description:
        'Choisissez ce que vous voulez ajouter à votre bibliothèque.',
    },
    importSources: {
      files: {
        label: 'Fichiers',
        description: 'Markdown, PDF, images et vidéos depuis votre ordinateur.',
        title: 'Importer des fichiers',
        scanning: 'Lecture des fichiers...',
        empty: 'Aucun des fichiers sélectionnés ne peut être importé',
        selected: (count: number) =>
          `${count} fichier${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`,
        nativeFile:
          'Les fichiers .goodnotes natifs ne sont pas encore pris en charge. Exportez un dossier Goodnotes en PDF, puis importez le ZIP.',
        summary: (count: number) =>
          `${count} fichier${count > 1 ? 's' : ''} importé${count > 1 ? 's' : ''}`,
      },
      goodnotes_zip: {
        label: 'Importer depuis Goodnotes',
        description: 'Un dossier Goodnotes exporté en PDF.',
        title: 'Importer un ZIP Goodnotes',
        scanning: 'Lecture de l’archive...',
        empty: 'Aucun PDF trouvé dans ce ZIP',
        pdfs: (count: number) => `${count} PDF`,
        summary: (count: number) =>
          `${count} PDF importé${count > 1 ? 's' : ''}`,
      },
      onenote: {
        label: 'Importer depuis OneNote',
        description:
          'Un bloc-notes .onepkg ou une section .one exportés depuis OneNote.',
        title: 'Importer depuis OneNote',
        scanning: 'Lecture du bloc-notes...',
        empty: 'Aucune page trouvée dans ce bloc-notes',
        pages: (count: number) => `${count} page${count > 1 ? 's' : ''}`,
        sections: (count: number) => `${count} section${count > 1 ? 's' : ''}`,
        summary: (count: number) =>
          `${count} page${count > 1 ? 's' : ''} importée${count > 1 ? 's' : ''}`,
        skipped: (count: number) =>
          `${count} page${count > 1 ? 's' : ''} n’${count > 1 ? 'ont' : 'a'} pas pu être importée${count > 1 ? 's' : ''}`,
      },
      obsidian_vault: {
        label: 'Importer depuis Obsidian',
        description: 'Un dossier de coffre, avec ses notes et pièces jointes.',
        title: 'Importer un coffre Obsidian',
        scanning: 'Analyse du coffre...',
        empty: 'Aucun fichier pris en charge trouvé dans ce coffre',
      },
      workspace_json: {
        label: 'JSON d’espace de travail',
        description: 'Un dossier exporté depuis Myelin.',
        title: 'Importer un JSON d’espace de travail',
        scanning: 'Analyse du dossier...',
        empty: 'Aucune note JSON ni média trouvés dans ce dossier',
      },
    },
    importMarkdown: {
      unsupportedFile:
        'Choisissez un fichier Markdown (.md, .markdown ou .mdx).',
      failed: 'Échec de l’import Markdown',
    },
    importDialog: {
      notes: (count: number) => `${count} note${count > 1 ? 's' : ''}`,
      media: (count: number) =>
        `${count} fichier${count > 1 ? 's' : ''} multimédia`,
      skippedFiles: (count: number) =>
        `${count} fichier${count > 1 ? 's' : ''} non pris en charge ${count > 1 ? 'seront ignorés' : 'sera ignoré'}`,
      conflict: {
        label: 'Un dossier portant ce nom existe déjà',
        rename: 'Conserver les deux (renommer)',
        replace: 'Remplacer l’existant',
      },
      progress: {
        importing: (current: number, total: number) =>
          `Import de ${current} sur ${total}...`,
        cancelling: 'Annulation...',
      },
      summary: {
        title: 'Import terminé',
        cancelled: 'Import annulé',
        imported: (notes: number, media: number) =>
          `${notes} note${notes > 1 ? 's' : ''} et ${media} fichier${media > 1 ? 's' : ''} multimédia importés`,
        skipped: (count: number) =>
          `${count} fichier${count > 1 ? 's' : ''} non pris en charge ignoré${count > 1 ? 's' : ''}`,
      },
      buttons: {
        import: 'Importer',
        cancel: 'Annuler',
        done: 'Terminé',
      },
    },
    repositoryLoading: 'Chargement du dépôt...',
    refreshRepository: {
      label: 'Actualiser le dépôt',
      loading: 'Actualisation du dépôt...',
      failed: 'Échec de l’actualisation du dépôt',
    },
    semanticTags: {
      title: 'Étiquettes sémantiques',
      empty: 'Aucune étiquette pour l’instant',
      emptyHint: 'Créez-en une pour filtrer votre bibliothèque.',
      insights: 'Aperçu du studio',
      addTag: 'Nouvelle étiquette',
      addChild: (tag: string) => `Ajouter une étiquette sous #${tag}`,
      toggleChildren: (tag: string) =>
        `Afficher/masquer les étiquettes sous #${tag}`,
      placeholder: 'Nom de l’étiquette...',
      deleteTag: (tag: string) => `Supprimer #${tag}`,
      stats: {
        totalFiles: 'Fichiers au total',
        folders: 'Dossiers',
        uniqueTags: 'Étiquettes uniques',
      },
    },
    explorerTree: {
      repositorySetupRequired:
        'Configuration du dépôt requise. Terminez la configuration dans les Réglages pour voir les fichiers.',
      emptySearch: 'Aucun résultat',
      emptyFilter: 'Aucun élément ne correspond aux étiquettes sélectionnées',
      emptyDefault: 'Aucun fichier pour l’instant',
      selectedCount: (count: number) => `${count} éléments`,
    },
    itemMenu: {
      rename: 'Renommer',
      manageTags: 'Gérer les étiquettes',
      color: 'Couleur',
      versionHistory: 'Historique des versions',
      revealInFileManager: 'Afficher dans le gestionnaire de fichiers',
      remove: 'Supprimer',
    },
    renameReferencesDialog: {
      title: 'Mettre à jour les mentions liées ?',
      description: (mentionCount: number, noteCount: number) =>
        `${mentionCount} mention${mentionCount > 1 ? 's' : ''} liée${mentionCount > 1 ? 's' : ''} dans ${noteCount} autre${noteCount > 1 ? 's' : ''} note${noteCount > 1 ? 's' : ''} ${mentionCount > 1 ? 'seront réécrites' : 'sera réécrite'} pour correspondre au nouveau nom.`,
      always: 'Toujours mettre à jour sans demander',
      yes: 'Mettre à jour',
      no: 'Ignorer',
    },
    tagDialog: {
      title: 'Gérer les étiquettes',
      description: (name: string) => `Étiquettes de ${name}`,
      activeTags: 'Étiquettes actives',
      noTags: 'Aucune étiquette pour l’instant',
      available: 'Disponibles',
      createNew: 'Créer une étiquette',
      placeholder: 'Nom de l’étiquette...',
    },
  },
  graph: {
    title: 'Graphe',
    explicitLinks: 'Liens explicites',
    searchPlaceholder: 'Rechercher dans le graphe...',
    recenter: 'Recentrer',
    zoomIn: 'Zoom avant',
    zoomOut: 'Zoom arrière',
    tags: 'Étiquettes',
    openNote: 'Ouvrir la note',
    emptySelection: 'Sélectionnez une note pour examiner ses liens.',
    noCanvasNotes: 'Aucune note canevas pour l’instant.',
    noLinks: 'Ajoutez des liens explicites entre notes pour relier ce graphe.',
    loadFailed: 'Impossible de charger le graphe.',
    outgoing: 'Liens sortants',
    backlinks: 'Liens entrants',
    graphStats: (notes: number, links: number) =>
      `${notes} note${notes > 1 ? 's' : ''}, ${links} lien${links > 1 ? 's' : ''}`,
    linkCount: (incoming: number, outgoing: number) =>
      `${outgoing} sortant${outgoing > 1 ? 's' : ''}, ${incoming} entrant${incoming > 1 ? 's' : ''}`,
  },
  versionHistory: {
    title: 'Historique des versions',
    description: (name: string) => `Versions précédentes de ${name}`,
    empty: 'Aucune version pour l’instant',
    loadFailed: 'Impossible de charger l’historique des versions',
    restore: 'Restaurer',
    restoring: 'Restauration...',
    restored: 'Version restaurée',
    restoreFailed: 'Impossible de restaurer la version',
  },
  settings: {
    title: 'Préférences',
    theme: {
      title: 'Thème',
      eyebrow: 'Apparence',
      options: {
        light: 'Clair',
        dark: 'Sombre',
        system: 'Système',
      },
    },
    canvasStyle: {
      title: 'Style du canevas',
      eyebrow: 'Surface',
      options: {
        grid: 'Grille',
        dots: 'Points',
        blank: 'Vide',
      },
      backgroundColor: {
        label: 'Couleur d’arrière-plan',
        description:
          'Remplir le canevas derrière le motif avec la couleur du thème ou une couleur de votre choix.',
        options: {
          theme: 'Par défaut',
          custom: 'Personnalisée',
        },
        confirm: 'Appliquer',
      },
    },
    language: {
      title: 'Langue',
      eyebrow: 'Interface',
    },
    input: {
      title: 'Saisie',
      eyebrow: 'Stylet et tactile',
      mode: {
        label: 'Mode de dessin',
        description:
          'Ce que fait un doigt sur le canevas. Stylet réserve le dessin au stylet et déplace au doigt ; Tactile dessine au doigt, et déplace ou zoome à deux doigts.',
        options: {
          pen: 'Stylet',
          touch: 'Tactile',
        },
      },
    },
    pageFrameEditing: {
      title: 'Édition des cadres de page',
      eyebrow: 'Vue document',
      defaultPageLayout: {
        label: 'Mise en page par défaut',
        description:
          'Choisissez comment les nouveaux cadres de page disposent leur contenu. Les PDF n’utilisent que Pages ou Colonnes.',
        options: {
          vertical: 'Pages',
          horizontal: 'Colonnes',
          continuous: 'Continu',
        },
      },
      fitWholePage: {
        label: 'Ajuster la page entière lors de l’édition',
        description:
          'Dézoomer pour afficher toute la hauteur de la page en entrant en mode édition d’un cadre de page.',
      },
      hoverPreview: {
        label: 'Afficher un aperçu au survol des liens de notes',
        description:
          'Afficher une miniature et un titre au survol d’une note liée.',
      },
      requireModifier: {
        label: (key: string) => `Exiger ${key}+clic pour suivre les liens`,
        description: (key: string) =>
          `Désactivé, un simple clic suit les liens de notes et les hyperliens. Activé, maintenez ${key} pour suivre, afin qu’un simple clic place le curseur.`,
      },
      renameReferences: {
        label: 'Toujours mettre à jour les liens après avoir renommé une note',
        description:
          'Désactivé, Myelin Notes demande confirmation avant de modifier les mentions liées après le renommage d’une note.',
      },
    },
    repository: {
      title: 'Dépôt',
      eyebrow: 'Synchronisation',
      kinds: {
        local: {
          label: 'Local',
          description: 'Notes stockées uniquement sur cet appareil',
        },
        github: {
          label: 'GitHub',
          description: 'Synchroniser avec un dépôt GitHub privé',
        },
        googleDrive: {
          label: 'Google Drive',
          description: 'Synchroniser avec un dossier de votre Google Drive',
        },
      },
      auth: {
        title: 'Authentification du dépôt',
        descriptions: {
          awaitingRedirect: (provider: string) =>
            `Terminez la connexion à ${provider} dans votre navigateur`,
          connected: 'Connexion terminée',
          unavailable: 'Authentification indisponible',
          signIn: 'Connectez-vous pour relier ce dépôt',
        },
        errors: {
          readState: 'Impossible de lire l’état d’authentification.',
          signIn: 'Échec de la connexion.',
        },
        buttons: {
          signIn: 'Se connecter',
          signOut: 'Se déconnecter',
        },
        browserCallback: {
          title: (provider: string) => `Connecté à ${provider}`,
          message:
            'Vous pouvez fermer cet onglet et revenir dans Myelin Notes.',
        },
        notices: {
          credentialReset: (provider: string) =>
            `Votre connexion ${provider} a expiré et a été réinitialisée. Veuillez vous reconnecter.`,
        },
      },
      authStatus: {
        checking: 'Vérification',
        authorizing: 'Autorisation',
        connected: 'Connecté',
        disconnected: 'Non connecté',
      },
      sync: {
        title: 'Synchronisation du dépôt',
        queuedChanges: 'Modifications en attente',
        lastSync: 'Dernière synchronisation',
        remoteRepository: 'Dépôt distant',
        driveFolder: 'Dossier Drive',
        status: {
          setupRequired: {
            label: 'Configuration requise',
            description:
              'Connectez-vous et choisissez un dépôt pour activer la synchronisation.',
          },
          loading: {
            label: 'Chargement',
            description:
              'Chargement du dépôt en cache et vérification du distant.',
          },
          pending: {
            label: 'En attente',
            description: (count: number, online: boolean) =>
              online
                ? `${count} modification${count > 1 ? 's' : ''} en attente d’envoi.`
                : `${count} modification${count > 1 ? 's' : ''} en attente localement jusqu’au rétablissement de la synchronisation distante.`,
          },
          issue: {
            label: 'Problème',
            onlineDescription:
              'Le dépôt est configuré, mais la dernière tentative de synchronisation a échoué.',
            offlineDescription:
              'La synchronisation distante est indisponible. Les données en cache restent disponibles localement.',
          },
          synced: {
            label: 'Synchronisé',
            upToDate: 'Le dépôt distant est à jour.',
            ready: 'Le dépôt est prêt à se synchroniser.',
          },
        },
      },
      fields: {
        owner: {
          select: 'Choisir un propriétaire',
          loading: 'Chargement du compte...',
          error: 'Impossible de charger le compte GitHub.',
          you: 'Vous',
          org: 'Org',
        },
        repo: {
          pickOwner: 'Choisissez un propriétaire',
          select: 'Choisir un dépôt',
          loading: 'Chargement des dépôts...',
          error: 'Impossible de charger les dépôts.',
          empty: 'Aucun dépôt',
        },
        branch: {
          pickRepo: 'Choisissez un dépôt',
          select: 'Choisir une branche',
          loading: 'Chargement des branches...',
          error: 'Impossible de charger les branches.',
          empty: 'Aucune branche',
        },
        folder: {
          label: 'Nom du dossier Drive',
          placeholder: 'Myelin',
          error: 'Impossible d’ouvrir le dossier Drive.',
        },
      },
    },
    dataExport: {
      title: 'Données',
      eyebrow: 'Espace de travail',
      export: {
        label: 'Exporter en coffre Obsidian',
        description:
          'Enregistrer tout votre espace de travail dans un dossier sous forme de coffre compatible Obsidian. Les notes deviennent du Markdown avec frontmatter ; les autres fichiers sont copiés et l’arborescence est conservée.',
        button: 'Exporter',
        defaultVaultName: 'Coffre Myelin Notes',
        loading: 'Export du coffre Obsidian...',
        progress: (current: number, total: number) =>
          `Export de ${current} sur ${total}...`,
        failed: 'Échec de l’export du coffre Obsidian',
        succeeded: (notes: number, media: number) =>
          `${notes} note${notes > 1 ? 's' : ''} et ${media} fichier${media > 1 ? 's' : ''} multimédia exportés.`,
      },
      exportJson: {
        label: 'Exporter l’espace de travail en JSON',
        description:
          'Enregistrer tout votre espace de travail dans un dossier au format JSON. Chaque note devient un fichier JSON décrivant ses traits, son texte et ses médias intégrés (binaires en base64) ; les autres fichiers sont copiés et l’arborescence est conservée.',
        button: 'Exporter',
        defaultExportName: 'Export JSON Myelin Notes',
        loading: 'Export de l’espace de travail en JSON...',
        progress: (current: number, total: number) =>
          `Export de ${current} sur ${total}...`,
        failed: 'Échec de l’export JSON',
        succeeded: (notes: number, media: number) =>
          `${notes} note${notes > 1 ? 's' : ''} et ${media} fichier${media > 1 ? 's' : ''} multimédia exportés.`,
      },
    },
    privacy: {
      title: 'Confidentialité',
      eyebrow: 'Données d’utilisation',
      analytics: {
        label: 'Partager des statistiques d’utilisation anonymes',
        description:
          'Envoyer des statistiques produit anonymes et des rapports d’erreur pour aider à améliorer Myelin Notes. Désactivé, rien n’est envoyé.',
      },
      policy: {
        label: 'Politique de confidentialité',
        description:
          'Ce qui quitte votre appareil, qui le reçoit et combien de temps c’est conservé. Ouvre trymyelin.app dans votre navigateur.',
      },
    },
    mcp: {
      title: 'Model Context Protocol',
      eyebrow: 'Agents IA',
      enabled: {
        label: 'Activer le serveur MCP local',
        description:
          'Exposer cette instance de Myelin Notes aux agents IA locaux sur 127.0.0.1.',
      },
      port: {
        label: 'Port local',
        description:
          'Le serveur redémarre sur le nouveau port quand vous quittez le champ.',
      },
      installPrompt: {
        label: 'Instruction d’installation pour l’agent',
        description:
          'Copiez ceci dans votre agent pour le connecter à cette application en cours d’exécution.',
        prompt: (endpoint: string) =>
          `Installe le serveur MCP de Myelin Notes pour cette application de bureau en cours d’exécution. Utilise Streamable HTTP avec le point de terminaison ${endpoint}. Nomme le serveur myelin. Ce serveur est local à cet ordinateur : Myelin Notes doit donc rester ouvert avec MCP activé.`,
      },
      directWrites: {
        label: 'Autoriser les écritures MCP directes',
        description:
          'Permettre aux agents de créer des cadres de page et de remplacer leur Markdown.',
      },
      startFailed: (port: number) =>
        `Impossible de démarrer le serveur MCP sur le port ${port}`,
    },
    keybinds: {
      title: 'Raccourcis clavier',
      resetAll: 'Tout réinitialiser',
      pressKey: 'Appuyez sur une touche...',
      unbound: 'Non assigné',
      empty:
        'Aucun raccourci enregistré pour l’instant. Ils apparaissent dès que vous ouvrez un canevas.',
      categories: {
        app: 'Application',
        canvas: 'Canevas',
        editor: 'Éditeur',
      },
      actions: {
        'app:command-palette': {
          label: 'Palette de commandes',
          description:
            'Ouvrir les commandes de l’application et la navigation entre notes',
        },
        'canvas:undo': {
          label: 'Annuler',
          description: 'Revenir sur la dernière modification du canevas',
        },
        'canvas:redo': {
          label: 'Rétablir',
          description:
            'Réappliquer la dernière modification annulée du canevas',
        },
        'canvas:select-all': {
          label: 'Tout sélectionner',
          description: 'Sélectionner tout le contenu du canevas',
        },
        'canvas:find': {
          label: 'Rechercher dans le canevas',
          description:
            'Rechercher le texte et l’écriture manuscrite de ce canevas',
        },
        'canvas:pan': {
          label: 'Déplacer',
          description: 'Maintenir pour faire glisser le canevas',
        },
        'canvas:delete': {
          label: 'Supprimer',
          description: 'Supprimer les éléments sélectionnés',
        },
        'canvas:tool-select': {
          label: 'Outil Sélection',
          description: 'Sélectionner et déplacer des éléments',
        },
        'canvas:tool-pen': {
          label: 'Outil Stylo',
          description: 'Dessiner au stylo',
        },
        'canvas:tool-highlighter': {
          label: 'Outil Surligneur',
          description: 'Surligner avec une encre translucide',
        },
        'canvas:tool-eraser': {
          label: 'Outil Gomme',
          description: 'Effacer des traits',
        },
        'canvas:tool-text': {
          label: 'Outil Texte',
          description: 'Créer un nouveau bloc de texte',
        },
        'canvas:insert-frame': {
          label: 'Insérer un cadre de page',
          description: 'Placer un nouveau cadre de page sur le canevas',
        },
        'canvas:insert-embed': {
          label: 'Insérer un média',
          description: 'Insérer une image, un PDF ou un fichier',
        },
        'editor:bold': {
          label: 'Gras',
          description: 'Activer/désactiver le gras',
        },
        'editor:italic': {
          label: 'Italique',
          description: 'Activer/désactiver l’italique',
        },
        'editor:underline': {
          label: 'Souligné',
          description: 'Activer/désactiver le soulignement',
        },
        'editor:strikethrough': {
          label: 'Barré',
          description: 'Activer/désactiver le barré',
        },
        'editor:code': {
          label: 'Code',
          description: 'Activer/désactiver le code en ligne',
        },
      },
    },
    about: {
      title: 'À propos',
      eyebrow: 'Application',
      version: {
        label: 'Version',
        description: 'La version de Myelin Notes actuellement installée.',
      },
    },
  },
  canvas: {
    kind: 'Canevas',
    frame: {
      noteKind: 'Note',
      pdfKind: 'PDF',
      displayNameLabel: 'Nom d’affichage du cadre de page',
      menu: 'Menu',
      openMenu: 'Ouvrir le menu du cadre',
      rename: 'Renommer',
      pages: 'Pages',
      continuous: 'Continu',
      columns: 'Colonnes',
      export: 'Exporter',
    },
    export: {
      title: 'Exporter',
      exportCanvasPdf: 'Exporter le canevas en PDF',
      format: 'Format',
      includeAnnotations: 'Inclure les annotations',
      annotationsHint: 'Dessins et notes sur la page',
      exporting: 'Export…',
      tryAgain: 'Réessayer',
      exportedWithWarnings: 'Exporté avec des avertissements',
      complete: 'Export terminé',
    },
    search: {
      placeholder: 'Rechercher dans le canevas',
      noResults: 'Aucun résultat',
      next: 'Résultat suivant',
      previous: 'Résultat précédent',
    },
    statusBar: {
      fps: (fps: number) => `${fps} fps`,
    },
    slashInsert: {
      heading1: {
        title: 'Titre 1',
        subtitle: 'Transformer ce bloc en titre principal',
      },
      heading2: {
        title: 'Titre 2',
        subtitle: 'Transformer ce bloc en titre de section',
      },
      heading3: {
        title: 'Titre 3',
        subtitle: 'Transformer ce bloc en petit titre',
      },
      quote: {
        title: 'Citation',
        subtitle: 'Transformer ce bloc en citation',
      },
      bulletList: {
        title: 'Liste à puces',
        subtitle: 'Transformer ce bloc en élément de liste à puces',
      },
      numberedList: {
        title: 'Liste numérotée',
        subtitle: 'Transformer ce bloc en élément de liste numérotée',
      },
      todo: {
        title: 'Tâche',
        subtitle: 'Transformer ce bloc en tâche à cocher',
      },
      paragraph: {
        title: 'Paragraphe',
        subtitle: 'Remettre ce bloc en texte simple',
      },
      table: {
        title: 'Tableau',
        subtitle:
          'Insérer un tableau avec une ligne d’en-tête et des lignes de corps',
      },
      bold: {
        title: 'Gras',
        subtitle: 'Insérer du markdown **gras**',
      },
      italic: {
        title: 'Italique',
        subtitle: 'Insérer du markdown *italique*',
      },
      link: {
        title: 'Lien',
        subtitle: 'Insérer du markdown [libellé](url)',
      },
      noteLink: {
        title: 'Lien de note',
        subtitle: 'Insérer un lien [[note]] vers une autre note',
      },
      inlineCode: {
        title: 'Code en ligne',
        subtitle: 'Insérer du markdown `code`',
      },
      embed: {
        title: 'Intégration',
        subtitle:
          'Insérer ![alt](url) : images, vidéos, YouTube, cartes de lien',
      },
      today: {
        title: 'Aujourd’hui',
        subtitle: 'Insérer la date du jour',
      },
      tomorrow: {
        title: 'Demain',
        subtitle: 'Insérer la date de demain',
      },
      yesterday: {
        title: 'Hier',
        subtitle: 'Insérer la date d’hier',
      },
      now: {
        title: 'Maintenant',
        subtitle: 'Insérer la date et l’heure actuelles',
      },
    },
    backlinks: {
      title: 'Liens entrants',
      linkedMentions: 'Mentions liées',
    },
    toolbar: {
      clickForOptions: 'cliquez pour les options',
      customizeWheel: 'Outils et préréglages',
      insert: 'Insérer',
    },
    selectionToolbar: {
      label: 'Ordre de la sélection',
      moveHigher: 'Avancer',
      moveLower: 'Reculer',
      delete: 'Supprimer',
      crop: 'Rogner',
      applyCrop: 'Appliquer le rognage',
    },
    insert: {
      title: 'Insérer',
      soon: 'Bientôt',
      frame: {
        label: 'Cadre de page',
        description: 'Une nouvelle page pour écrire',
      },
      embed: {
        label: 'Image ou PDF',
        description: 'Déposez des fichiers ou collez une URL',
      },
      camera: {
        label: 'Prendre une photo',
        description: 'Prenez une photo avec votre appareil',
      },
      latex: {
        label: 'LaTeX',
        description: 'Un bloc mathématique pour écrire des équations',
      },
      audio: {
        label: 'Audio',
        description: 'Enregistrer ou importer un mémo vocal',
      },
    },
    audioPlayer: {
      requestingMic: 'Demande du microphone...',
      requestingMicAccess: 'Demande d’accès au microphone',
      micUnavailable: 'Microphone indisponible',
      tapToRecord: 'Touchez pour enregistrer',
      waitingForRecording: 'En attente d’un enregistrement',
      startRecording: 'Démarrer l’enregistrement',
      stopRecording: 'Arrêter l’enregistrement',
      tryRecordingAgain: 'Réessayer l’enregistrement',
      playAudio: 'Lire l’audio',
      pauseAudio: 'Mettre l’audio en pause',
      transcribe: 'Transcrire l’audio',
      transcribing: 'Transcription de l’audio...',
      transcribingOn: (peer: string) => `Transcription sur ${peer}...`,
      transcriptionUnavailable:
        'La transcription nécessite un appareil qui la prend en charge',
      playFrom: (time: string) => `Lire à partir de ${time}`,
      showTranscript: 'Afficher la transcription',
      hideTranscript: 'Masquer la transcription',
      noSpeechDetected: 'Aucune parole détectée',
      transcriptionFailed: 'Échec de la transcription',
    },
    toolShelf: {
      title: 'Outils et préréglages',
      empty: 'Roue désactivée : le clic droit ne l’ouvrira pas.',
      tools: 'Outils',
      presets: 'Préréglages',
    },
    toolPresets: {
      label: (tool: string, size: number) => `${tool} · ${size}px`,
      save: 'Enregistrer le stylo actuel comme préréglage',
      saveShort: 'Enregistrer comme préréglage',
      saveNeedsPen: 'Choisissez d’abord le stylo ou le surligneur.',
      saveFull: (max: number) =>
        `Les préréglages sont pleins : ${max} sur ${max}.`,
      wheelFull: (max: number) => `La roue est pleine : ${max} sur ${max}.`,
      updateToCurrent: 'Mettre à jour avec les réglages actuels',
      showInWheel: 'Afficher dans la roue',
      removeFromWheel: 'Retirer de la roue',
      delete: 'Supprimer le préréglage',
    },
    tools: {
      select: 'Sélection',
      pen: 'Stylo',
      highlighter: 'Surligneur',
      eraser: 'Gomme',
      text: 'Texte',
    },
    toolOptions: {
      color: 'Couleur',
      stroke: 'Trait',
      size: 'Taille',
      font: 'Police',
      fontSize: 'Taille de police',
      mode: 'Mode',
      rectangle: 'Rectangle',
      lasso: 'Lasso',
      precise: 'Précis',
      fine: (value: number) => `Fin (${value})`,
      medium: (value: number) => `Moyen (${value})`,
      bold: (value: number) => `Épais (${value})`,
      pressure: 'Pression',
      addCustomColor: 'Ajouter une couleur personnalisée',
      deleteColor: 'Supprimer la couleur',
      decreaseFontSize: 'Réduire la taille de police',
      increaseFontSize: 'Augmenter la taille de police',
    },
    embedComposer: {
      dropToEmbed: 'Déposez pour intégrer',
      title: 'Ajouter un média',
      subtitle: 'Collez, déposez ou choisissez une image ou un PDF.',
      readyToEmbed: 'Prêt à intégrer',
      embedPdf: 'Intégrer le PDF',
      embedImage: 'Intégrer l’image',
      urlPlaceholder: 'Collez une URL',
      fetch: 'Récupérer',
      browse: 'Cliquez pour parcourir',
      dropFiles: 'ou déposez des fichiers ici',
      pasteFromClipboard: 'coller depuis le presse-papiers',
      embedded: 'intégré',
      errors: {
        unsupportedUrl: 'Ce lien ne pointe pas vers une image ou un PDF.',
        fetchFailed: 'Impossible de récupérer ce lien.',
        embedFailed: 'Impossible d’intégrer ce fichier.',
        unsupportedType: 'Type de média non pris en charge',
        unsupportedDesc: (type: string) =>
          `${type} n’est pas pris en charge pour le moment`,
      },
    },
    peerSync: {
      title: 'Synchronisation entre pairs',
      host: 'Héberger avec iroh',
      joinPlaceholder: 'Code de partage',
      join: 'Rejoindre',
      waitingForPeer: 'En attente d’un pair...',
      shareCode: 'Partagez ce code avec un pair',
      connecting: 'Connexion...',
      connected: 'Connecté',
      sync: 'Synchroniser',
      localPeer: 'Pair local',
      writer: 'Rédacteur',
      writerActive: 'Rédacteur actif',
      standby: 'En veille',
      repository: 'Dépôt',
      lastRemoteSync: 'Dernière synchronisation distante',
      remotePeers: 'Pairs distants',
      noRemotePeers: 'Aucun pair distant',
      livePaused: 'Synchronisation en direct en pause',
      peerModes: {
        'owner-device': 'Appareil propriétaire',
        'guest-editor': 'Invité éditeur',
        'guest-viewer': 'Invité lecteur',
      },
      repositoryStatus: {
        localOnly: 'Local uniquement',
        initializing: 'Initialisation',
        offline: 'Hors ligne',
        queued: (count: number) => `${count} en attente`,
        remoteSynced: 'Synchronisé à distance',
        idle: 'Inactif',
      },
      sessionPhase: {
        idle: 'Inactif',
        pulling: 'Réception',
        pushing: 'Envoi',
        closed: 'Fermé',
        live: (phase: string) => `En direct / ${phase}`,
      },
    },
  },
  dialogs: {
    closeSrOnly: 'Fermer',
  },
  onboarding: {
    skip: 'Passer la configuration',
    back: 'Retour',
    continue: 'Continuer',
    finish: 'Terminer',
    stepLabel: (current: number, total: number) =>
      `Étape ${current} sur ${total}`,
    welcome: {
      eyebrow: 'Bienvenue',
      title: 'Myelin Notes',
      description:
        'Un canevas infini pour l’écriture manuscrite, le texte et tout ce qu’il y a entre les deux. Quatre questions rapides et c’est fini.',
      language: 'Langue',
      start: 'Commencer',
    },
    input: {
      eyebrow: 'Stylet et tactile',
      title: 'Comment allez-vous dessiner ?',
      description:
        'Choisissez ce que fait un doigt sur le canevas. Vous pourrez le changer à tout moment dans les Réglages.',
    },
    privacy: {
      eyebrow: 'Confidentialité',
      title: 'Aidez à améliorer Myelin Notes',
      description:
        'Les statistiques sont désactivées tant que vous ne les activez pas ici. Vous pouvez changer d’avis à tout moment dans les Réglages.',
      collected:
        'Ce qui est envoyé : les fonctionnalités utilisées, la version de l’application et les rapports de plantage.',
      notCollected:
        'Ce qui n’est jamais envoyé : vos notes, leur contenu, les noms de fichiers ou votre écriture manuscrite.',
      policy: 'Lire la politique de confidentialité',
    },
    sync: {
      eyebrow: 'Synchronisation',
      title: 'Où vos notes doivent-elles vivre ?',
      description:
        'Les notes sont stockées sur cet appareil. Reliez un dépôt GitHub ou Google Drive pour les sauvegarder et les synchroniser entre vos machines.',
      later: 'Vous pourrez configurer cela plus tard dans les Réglages.',
      incomplete:
        'Connectez-vous et finissez de choisir où vont les notes pour continuer, ou choisissez Local pour décider plus tard.',
    },
    sample: {
      eyebrow: 'Canevas',
      title: 'Commencer avec un canevas d’exemple ?',
      description:
        'Créer un canevas d’exemple présentant quelques fonctionnalités avec lesquelles vous pouvez jouer',
      start: 'Ouvrir le canevas',
      skip: 'Commencer à vide',
      canvasName: 'Premiers pas',
      highlights: {
        frame:
          'Un cadre de page avec du code, des maths et un diagramme Mermaid',
        canvas: 'Du texte et du LaTeX flottant sur le canevas à côté',
        syntax: 'Un aide-mémoire des raccourcis markdown',
        checklist: 'Une courte liste de choses à essayer vous-même',
      },
    },
    // Content of the starter canvas. Syntax inside these strings
    // (`$E = mc^2$`, `![](…)`) is part of what the page demonstrates, so keep it
    // literal when translating.
    starter: {
      frameName: 'Les bases',
      title: 'Premiers pas',
      intro:
        'Ceci est un cadre de page : un document qui vit sur le canevas. Faites-le glisser, redimensionnez-le ou déposez-en un autre à côté.',
      tipTitle: 'Appuyez sur / pour insérer',
      tipBody:
        'Dans un cadre de page, `/` ouvre le menu d’insertion : titres, tableaux, code, maths, intégrations, dates.',
      codeHeading: 'Blocs de code',
      codeBody:
        'Délimitez un bloc avec trois accents graves et un langage. Vous obtenez un vrai éditeur, pas du texte grisé.',
      mathHeading: 'Maths',
      mathBody:
        'Les maths en ligne comme $E = mc^2$ s’insèrent dans une phrase. Délimitez un bloc avec `$$` pour lui donner sa propre ligne :',
      diagramHeading: 'Diagrammes Mermaid',
      diagramBody:
        'Un bloc de code marqué `mermaid` s’affiche sous forme de diagramme.',
      diagramNodes: {
        idea: 'Idée',
        note: 'Note',
        canvas: 'Canevas',
      },
      syntaxHeading: 'Bon à savoir',
      syntaxColumns: {
        type: 'Tapez ceci',
        get: 'Pour obtenir',
      },
      syntaxRows: {
        checklist: 'Une liste de tâches',
        callout: 'Un encadré, comme celui ci-dessus',
        math: 'Un bloc de maths',
      },
      linkTip:
        'Deux crochets ouvrants commencent un lien vers une autre note, et l’autocomplétion le termine.',
      mediaHeading: 'Images, PDF et vidéos',
      mediaBody:
        'Faites glisser un fichier sur le canevas, ou tapez / dans une page et choisissez Intégration pour l’y placer. Collez un lien YouTube ou Vimeo de la même façon et il devient un lecteur.',
      checklistHeading: 'À vous',
      checklistDone: 'Ouvrir le canevas de démarrage',
      checklistTodo1: 'Ajouter un cadre de page à vous',
      checklistTodo2: 'Y écrire quelque chose',
      canvas: {
        heading: 'Ici, c’est le canevas',
        body: 'Les blocs de texte et de LaTeX y flottent librement. Déplacez-les, redimensionnez-les ou alignez-les à côté d’une page.',
        latexCaption: 'Un bloc LaTeX sur le canevas :',
        toolbarHint:
          'Tout le reste se trouve derrière le bouton + en haut de la barre d’outils.',
      },
    },
  },
  shutdown: {
    title: 'Enregistrement des modifications…',
    description:
      'Synchronisation des modifications en attente vers votre dépôt avant de quitter.',
    progress: (count: number) =>
      `Synchronisation de ${count} modification${count > 1 ? 's' : ''}…`,
    forceQuit: 'Quitter quand même',
    forceQuitHint:
      'Les modifications non synchronisées restent en attente et seront réessayées au prochain lancement.',
  },
};

export default fr;
