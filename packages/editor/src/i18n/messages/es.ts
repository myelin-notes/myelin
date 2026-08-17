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
  tabBar: {
    library: 'Biblioteca',
    home: 'Inicio',
    settings: 'Ajustes',
  },
  sidebar: {
    searchPlaceholder: 'Busca en tu biblioteca...',
    searchModeText: 'Texto',
    searchModeSemantic: 'Semántica',
    explorer: 'Explorador',
    tags: 'Etiquetas',
    collapse: 'Contraer barra lateral',
    expand: 'Expandir barra lateral',
    graph: 'Abrir grafo',
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
      openGraph: {
        label: 'Abrir grafo',
        description: 'Mapear enlaces explícitos entre notas de lienzo',
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
      refreshRepository: {
        label: 'Actualizar repositorio',
        description: 'Traer los últimos cambios remotos a la biblioteca',
      },
    },
    errors: {
      createNote: 'No se pudo crear la nota',
      refreshRepository: 'No se pudo actualizar el repositorio',
    },
  },
  library: {
    title: 'Biblioteca Digital',
    emptyState: {
      title: 'Tu biblioteca está vacía',
      description:
        'Crea un lienzo para empezar a recopilar ideas, notas e investigación.',
      cta: 'Nuevo lienzo',
    },
    recentlyOpened: 'Abiertos recientemente',
    searchPlaceholder: 'Buscar en el estudio...',
    semanticSearchLabel: 'Búsqueda semántica',
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
      import: 'Importar',
      untitledCanvas: 'Lienzo sin título',
      unnamedFolder: 'Carpeta sin nombre',
    },
    importPicker: {
      title: 'Importar',
      description: 'Elige qué quieres traer a tu biblioteca.',
      files: {
        label: 'Archivos',
        description: 'Markdown, PDF, imágenes y video desde tu computadora.',
      },
      goodnotesZip: {
        label: 'ZIP de Goodnotes',
        description: 'Una carpeta de Goodnotes exportada como PDF.',
      },
      obsidianVault: {
        label: 'Bóveda de Obsidian',
        description:
          'Una carpeta de bóveda, con sus notas y archivos adjuntos.',
      },
      workspaceJson: {
        label: 'Espacio de trabajo JSON',
        description: 'Una carpeta exportada desde Myelin.',
      },
    },
    importMarkdown: {
      unsupportedFile: 'Elige un archivo Markdown (.md, .markdown o .mdx).',
      failed: 'No se pudo importar el Markdown',
    },
    importFiles: {
      unsupportedFile: 'Elige un archivo Markdown, PDF, de imagen o video.',
      someUnsupported: 'Algunos archivos no son compatibles.',
      failed: 'No se pudo importar',
      loading: 'Importando archivos...',
    },
    importGoodnotesZip: {
      unsupportedFile: 'Elige un ZIP exportado desde Goodnotes como PDF.',
      nativeFile:
        'Los archivos .goodnotes nativos aún no son compatibles. Exporta una carpeta de Goodnotes como PDF y luego importa el ZIP.',
      failed: 'No se pudo importar el ZIP de Goodnotes',
      skipped: (count: number) =>
        `${count} archivo${count === 1 ? '' : 's'} no compatible${count === 1 ? '' : 's'} omitido${count === 1 ? '' : 's'}.`,
    },
    importObsidianVault: {
      failed: 'No se pudo importar la bóveda de Obsidian',
      loading: 'Importando bóveda de Obsidian...',
      skipped: (count: number) =>
        `${count} archivo${count === 1 ? '' : 's'} no compatible${count === 1 ? '' : 's'} omitido${count === 1 ? '' : 's'}.`,
      succeeded: (notes: number, media: number) =>
        `Se importaron ${notes} nota${notes === 1 ? '' : 's'} y ${media} archivo${media === 1 ? '' : 's'} multimedia.`,
    },
    importDialog: {
      title: 'Importar bóveda de Obsidian',
      scanning: 'Escaneando bóveda...',
      jsonTitle: 'Importar espacio de trabajo JSON',
      jsonScanning: 'Escaneando carpeta...',
      jsonNoFiles: 'No se encontraron notas JSON ni multimedia en esta carpeta',
      notes: (count: number) => `${count} nota${count === 1 ? '' : 's'}`,
      media: (count: number) =>
        `${count} archivo${count === 1 ? '' : 's'} multimedia`,
      skippedFiles: (count: number) =>
        `${count} archivo${count === 1 ? '' : 's'} no compatible${count === 1 ? '' : 's'} se omitirá${count === 1 ? '' : 'n'}`,
      noFiles: 'No se encontraron archivos compatibles en esta bóveda',
      conflict: {
        label: 'Ya existe una carpeta con este nombre',
        rename: 'Conservar ambos (renombrar)',
        replace: 'Reemplazar existente',
      },
      progress: {
        importing: (current: number, total: number) =>
          `Importando ${current} de ${total}...`,
        cancelling: 'Cancelando...',
      },
      summary: {
        title: 'Importación completa',
        cancelled: 'Importación cancelada',
        imported: (notes: number, media: number) =>
          `Se importaron ${notes} nota${notes === 1 ? '' : 's'} y ${media} archivo${media === 1 ? '' : 's'} multimedia`,
        skipped: (count: number) =>
          `${count} archivo${count === 1 ? '' : 's'} no compatible${count === 1 ? '' : 's'} omitido${count === 1 ? '' : 's'}`,
      },
      buttons: {
        import: 'Importar',
        cancel: 'Cancelar',
        done: 'Listo',
      },
    },
    repositoryLoading: 'Cargando repositorio...',
    refreshRepository: {
      label: 'Actualizar repositorio',
      loading: 'Actualizando repositorio...',
      failed: 'No se pudo actualizar el repositorio',
    },
    semanticTags: {
      title: 'Etiquetas semánticas',
      empty: 'Aún no hay etiquetas',
      emptyHint: 'Crea una para filtrar tu biblioteca.',
      insights: 'Análisis del estudio',
      addTag: 'Nueva etiqueta',
      addChild: (tag: string) => `Añadir etiqueta dentro de #${tag}`,
      placeholder: 'Nombre de etiqueta...',
      deleteTag: (tag: string) => `Eliminar #${tag}`,
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
      versionHistory: 'Historial de versiones',
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
  graph: {
    title: 'Grafo',
    explicitLinks: 'Enlaces explícitos',
    searchPlaceholder: 'Buscar en el grafo...',
    recenter: 'Recentrar',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    tags: 'Etiquetas',
    openNote: 'Abrir nota',
    emptySelection: 'Selecciona una nota para inspeccionar sus enlaces.',
    noCanvasNotes: 'Aún no hay notas de lienzo.',
    noLinks: 'Agrega enlaces explícitos entre notas para conectar este grafo.',
    loadFailed: 'No se pudo cargar el grafo.',
    outgoing: 'Enlaces salientes',
    backlinks: 'Backlinks',
    graphStats: (notes: number, links: number) =>
      `${notes} nota${notes === 1 ? '' : 's'}, ${links} enlace${links === 1 ? '' : 's'}`,
    linkCount: (incoming: number, outgoing: number) =>
      `${outgoing} salientes, ${incoming} backlink${incoming === 1 ? '' : 's'}`,
  },
  versionHistory: {
    title: 'Historial de versiones',
    description: (name: string) => `Versiones anteriores de ${name}`,
    empty: 'Aún no hay versiones',
    loadFailed: 'No se pudo cargar el historial de versiones',
    restore: 'Restaurar',
    restoring: 'Restaurando...',
    restored: 'Versión restaurada',
    restoreFailed: 'No se pudo restaurar la versión',
  },
  settings: {
    title: 'Preferencias',
    theme: {
      title: 'Tema',
      eyebrow: 'Apariencia',
      options: {
        light: 'Claro',
        dark: 'Oscuro',
        system: 'Sistema',
      },
    },
    canvasStyle: {
      title: 'Estilo del lienzo',
      eyebrow: 'Aspecto visual',
      options: {
        grid: 'Cuadrícula',
        dots: 'Puntos',
        blank: 'En blanco',
      },
      backgroundColor: {
        label: 'Color de fondo',
        description:
          'Rellena el lienzo detrás del patrón con el color del tema o con uno que elijas.',
        options: {
          theme: 'Predeterminado',
          custom: 'Personalizado',
        },
        confirm: 'Aplicar',
      },
    },
    language: {
      title: 'Idioma',
      eyebrow: 'Interfaz',
    },
    pageFrameEditing: {
      title: 'Edición de marcos de página',
      eyebrow: 'Vista de documento',
      defaultPageLayout: {
        label: 'Diseño de página predeterminado',
        description:
          'Elige cómo los nuevos marcos de página organizan su contenido. Los PDF solo usan Páginas o Columnas.',
        options: {
          vertical: 'Páginas',
          horizontal: 'Columnas',
          continuous: 'Continuo',
        },
      },
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
          'Cuando está desactivado, Myelin Notes pregunta antes de cambiar menciones enlazadas después de renombrar una nota.',
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
          description: 'Sincronizar con una carpeta de tu Google Drive',
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
        notices: {
          credentialReset: (provider: string) =>
            `Tu sesión de ${provider} expiró y se restableció. Vuelve a conectar.`,
        },
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
        driveFolder: 'Carpeta de Drive',
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
        folder: {
          label: 'Nombre de la carpeta de Drive',
          placeholder: 'Myelin',
          error: 'Error al abrir la carpeta de Drive.',
        },
      },
    },
    dataExport: {
      title: 'Datos',
      eyebrow: 'Espacio de trabajo',
      export: {
        label: 'Exportar como bóveda de Obsidian',
        description:
          'Guarda todo tu espacio de trabajo en una carpeta como una bóveda compatible con Obsidian. Las notas se convierten en Markdown con frontmatter; los demás archivos se copian y se conserva la estructura de carpetas.',
        button: 'Exportar',
        defaultVaultName: 'Bóveda de Myelin Notes',
        loading: 'Exportando bóveda de Obsidian...',
        progress: (current: number, total: number) =>
          `Exportando ${current} de ${total}...`,
        failed: 'No se pudo exportar la bóveda de Obsidian',
        succeeded: (notes: number, media: number) =>
          `Se exportaron ${notes} nota${notes === 1 ? '' : 's'} y ${media} archivo${media === 1 ? '' : 's'} multimedia.`,
      },
      exportJson: {
        label: 'Exportar espacio de trabajo como JSON',
        description:
          'Guarda todo tu espacio de trabajo en una carpeta como JSON. Cada nota se convierte en un archivo JSON que codifica sus trazos, texto y multimedia incrustada (binarios en base64); los demás archivos se copian y se conserva la estructura de carpetas.',
        button: 'Exportar',
        defaultExportName: 'Exportación JSON de Myelin Notes',
        loading: 'Exportando espacio de trabajo como JSON...',
        progress: (current: number, total: number) =>
          `Exportando ${current} de ${total}...`,
        failed: 'No se pudo exportar como JSON',
        succeeded: (notes: number, media: number) =>
          `Se exportaron ${notes} nota${notes === 1 ? '' : 's'} y ${media} archivo${media === 1 ? '' : 's'} multimedia.`,
      },
    },
    privacy: {
      title: 'Privacidad',
      eyebrow: 'Datos de uso',
      analytics: {
        label: 'Compartir análisis de uso anónimos',
        description:
          'Envía análisis de producto e informes de errores anónimos para ayudar a mejorar Myelin Notes. Cuando está desactivado, no se envía nada.',
      },
      policy: {
        label: 'Política de privacidad',
        description:
          'Qué sale de tu dispositivo, quién lo recibe y cuánto tiempo se conserva. Abre trymyelin.app en tu navegador.',
      },
    },
    mcp: {
      title: 'Model Context Protocol',
      eyebrow: 'Agentes de IA',
      enabled: {
        label: 'Habilitar servidor MCP local',
        description:
          'Expone esta app de Myelin Notes en ejecución a agentes de IA locales en 127.0.0.1.',
      },
      port: {
        label: 'Puerto local',
        description:
          'El servidor se reinicia en el nuevo puerto al salir del campo.',
      },
      installPrompt: {
        label: 'Prompt de instalación para el agente',
        description:
          'Cópialo en tu agente para conectarlo a esta app en ejecución.',
        prompt: (endpoint: string) =>
          `Instala el servidor MCP de Myelin Notes para esta app de escritorio en ejecución. Usa Streamable HTTP con el endpoint ${endpoint}. Nombra el servidor myelin. Este servidor es local en este equipo, así que Myelin Notes debe permanecer abierto con MCP habilitado.`,
      },
      directWrites: {
        label: 'Permitir escrituras MCP directas',
        description:
          'Permite que los agentes creen marcos de página y reemplacen Markdown de marcos de página.',
      },
      startFailed: (port: number) =>
        `No se pudo iniciar el servidor MCP en el puerto ${port}`,
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
        'canvas:find': {
          label: 'Buscar en el lienzo',
          description: 'Buscar texto y escritura a mano en este lienzo',
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
    about: {
      title: 'Acerca de',
      eyebrow: 'Aplicación',
      version: {
        label: 'Versión',
        description: 'La versión de Myelin Notes instalada actualmente.',
      },
    },
  },
  canvas: {
    kind: 'Lienzo',
    frame: {
      noteKind: 'Nota',
      pdfKind: 'PDF',
      displayNameLabel: 'Nombre del marco de página',
      menu: 'Menú',
      openMenu: 'Abrir menú del marco',
      rename: 'Cambiar nombre',
      pages: 'Páginas',
      continuous: 'Continuo',
      columns: 'Columnas',
      export: 'Exportar',
    },
    export: {
      title: 'Exportar',
      exportCanvasPdf: 'Exportar lienzo como PDF',
      format: 'Formato',
      includeAnnotations: 'Incluir anotaciones',
      annotationsHint: 'Dibujos y notas en la página',
      exporting: 'Exportando…',
      tryAgain: 'Reintentar',
      exportedWithWarnings: 'Exportado con advertencias',
      complete: 'Exportación completa',
    },
    search: {
      placeholder: 'Buscar en el lienzo',
      noResults: 'Sin resultados',
      next: 'Coincidencia siguiente',
      previous: 'Coincidencia anterior',
    },
    statusBar: {
      fps: (fps: number) => `${fps} fps`,
    },
    slashInsert: {
      heading1: {
        title: 'Encabezado 1',
        subtitle: 'Convierte este bloque en un encabezado de nivel superior',
      },
      heading2: {
        title: 'Encabezado 2',
        subtitle: 'Convierte este bloque en un encabezado de sección',
      },
      heading3: {
        title: 'Encabezado 3',
        subtitle: 'Convierte este bloque en un encabezado pequeño',
      },
      quote: {
        title: 'Cita',
        subtitle: 'Convierte este bloque en una cita',
      },
      bulletList: {
        title: 'Lista con viñetas',
        subtitle: 'Convierte este bloque en un elemento de lista con viñetas',
      },
      numberedList: {
        title: 'Lista numerada',
        subtitle: 'Convierte este bloque en un elemento de lista numerada',
      },
      todo: {
        title: 'Tarea',
        subtitle: 'Convierte este bloque en una tarea con casilla',
      },
      paragraph: {
        title: 'Párrafo',
        subtitle: 'Restablece este bloque a texto normal',
      },
      table: {
        title: 'Tabla',
        subtitle: 'Inserta una tabla con filas de encabezado y cuerpo',
      },
      bold: {
        title: 'Negrita',
        subtitle: 'Inserta marcado **negrita**',
      },
      italic: {
        title: 'Cursiva',
        subtitle: 'Inserta marcado *cursiva*',
      },
      link: {
        title: 'Enlace',
        subtitle: 'Inserta marcado [etiqueta](url)',
      },
      noteLink: {
        title: 'Enlace a nota',
        subtitle: 'Inserta un enlace [[nota]] a otra nota',
      },
      inlineCode: {
        title: 'Código en línea',
        subtitle: 'Inserta marcado `código`',
      },
      embed: {
        title: 'Insertar contenido',
        subtitle:
          'Inserta ![alt](url): imágenes, vídeos, YouTube, tarjetas de enlace',
      },
      today: {
        title: 'Hoy',
        subtitle: 'Inserta la fecha de hoy',
      },
      tomorrow: {
        title: 'Mañana',
        subtitle: 'Inserta la fecha de mañana',
      },
      yesterday: {
        title: 'Ayer',
        subtitle: 'Inserta la fecha de ayer',
      },
      now: {
        title: 'Ahora',
        subtitle: 'Inserta la fecha y hora actuales',
      },
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
    selectionToolbar: {
      label: 'Orden de selección',
      moveHigher: 'Mover hacia delante',
      moveLower: 'Mover hacia atrás',
      delete: 'Eliminar',
      crop: 'Recortar',
      applyCrop: 'Aplicar recorte',
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
      latex: {
        label: 'LaTeX',
        description: 'Un bloque para escribir ecuaciones',
      },
      audio: {
        label: 'Audio',
        description: 'Graba o importa una nota de voz',
      },
    },
    audioPlayer: {
      requestingMic: 'Solicitando micrófono...',
      requestingMicAccess: 'Solicitando acceso al micrófono',
      micUnavailable: 'Micrófono no disponible',
      tapToRecord: 'Toca para grabar',
      waitingForRecording: 'Esperando grabación',
      startRecording: 'Iniciar grabación',
      stopRecording: 'Detener grabación',
      tryRecordingAgain: 'Intentar grabar de nuevo',
      playAudio: 'Reproducir audio',
      pauseAudio: 'Pausar audio',
      transcribe: 'Transcribir audio',
      transcribing: 'Transcribiendo audio...',
      transcribingOn: (peer: string) => `Transcribiendo en ${peer}...`,
      transcriptionUnavailable:
        'La transcripción requiere un dispositivo compatible',
      showTranscript: 'Mostrar transcripción',
      hideTranscript: 'Ocultar transcripción',
      noSpeechDetected: 'No se detectó voz',
      transcriptionFailed: 'No se pudo transcribir',
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
      decreaseFontSize: 'Reducir tamaño de fuente',
      increaseFontSize: 'Aumentar tamaño de fuente',
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
      livePaused: 'Sincronización en vivo pausada',
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
  onboarding: {
    skip: 'Omitir configuración',
    back: 'Atrás',
    continue: 'Continuar',
    finish: 'Finalizar',
    stepLabel: (current: number, total: number) =>
      `Paso ${current} de ${total}`,
    welcome: {
      eyebrow: 'Bienvenido',
      title: 'Myelin Notes',
      description:
        'Un lienzo infinito para escritura a mano, texto y todo lo que hay entre medias. Cuatro preguntas rápidas y listo.',
      language: 'Idioma',
      start: 'Empezar',
    },
    privacy: {
      eyebrow: 'Privacidad',
      title: 'Ayuda a mejorar Myelin Notes',
      description:
        'Las analíticas están desactivadas hasta que las actives aquí. Puedes cambiarlo cuando quieras en Ajustes.',
      collected:
        'Qué se envía: qué funciones se usan, la versión de la app e informes de errores.',
      notCollected:
        'Qué nunca se envía: tus notas, su contenido, los nombres de archivo ni tu escritura a mano.',
      policy: 'Leer la política de privacidad',
    },
    sync: {
      eyebrow: 'Sincronización',
      title: '¿Dónde quieres guardar tus notas?',
      description:
        'Tus notas se guardan en este dispositivo. Conecta un repositorio de GitHub o Google Drive para tener copia de seguridad y sincronizarlas entre equipos.',
      later: 'Puedes configurarlo más tarde en Ajustes.',
      incomplete:
        'Inicia sesión y termina de elegir dónde se guardan tus notas para continuar, o selecciona Local para decidirlo más tarde.',
    },
    tour: {
      eyebrow: 'Recorrido',
      title: '¿Quieres un recorrido rápido?',
      description:
        'Unas cuantas paradas por la app: tu biblioteca, la búsqueda, la barra de herramientas y cómo insertar cosas. Abre un lienzo en blanco para probar.',
      start: 'Muéstrame la app',
      skip: 'Omitir el recorrido',
      canvasName: 'Primeros pasos',
    },
    starter: {
      frameName: 'Lo básico',
      title: 'Primeros pasos',
      intro:
        'Esto es un marco de página: un documento que vive en el lienzo. Arrástralo, cambia su tamaño o coloca otro al lado.',
      tipTitle: 'Pulsa / para insertar',
      tipBody:
        'Dentro de un marco de página, `/` abre el menú de inserción: encabezados, tablas, código, fórmulas, incrustaciones y fechas.',
      codeHeading: 'Bloques de código',
      codeBody:
        'Delimita un bloque con tres comillas invertidas y un lenguaje. Lo que obtienes es un editor de verdad, no texto sombreado.',
      mathHeading: 'Fórmulas',
      mathBody:
        'Las fórmulas en línea como $E = mc^2$ caben en una frase. Delimita un bloque con `$$` para darle su propia línea:',
      diagramHeading: 'Diagramas de Mermaid',
      diagramBody:
        'Un bloque de código etiquetado como `mermaid` se dibuja como un diagrama.',
      diagramNodes: {
        idea: 'Idea',
        note: 'Nota',
        canvas: 'Lienzo',
      },
      syntaxHeading: 'Vale la pena saberlo',
      syntaxColumns: {
        type: 'Escribe esto',
        get: 'Para obtener',
      },
      syntaxRows: {
        checklist: 'Una lista de tareas',
        callout: 'Un aviso, como el de arriba',
        math: 'Un bloque de fórmulas',
      },
      linkTip:
        'Dos corchetes de apertura inician un enlace a otra nota, y el autocompletado lo termina.',
      mediaHeading: 'Imágenes, PDF y vídeo',
      mediaBody:
        'Arrastra un archivo al lienzo, o escribe / dentro de una página y elige Incrustar para colocarlo ahí. Pega un enlace de YouTube o Vimeo de la misma forma y se convierte en un reproductor.',
      checklistHeading: 'Te toca',
      checklistDone: 'Abrir el lienzo de inicio',
      checklistTodo1: 'Añadir tu propio marco de página',
      checklistTodo2: 'Escribir algo en él',
      canvas: {
        heading: 'Aquí fuera está el lienzo',
        body: 'Los cuadros de texto y los bloques de LaTeX flotan libremente. Arrástralos, escálalos o alinéalos junto a una página.',
        latexCaption: 'Un bloque de LaTeX en el lienzo:',
        toolbarHint:
          'Todo lo demás sale del botón + en la parte superior de la barra de herramientas.',
      },
    },
  },
  tour: {
    next: 'Siguiente',
    back: 'Atrás',
    done: 'Listo',
    skip: 'Omitir recorrido',
    progress: (current: number, total: number) => `${current} de ${total}`,
    steps: {
      explorer: {
        title: 'Tu biblioteca',
        description:
          'Aquí vive cada nota. Haz clic derecho en una fila para renombrarla, moverla o etiquetarla.',
      },
      search: {
        title: 'Encuentra lo que sea',
        description:
          'Busca por texto o cambia a búsqueda semántica para encontrar notas por significado en lugar de palabras exactas.',
      },
      tools: {
        title: 'La barra de herramientas',
        description:
          'Lápiz, marcador, borrador, texto y selección. Pasa el cursor por una herramienta para ver su atajo.',
      },
      insert: {
        title: 'Añade contenido',
        description:
          'Añade páginas, imágenes, PDF, audio y LaTeX directamente al lienzo.',
      },
      settings: {
        title: 'Ajustes y sincronización',
        description:
          'El tema, el idioma, la privacidad y la conexión con tu repositorio están aquí.',
      },
    },
  },
  shutdown: {
    title: 'Guardando cambios…',
    description:
      'Sincronizando cambios pendientes con tu repositorio antes de salir.',
    progress: (count: number) =>
      `Sincronizando ${count} cambio${count === 1 ? '' : 's'}…`,
    forceQuit: 'Salir de todas formas',
    forceQuitHint:
      'Los cambios sin sincronizar quedan en cola y se reintentarán al iniciar.',
  },
};

export default es;
