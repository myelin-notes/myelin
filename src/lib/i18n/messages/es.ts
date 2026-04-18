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
    tagline: 'Estudio digital',
    floatingToolbar: {
      library: 'Biblioteca',
      write: 'Escribir',
      shuffle: 'Mezclar',
      cloud: 'Nube',
    },
  },
  sidebar: {
    newCanvas: 'Nuevo lienzo',
    nav: {
      library: 'Biblioteca',
      graph: 'Grafo',
      debug: 'Depuración',
      settings: 'Ajustes',
      help: 'Ayuda',
    },
  },
  library: {
    title: 'Biblioteca digital',
    emptyState:
      'Tu espacio personal de conocimiento. Crea un lienzo para empezar a recopilar ideas, notas e investigación.',
    recentlyOpened: 'Abiertos recientemente',
    searchPlaceholder: 'Buscar en el estudio...',
    explorer: 'Explorador',
    sortLabel: (label: string) => `Ordenar: ${label}`,
    sortModes: {
      'name-asc': 'Nombre (A-Z)',
      'name-desc': 'Nombre (Z-A)',
      modified: 'Modificados recientemente',
      created: 'Creados recientemente',
    },
    fileTypes: {
      mcanvas: 'Lienzo',
    },
    createNew: {
      button: 'Nuevo',
      folder: 'Nueva carpeta',
      canvas: 'Nuevo lienzo',
      untitledCanvas: 'Lienzo sin título',
      unnamedFolder: 'Carpeta sin nombre',
    },
    semanticTags: {
      title: 'Etiquetas semánticas',
      empty:
        'Todavía no hay etiquetas. Haz clic derecho en un archivo y elige "Administrar etiquetas" para empezar.',
      insights: 'Información del estudio',
      stats: {
        totalFiles: 'Archivos totales',
        folders: 'Carpetas',
        uniqueTags: 'Etiquetas únicas',
      },
    },
    explorerTree: {
      emptySearch: 'No se encontraron resultados',
      emptyFilter: 'Ningún elemento coincide con las etiquetas seleccionadas',
      emptyDefault: 'Todavía no hay archivos',
    },
    itemMenu: {
      rename: 'Renombrar',
      manageTags: 'Administrar etiquetas',
      revealInFileManager: 'Mostrar en el administrador de archivos',
      remove: 'Eliminar',
    },
    tagDialog: {
      title: 'Administrar etiquetas',
      description: (name: string) => `Etiquetas en ${name}`,
      activeTags: 'Etiquetas activas',
      noTags: 'Todavía no hay etiquetas',
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
      eyebrow: 'Capa de superficie',
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
          description: 'Sincroniza con un repositorio privado de GitHub',
        },
      },
      auth: {
        title: 'Autenticación de GitHub',
        descriptions: {
          polling:
            'Introduce el código en GitHub para terminar de iniciar sesión',
          connected: 'Sesión iniciada con GitHub',
          unavailable: 'La autenticación de GitHub no está disponible',
          signIn: 'Inicia sesión con tu cuenta de GitHub',
        },
        errors: {
          readState: 'No se pudo leer el estado de autenticación de GitHub.',
          signIn: 'No se pudo iniciar sesión.',
        },
        buttons: {
          signIn: 'Iniciar sesión',
          signOut: 'Cerrar sesión',
        },
        deviceCode: 'Introduce este código en GitHub',
      },
      authStatus: {
        checking: 'Comprobando',
        authorizing: 'Autorizando',
        connected: 'Conectado',
        disconnected: 'Sin conexión',
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
              'Cargando el repositorio en caché y comprobando el remoto.',
          },
          pending: {
            label: 'Pendiente',
            description: (count: number, online: boolean) =>
              online
                ? `${count} cambio${count === 1 ? '' : 's'} en cola para subir.`
                : `${count} cambio${count === 1 ? '' : 's'} en cola localmente hasta que se recupere la sincronización remota.`,
          },
          issue: {
            label: 'Problema',
            onlineDescription:
              'El repositorio está configurado, pero el último intento de sincronización falló.',
            offlineDescription:
              'La sincronización remota no está disponible. Los datos en caché siguen disponibles localmente.',
          },
          synced: {
            label: 'Sincronizado',
            upToDate: 'El repositorio remoto está actualizado.',
            ready: 'El repositorio está listo para sincronizarse.',
          },
        },
      },
      fields: {
        owner: {
          select: 'Seleccionar propietario',
          loading: 'Cargando cuenta...',
          error: 'No se pudo cargar la cuenta de GitHub.',
          you: 'Tú',
          org: 'Org',
        },
        repo: {
          pickOwner: 'Elige propietario',
          select: 'Seleccionar repositorio',
          loading: 'Cargando repositorios...',
          error: 'No se pudieron cargar los repositorios.',
          empty: 'No hay repositorios',
        },
        branch: {
          pickRepo: 'Elige repositorio',
          select: 'Seleccionar rama',
          loading: 'Cargando ramas...',
          error: 'No se pudieron cargar las ramas.',
          empty: 'No hay ramas',
        },
      },
    },
    keybinds: {
      title: 'Atajos',
      resetAll: 'Restablecer todo',
      pressKey: 'Pulsa una tecla...',
      unbound: 'Sin asignar',
      empty:
        'Todavía no hay atajos registrados. Aparecerán cuando abras un lienzo.',
      categories: {
        canvas: 'Lienzo',
        editor: 'Editor',
      },
      actions: {
        'canvas:pan': {
          label: 'Desplazar',
          description: 'Mantén pulsado para arrastrar el lienzo',
        },
        'canvas:delete': {
          label: 'Eliminar',
          description: 'Quitar los elementos seleccionados',
        },
        'canvas:tool-text': {
          label: 'Herramienta de texto',
          description: 'Crear un nuevo nodo de texto',
        },
        'editor:bold': {
          label: 'Negrita',
          description: 'Alternar formato en negrita',
        },
        'editor:italic': {
          label: 'Cursiva',
          description: 'Alternar formato en cursiva',
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
          description: 'Alternar formato de código en línea',
        },
      },
    },
  },
  canvas: {
    kind: 'Lienzo',
    statusBar: {
      fps: (fps: number) => `${fps} fps`,
    },
    toolbar: {
      clickForOptions: 'clic para opciones',
      customizeWheel: 'Personalizar rueda',
    },
    toolShelf: {
      title: 'Panel de herramientas',
      empty: 'La rueda está desactivada; el clic derecho no la abrirá.',
    },
    tools: {
      select: 'Seleccionar',
      pen: 'Pluma',
      highlighter: 'Resaltador',
      eraser: 'Borrador',
      text: 'Texto',
      embed: 'Insertar',
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
    },
    embedComposer: {
      dropToEmbed: 'Suelta para insertar',
      title: 'Añadir contenido',
      subtitle: 'Pega, suelta o elige una imagen o un PDF.',
      readyToEmbed: 'Listo para insertar',
      embedPdf: 'Insertar PDF',
      embedImage: 'Insertar imagen',
      urlPlaceholder: 'Pega una URL',
      fetch: 'Cargar',
      browse: 'Haz clic para buscar',
      dropFiles: 'o suelta archivos aquí',
      pasteFromClipboard: 'pegar desde el portapapeles',
      embedded: 'insertado',
      errors: {
        unsupportedUrl: 'Ese enlace no apunta a una imagen ni a un PDF.',
        fetchFailed: 'No se pudo cargar ese enlace.',
      },
    },
    peerSync: {
      title: 'Sincronización entre pares',
      host: 'Alojar con iroh',
      joinPlaceholder: 'Código compartido',
      join: 'Unirse',
      waitingForPeer: 'Esperando a otro par...',
      shareCode: 'Comparte este código con otro par',
      connecting: 'Conectando...',
      connected: 'Conectado',
      sync: 'Sincronización',
      localPeer: 'Par local',
      writer: 'Escritor',
      writerActive: 'Escritor activo',
      standby: 'En espera',
      repository: 'Repositorio',
      lastRemoteSync: 'Última sincronización remota',
      remotePeers: 'Pares remotos',
      noRemotePeers: 'No hay pares remotos',
      peerModes: {
        'owner-device': 'Dispositivo propietario',
        'guest-editor': 'Editor invitado',
        'guest-viewer': 'Lector invitado',
      },
      repositoryStatus: {
        localOnly: 'Solo local',
        initializing: 'Inicializando',
        offline: 'Sin conexión',
        queued: (count: number) => `${count} en cola`,
        remoteSynced: 'Remoto sincronizado',
        idle: 'Inactivo',
      },
      sessionPhase: {
        idle: 'Inactivo',
        pulling: 'Descargando',
        pushing: 'Subiendo',
        closed: 'Cerrado',
        live: (phase: string) => `En vivo / ${phase}`,
      },
    },
  },
  debug: {
    uploadPdf: 'Subir PDF',
    empty: 'Selecciona un PDF para renderizarlo.',
  },
  dialogs: {
    closeSrOnly: 'Cerrar',
  },
};

export default es;
