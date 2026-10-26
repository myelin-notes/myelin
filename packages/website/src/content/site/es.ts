import type { SiteCopy } from './index';

/**
 * Spanish (Spain) site copy. Terminology follows the app's own catalog
 * (`@myelin/editor/i18n/messages/es`): lienzo, nota, marco de página,
 * biblioteca. Second person singular ("tú"), and "ordenador" rather than
 * "computadora".
 *
 * Site style: no em dashes.
 */
const es: SiteCopy = {
  meta: {
    title:
      'Myelin Notes: una app de notas local para escritura a mano, texto y PDFs',
    description:
      'Myelin Notes es una app de notas nativa y local para Mac, Windows y Linux, con iPhone, iPad y Android en camino: un lienzo donde la escritura a mano, el texto, los PDFs, las imágenes y el audio conviven en la misma nota, en tu propio dispositivo. Totalmente gratis para uso personal.',
  },

  topbar: {
    nav: 'Sitio',
    download: 'Descargar',
    language: 'Idioma',
  },

  sceneLabels: {
    ink: 'PDFs',
    pages: 'Páginas',
    'audio-search': 'Audio y búsqueda',
    linked: 'Notas enlazadas',
    sync: 'Sincronización',
    'local-first': 'Todo en local',
    import: 'Importar',
    download: 'Descargar',
  },
  faqKicker: 'Preguntas',

  hero: {
    eyebrow: 'Myelin Notes · una app de notas que vive en tu equipo',
    headline: 'Escritura a mano, texto y PDFs. Una sola nota.',
    headlineMark: 'Una sola nota.',
    subheadline:
      'Myelin Notes es una app de notas nativa que funciona en local: un lienzo donde la tinta, el texto enriquecido, los PDFs, las imágenes y el audio conviven. Tus notas se quedan en tu equipo, y aun así puedes editarlas en directo con otras personas, sin ningún servidor.',
    trustLine:
      'Totalmente gratis para uso personal · Sin cuenta · Tus notas nunca quedan tras un muro de pago',
    ctaPrimary: 'Descargar',
    ctaSecondary: 'Pruébalo en el navegador',
  },

  tryIt: {
    title: 'Prueba Myelin Notes en el navegador',
    description:
      'Un lienzo de Myelin en blanco para dibujar, escribir y tomar notas, directamente en el navegador. No se guarda nada: descarga la app para conservar tus notas.',
  },

  ink: {
    pdfHeading: 'Escribe directamente sobre tus PDFs.',
    pdfBody:
      'Suelta un PDF en el lienzo y anótalo con la misma tinta que todo lo demás: rodea una ecuación, resalta una línea, garabatea en los márgenes. Cuando termines, exporta el PDF anotado.',
  },

  pages: {
    heading: 'Documentos de verdad, sobre el lienzo.',
    body: 'Los marcos de página son documentos completos de texto enriquecido: atajos de Markdown, encabezados, listas y casillas, tablas, fórmulas y bloques de código que puedes ejecutar.',
  },

  audioSearch: {
    heading: 'Grábalo. Transcríbelo. Encuéntralo en el lienzo.',
    audioBody:
      'Graba clases o reuniones sobre el lienzo. Un modelo Whisper base incluido las transcribe en el propio dispositivo para que encuentres palabras en la transcripción sin enviar el audio fuera.',
    searchBody:
      'Busca en la biblioteca por título, etiquetas, texto guardado y transcripciones de audio. También puedes buscar dentro de un lienzo abierto.',
  },

  linked: {
    heading: 'Tus notas, conectadas.',
    body: 'Los [[enlaces entre notas]], los retroenlaces y las tarjetas de vista previa mantienen las ideas relacionadas a un solo salto. La paleta de comandos te lleva a cualquier parte, y el historial de versiones por archivo restaura cualquier estado anterior de una nota.',
  },

  importing: {
    heading: 'Trae contigo tus notas de siempre.',
    body: 'Importa tus notas desde otras apps',
    sources: [
      {
        id: 'goodnotes',
        label: 'Importar desde Goodnotes',
        detail:
          'Importa tu contenido de Goodnotes exportándolo como un ZIP de PDF.',
      },
      {
        id: 'onenote',
        label: 'Importar desde OneNote',
        detail:
          'Importa tu contenido de OneNote desde un cuaderno .onepkg o una sección .one.',
      },
      {
        id: 'obsidian',
        label: 'Importar desde Obsidian',
        detail:
          'Importa tu contenido de Obsidian directamente desde la carpeta del vault.',
      },
      {
        id: 'notion',
        label: 'Importar desde Notion',
        detail:
          'Importa tu contenido de Notion exportándolo como Markdown y CSV.',
      },
    ],
  },

  localFirst: {
    heading: 'Todo vive en tu ordenador.',
    lede: 'Ninguna nube por medio. Tus notas son archivos normales en tu propio disco, y Myelin funciona completamente sin conexión.',
    bullets: [
      'Tus notas son archivos normales en tu disco, en un formato abierto y sin conflictos (Yjs). Nada queda nunca atrapado.',
      'Todo funciona sin conexión, sin cuenta y sin ningún servidor por medio.',
      'Usa la IA que quieras: los modelos se conectan a través de un servidor MCP local, nunca de una nube que hayamos elegido por ti.',
      'Importa desde Obsidian o GoodNotes, exporta a PDF, imágenes o JSON, y lee cada línea del código en GitHub.',
    ],
  },

  sync: {
    heading: 'Sincroniza y colabora, sin servidor por medio.',
    kicker:
      'Editar en tiempo real suele implicar un servidor que guarda tus notas. Myelin conecta los dispositivos directamente.',
    tiers: [
      {
        badge: 'Ya disponible',
        live: true,
        title: 'Colaboración en directo',
        body: 'Dos dispositivos con la misma nota abierta se encuentran solos y editan a la vez por una conexión QUIC cifrada directa entre ambos (iroh).',
      },
      {
        badge: 'Ya disponible',
        live: true,
        title: 'Sincronización con GitHub',
        body: 'Apunta Myelin a un repositorio y una rama, y tu espacio de trabajo se sincroniza entre dispositivos a través de un repositorio que controlas tú.',
      },
      {
        badge: 'Muy pronto',
        title: 'Invitaciones',
        body: 'Suma a alguien a una sola nota sin entregarle el repositorio entero, con roles de propietario, editor y lector que deciden qué puede hacer.',
      },
    ],
  },

  download: {
    body: 'Disponible en español, inglés, francés y chino simplificado.',
    cta: 'Descargar Myelin Notes',
    platforms: [
      {
        key: 'mac',
        name: 'macOS',
        label: 'Descargar para macOS',
        sub: 'macOS 10.15+',
      },
      {
        key: 'windows',
        name: 'Windows',
        label: 'Descargar para Windows',
        sub: 'Windows 10+',
      },
      {
        key: 'linux',
        name: 'Linux',
        label: 'Descargar para Linux',
        sub: 'AppImage',
      },
      {
        key: 'ios',
        name: 'iOS',
        label: 'Descargar para iOS',
        sub: 'iPhone y iPad',
      },
      {
        key: 'android',
        name: 'Android',
        label: 'Descargar para Android',
        sub: 'Móvil y tablet',
      },
    ],
    comingSoon: 'Muy pronto',
    mobileBadge:
      'iPhone, iPad y Android están en camino: las mismas notas, no un visor recortado',
    faqTitle: 'Preguntas frecuentes',
    faqMarkdown: `# Preguntas frecuentes

## ¿De verdad es gratis?

Sí, totalmente gratis para uso personal.

## ¿Dónde se guardan mis notas?

En local, como archivos en tu equipo. Con sincronización opcional por GitHub si las quieres en un repositorio que controlas tú.

## ¿Necesito una cuenta?

No. Myelin Notes no tiene ningún sistema de cuentas: lo descargas, lo abres y tus notas están en tu disco. Solo inicias sesión con GitHub si activas la sincronización con GitHub, y esa es tu cuenta con GitHub, no una con nosotros.

## ¿Es de código abierto?

No del todo. El código es público, así que cualquiera puede leerlo y comprobar qué hace la app con sus notas, y es de uso gratuito para fines personales y otros fines no comerciales. Se publica bajo la licencia PolyForm Strict 1.0.0, lo que significa que no puedes redistribuirlo ni publicar versiones modificadas, y el uso comercial necesita una licencia aparte.

## ¿Puedo colaborar con otras personas?

Sí, en directo y de igual a igual, ya hoy. No hay cuenta de Myelin ni nada en medio. Los dispositivos se encuentran a través de la sincronización con GitHub, así que ambos extremos necesitan acceso al mismo repositorio. Los cuadernos compartidos con permisos llegan en la v1.0.

## ¿Puedo importar desde otra app?

Sí. Myelin importa un vault de Obsidian, un cuaderno .onepkg o una sección .one de OneNote, una carpeta de Goodnotes exportada como PDF, archivos sueltos de Markdown, PDF, imágenes y video, y una carpeta de espacio de trabajo exportada desde el propio Myelin. Notion entra a través de su propia exportación en Markdown y CSV, que lee el importador de archivos; un importador de Notion dedicado, que conserve la jerarquía de páginas, está en la hoja de ruta.

## ¿Funciona sin conexión?

Del todo. La edición, la búsqueda por texto y semántica, el reconocimiento de escritura a mano, la transcripción de audio, la anotación de PDFs y la exportación se ejecutan en tu propio equipo, así que la app se comporta igual con la red apagada. Solo la sincronización con GitHub y la colaboración en directo necesitan conexión, y ambas son opcionales.

## ¿Y en iPhone, iPad y Android?

Muy pronto. Hoy Myelin Notes funciona en Mac, Windows y Linux. Las apps móviles están en desarrollo, y serán nativas en lugar de un visor recortado: las mismas notas, el mismo lienzo y la misma sincronización que las apps de escritorio, con Apple Pencil en iPad y S Pen o lápiz activo en Android.
`,
  },

  linkLabels: {
    privacy: 'Privacidad',
    support: 'Ayuda',
  },

  footer: {
    nav: 'Pie de página',
    tagline: 'Escritura a mano, texto y PDFs. Una sola nota.',
    platforms: 'Mac · Windows · Linux · iPhone, iPad y Android muy pronto',
  },

  shots: {
    pdf: 'Un PDF incrustado en el lienzo de Myelin, con una ecuación enmarcada y una flecha dibujada a mano al lado',
    pageFrame:
      'Un marco de página de Myelin con encabezados, enlaces entre notas, una lista de tareas, fórmulas en línea y bloques de código ejecutándose con su salida al lado',
    audio:
      'Una grabación en el lienzo de Myelin, con su forma de onda dibujándose mientras captura',
    graph:
      'La vista de grafo de Myelin Notes, con los enlaces salientes y los retroenlaces de una nota',
  },

  canvas: {
    addCustomColor: 'Añade un color personalizado (hex, p. ej. #3b82f6)',
  },
};

export default es;
