import type en from './en';

const es: typeof en = {
  common: {
    close: 'Cerrar',
    cancel: 'Cancelar',
    clear: 'Limpiar',
    copy: 'Copiar',
    copied: 'Copiado',
    you: 'Tú',
    none: 'Ninguno',
    never: 'Nunca',
    or: 'o',
  },
  app: {
    name: 'Myelin',
    tagline: 'Estudio Digital',
  },
  sidebar: {
    newCanvas: 'Nuevo lienzo',
    nav: {
      library: 'Biblioteca',
      graph: 'Grafo',
      settings: 'Ajustes',
      help: 'Ayuda',
    },
  },
  commandPalette: {
    title: 'Paleta de comandos',
    placeholder: 'Buscar comandos...',
    searchPlaceholder: 'Buscar notas...',
    loading: 'Cargando...',
    noCommandResults: 'No hay comandos coincidentes',
    noNoteResults: 'No hay notas coincidentes',
    noteResultDescription: 'Nota de lienzo',
    footer: 'Flechas para navegar, Enter para ejecutar',
    sections: {
      commands: 'Comandos',
      notes: 'Notas',
      recent: 'Notas recientes',
    },
    commands: {
      openNote: {
        label: 'Abrir nota',
        description: 'Ir a un lienzo reciente o coincidente',
      },
      createNote: {
        label: 'Crear nota',
        description: 'Crear un lienzo en la raíz de la biblioteca',
      },
      importMarkdown: {
        label: 'Importar Markdown',
        description: 'Crear un lienzo desde un archivo Markdown',
      },
      importMarkdownToCanvas: {
        label: 'Importar Markdown',
        description: 'Agregar un marco de página Markdown a este lienzo',
      },
      switchView: {
        label: 'Cambiar vista de biblioteca',
        description: 'Alternar la biblioteca entre lista y cuadrícula',
      },
    },
    errors: {
      createNote: 'No se pudo crear la nota',
    },
  },
  library: {
    title: 'Biblioteca Digital',
    emptyState:
      'Tu espacio personal de conocimiento. Crea un lienzo para empezar a recopilar ideas, notas e investigación.',
    recentlyOpened: 'Abiertos recientemente',
    searchPlaceholder: 'Buscar en el estudio...',
    explorer: 'Navegador',
    sortLabel: (label: string) => `Ordenar: ${label}`,
    sortModes: {
      'name-asc': 'Nombre (A-Z)',
      'name-desc': 'Nombre (Z-A)',
      modified: 'Modificado recientemente',
      created: 'Creado recientemente',
    },
    viewModeLabel: (label: string) => `Vista: ${label}`,
    viewModes: {
      tree: 'Lista',
      grid: 'Cuadrícula',
    },
    fileTypes: {
      mcanvas: 'Lienzo',
    },
    createNew: {
      button: 'Nuevo',
      folder: 'Nueva carpeta',
      canvas: 'Nuevo lienzo',
      importFiles: 'Importar archivos',
      importObsidianVault: 'Importar bóveda de Obsidian',
      untitledCanvas: 'Lienzo sin título',
      unnamedFolder: 'Carpeta sin nombre',
    },
    importMarkdown: {
      unsupportedFile: 'Elige un archivo Markdown (.md, .markdown o .mdx).',
      failed: 'No se pudo importar el Markdown',
    },
    importFiles: {
      unsupportedFile: 'Elige un archivo Markdown, PDF, de imagen o video.',
      someUnsupported: 'Algunos archivos no son compatibles.',
      failed: 'No se pudo importar',
    },
    importObsidianVault: {
      failed: 'No se pudo importar la bóveda de Obsidian',
      skipped: (count: number) =>
        `${count} archivo${count === 1 ? '' : 's'} no compatible${count === 1 ? '' : 's'} omitido${count === 1 ? '' : 's'}.`,
      succeeded: (notes: number, media: number) =>
        `Se importaron ${notes} nota${notes === 1 ? '' : 's'} y ${media} archivo${media === 1 ? '' : 's'} multimedia.`,
    },
    semanticTags: {
      title: 'Etiquetas semánticas',
      empty:
        'Aún no hay etiquetas. Haz clic derecho en un archivo y elige "Administrar etiquetas" para empezar.',
      insights: 'Análisis del estudio',
      stats: {
        totalFiles: 'Total de archivos',
        folders: 'Carpetas',
        uniqueTags: 'Etiquetas únicas',
      },
    },
    explorerTree: {
      repositorySetupRequired:
        'Configura el repositorio en Ajustes para ver archivos.',
      emptySearch: 'No se encontraron resultados',
      emptyFilter: 'Ningún elemento coincide con las etiquetas',
      emptyDefault: 'Aún no hay archivos',
    },
    itemMenu: {
      rename: 'Renombrar',
      manageTags: 'Administrar etiquetas',
      revealInFileManager: 'Mostrar en el explorador de archivos',
      remove: 'Eliminar',
    },
    renameReferencesDialog: {
      title: '¿Actualizar menciones enlazadas?',
      description: (mentionCount: number, noteCount: number) =>
        `Se reescribirán ${mentionCount} mención${mentionCount === 1 ? '' : 'es'} enlazada${mentionCount === 1 ? '' : 's'} en ${noteCount} otra${noteCount === 1 ? '' : 's'} nota${noteCount === 1 ? '' : 's'} para que coincidan con el nuevo nombre.`,
      always: 'Actualizar siempre sin preguntar',
      yes: 'Actualizar',
      no: 'Omitir',
    },
    tagDialog: {
      title: 'Administrar etiquetas',
      description: (name: string) => `Etiquetas en ${name}`,
      activeTags: 'Etiquetas activas',
      noTags: 'Aún no hay etiquetas',
      available: 'Disponibles',
      createNew: 'Crear nueva etiqueta',
      placeholder: 'Nombre de la etiqueta...',
    },
  },
  settings: {
    title: 'Preferencias',
    description:
      'Personaliza tu santuario creativo. Estos ajustes modifican la atmósfera visual y la profundidad funcional de tu lienzo infinito.',
    canvasStyle: {
      title: 'Estilo del lienzo',
      eyebrow: 'Aspecto visual',
      options: {
        grid: 'Cuadrícula',
        dots: 'Puntos',
        blank: 'En blanco',
      },
    },
    language: {
      title: 'Idioma',
      eyebrow: 'Interfaz',
    },
    pageFrameEditing: {
      title: 'Edición de marcos de página',
      eyebrow: 'Vista de documento',
      fitWholePage: {
        label: 'Ajustar página completa al editar',
        description:
          'Alejar la vista para mostrar toda la altura de la página al entrar en la edición del marco.',
      },
      hoverPreview: {
        label: 'Mostrar vistas previas para enlaces de nota',
        description:
          'Muestra una miniatura y el título al pasar el cursor sobre una nota enlazada.',
      },
      requireModifier: {
        label: (key: string) => `Requerir ${key}-clic para abrir enlaces`,
        description: (key: string) =>
          `Cuando está desactivado, un clic simple abre enlaces de nota e hipervínculos. Cuando está activado, mantén ${key} para abrir; el clic normal coloca el cursor.`,
      },
      renameReferences: {
        label: 'Actualizar siempre los enlaces al renombrar notas',
        description:
          'Cuando está desactivado, Myelin pregunta antes de cambiar menciones enlazadas después de renombrar una nota.',
      },
    },
    repository: {
      title: 'Repositorio',
      eyebrow: 'Sincronización',
      kinds: {
        local: {
          label: 'Local',
          description: 'Notas almacenadas solo en este dispositivo',
        },
        github: {
          label: 'GitHub',
          description: 'Sincronizar con un repositorio privado de GitHub',
        },
        googleDrive: {
          label: 'Google Drive',
          description:
            'Sincronizar con una carpeta dedicada en tu Google Drive',
        },
      },
      auth: {
        title: 'Autenticación del repositorio',
        descriptions: {
          polling:
            'Introduce el código en tu navegador para completar el inicio de sesión',
          connected: 'El inicio de sesión se completó',
          unavailable: 'La autenticación no está disponible',
          signIn: 'Inicia sesión para conectar este repositorio',
        },
        errors: {
          readState: 'No se pudo leer el estado de autenticación.',
          signIn: 'Error al iniciar sesión.',
        },
        buttons: {
          signIn: 'Iniciar sesión',
          signOut: 'Cerrar sesión',
        },
        deviceCode: 'Introduce este código en tu navegador',
      },
      authStatus: {
        checking: 'Comprobando',
        authorizing: 'Autorizando',
        connected: 'Conectado',
        disconnected: 'Desconectado',
      },
      sync: {
        title: 'Sincronización del repositorio',
        queuedChanges: 'Cambios en cola',
        lastSync: 'Última sincronización',
        remoteRepository: 'Repositorio remoto',
        status: {
          setupRequired: {
            label: 'Configuración requerida',
            description:
              'Inicia sesión y elige un repositorio para habilitar la sincronización.',
          },
          loading: {
            label: 'Cargando',
            description:
              'Cargando repositorio en caché y verificando el remoto.',
          },
          pending: {
            label: 'Pendiente',
            description: (count: number, online: boolean) =>
              online
                ? `${count} cambio${count === 1 ? '' : 's'} en cola para subir.`
                : `${count} cambio${count === 1 ? '' : 's'} en cola local hasta recuperar la conexión remota.`,
          },
          issue: {
            label: 'Error',
            onlineDescription:
              'El repositorio está configurado, pero falló el último intento de sincronización.',
            offlineDescription:
              'Sincronización remota no disponible. Los datos en caché siguen disponibles localmente.',
          },
          synced: {
            label: 'Sincronizado',
            upToDate: 'El repositorio remoto está al día.',
            ready: 'El repositorio está listo para sincronizar.',
          },
        },
      },
      fields: {
        owner: {
          select: 'Seleccionar propietario',
          loading: 'Cargando cuenta...',
          error: 'Error al cargar la cuenta de GitHub.',
          you: 'Tú',
          org: 'Org',
        },
        repo: {
          pickOwner: 'Elige propietario',
          select: 'Seleccionar repositorio',
          loading: 'Cargando repositorios...',
          error: 'Error al cargar los repositorios.',
          empty: 'No hay repositorios',
        },
        branch: {
          pickRepo: 'Elige repositorio',
          select: 'Seleccionar rama',
          loading: 'Cargando ramas...',
          error: 'Error al cargar las ramas.',
          empty: 'No hay ramas',
        },
      },
    },
    keybinds: {
      title: 'Atajos de teclado',
      resetAll: 'Restablecer todo',
      pressKey: 'Pulsa una tecla...',
      unbound: 'Sin asignar',
      empty:
        'Aún no hay atajos registrados. Aparecerán cuando abras un lienzo.',
      categories: {
        app: 'Aplicación',
        canvas: 'Lienzo',
        editor: 'Editor',
      },
      actions: {
        'app:command-palette': {
          label: 'Paleta de comandos',
          description: 'Abrir comandos de la app y navegación de notas',
        },
        'canvas:undo': {
          label: 'Deshacer',
          description: 'Revertir el último cambio del lienzo',
        },
        'canvas:redo': {
          label: 'Rehacer',
          description: 'Reaplicar el último cambio revertido del lienzo',
        },
        'canvas:select-all': {
          label: 'Seleccionar todo',
          description: 'Seleccionar todo en el lienzo',
        },
        'canvas:pan': {
          label: 'Desplazar',
          description: 'Mantén pulsado para arrastrar el lienzo',
        },
        'canvas:delete': {
          label: 'Eliminar',
          description: 'Quitar los elementos seleccionados',
        },
        'canvas:tool-select': {
          label: 'Herramienta de selección',
          description: 'Seleccionar y mover elementos',
        },
        'canvas:tool-pen': {
          label: 'Herramienta de pluma',
          description: 'Dibujar con la pluma',
        },
        'canvas:tool-highlighter': {
          label: 'Herramienta de resaltador',
          description: 'Resaltar con tinta traslúcida',
        },
        'canvas:tool-eraser': {
          label: 'Herramienta de borrador',
          description: 'Borrar trazos',
        },
        'canvas:tool-text': {
          label: 'Herramienta de texto',
          description: 'Crear un nuevo nodo de texto',
        },
        'canvas:insert-frame': {
          label: 'Insertar marco de página',
          description: 'Colocar un nuevo marco de página en el lienzo',
        },
        'canvas:insert-embed': {
          label: 'Insertar medios',
          description: 'Insertar una imagen, PDF o archivo',
        },
        'editor:bold': {
          label: 'Negrita',
          description: 'Alternar formato negrita',
        },
        'editor:italic': {
          label: 'Cursiva',
          description: 'Alternar formato cursiva',
        },
        'editor:underline': {
          label: 'Subrayado',
          description: 'Alternar subrayado',
        },
        'editor:strikethrough': {
          label: 'Tachado',
          description: 'Alternar tachado',
        },
        'editor:code': {
          label: 'Código',
          description: 'Alternar código en línea',
        },
      },
    },
  },
  canvas: {
    kind: 'Lienzo',
    statusBar: {
      fps: (fps: number) => `${fps} fps`,
    },
    backlinks: {
      title: 'Backlinks',
      linkedMentions: 'Menciones enlazadas',
    },
    toolbar: {
      clickForOptions: 'clic para opciones',
      customizeWheel: 'Personalizar rueda',
      insert: 'Insertar',
    },
    insert: {
      title: 'Insertar',
      soon: 'Pronto',
      frame: {
        label: 'Marco de página',
        description: 'Una nueva página para escribir',
      },
      embed: {
        label: 'Imagen o PDF',
        description: 'Arrastra archivos o pega una URL',
      },
    },
    toolShelf: {
      title: 'Menú de herramientas',
      empty: 'Rueda desactivada; el clic derecho no la abrirá.',
    },
    tools: {
      select: 'Seleccionar',
      pen: 'Pluma',
      highlighter: 'Resaltador',
      eraser: 'Borrador',
      text: 'Texto',
    },
    toolOptions: {
      color: 'Color',
      stroke: 'Trazo',
      size: 'Tamaño',
      font: 'Fuente',
      fontSize: 'Tamaño de fuente',
      mode: 'Modo',
      rectangle: 'Rectángulo',
      lasso: 'Lazo',
      fine: (value: number) => `Fino (${value})`,
      medium: (value: number) => `Medio (${value})`,
      bold: (value: number) => `Grueso (${value})`,
      addCustomColor: 'Añadir color personalizado',
    },
    embedComposer: {
      dropToEmbed: 'Soltar para insertar',
      title: 'Añadir multimedia',
      subtitle: 'Pega, suelta o elige una imagen o un PDF.',
      readyToEmbed: 'Listo para insertar',
      embedPdf: 'Insertar PDF',
      embedImage: 'Insertar imagen',
      urlPlaceholder: 'Pega una URL',
      fetch: 'Obtener',
      browse: 'Haz clic para buscar',
      dropFiles: 'o suelta archivos aquí',
      pasteFromClipboard: 'pegar desde el portapapeles',
      embedded: 'insertado',
      errors: {
        unsupportedUrl: 'El enlace no es una imagen ni un PDF.',
        fetchFailed: 'Error al obtener el contenido del enlace.',
        embedFailed: 'No se pudo insertar ese archivo.',
        unsupportedType: '',
        unsupportedDesc: () => {
          throw new Error('not yet implemented language');
        },
      },
    },
    peerSync: {
      title: 'Sincronización P2P',
      host: 'Alojar con iroh',
      joinPlaceholder: 'Código de acceso',
      join: 'Unirse',
      waitingForPeer: 'Esperando conexión...',
      shareCode: 'Comparte este código con un colaborador',
      connecting: 'Conectando...',
      connected: 'Conectado',
      sync: 'Sincronización',
      localPeer: 'Nodo local',
      writer: 'Editor',
      writerActive: 'Editor activo',
      standby: 'En espera',
      repository: 'Repositorio',
      lastRemoteSync: 'Última sincronización remota',
      remotePeers: 'Nodos remotos',
      noRemotePeers: 'No hay nodos remotos',
      peerModes: {
        'owner-device': 'Dispositivo propietario',
        'guest-editor': 'Editor invitado',
        'guest-viewer': 'Lector invitado',
      },
      repositoryStatus: {
        localOnly: 'Solo local',
        initializing: 'Inicializando',
        offline: 'Desconectado',
        queued: (count: number) => `${count} en cola`,
        remoteSynced: 'Sincronizado',
        idle: 'Inactivo',
      },
      sessionPhase: {
        idle: 'Inactivo',
        pulling: 'Descargando (Pulling)',
        pushing: 'Subiendo (Pushing)',
        closed: 'Cerrado',
        live: (phase: string) => `En vivo / ${phase}`,
      },
    },
  },
  dialogs: {
    closeSrOnly: 'Cerrar',
  },
};

export default es;
