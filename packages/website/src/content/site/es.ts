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
    beta: 'Beta',
    betaNote:
      'Myelin Notes está en beta y los planes de precios pueden cambiar.',
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
      'Gratis para uso personal · Sin cuenta · Tus notas nunca quedan tras un muro de pago',
    ctaPrimary: 'Descargar',
    ctaSecondary: 'Pruébalo en el navegador',
  },

  tryIt: {
    title: 'Prueba Myelin Notes en el navegador',
    description:
      'Un lienzo de Myelin para dibujar, escribir y tomar notas, directamente en el navegador y guardado en él. Descarga la app para tener todas las funciones.',
    badge: 'Versión web limitada',
    limited:
      'Esta es una versión web limitada. La app también incluye biblioteca de notas, búsqueda, grabación de audio, exportación a PDF y sincronización.',
  },

  ink: {
    pdfHeading: 'Escribe directamente sobre tus PDFs.',
    pdfBody:
      'Suelta un PDF en el lienzo y anótalo con la misma tinta que todo lo demás: rodea una ecuación, resalta una línea, garabatea en los márgenes. Cuando termines, exporta el PDF anotado.',
  },

  pages: {
    heading: 'Documentos de verdad, sobre el lienzo.',
    body: 'Los marcos de página son documentos completos de texto enriquecido: atajos de Markdown, encabezados, listas y casillas, tablas, fórmulas y bloques de código, que Pro te permite ejecutar.',
  },

  audioSearch: {
    heading: 'Grábalo. Transcríbelo. Encuéntralo en el lienzo.',
    audioBody:
      'Graba clases o reuniones sobre el lienzo. Un modelo Whisper base incluido las transcribe en el propio dispositivo para que encuentres palabras en la transcripción sin enviar el audio fuera. Pro añade modelos más precisos.',
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
      'Con Pro, usa la IA que quieras: los modelos se conectan a través de un servidor MCP local, nunca de una nube que hayamos elegido por ti.',
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

Sí. La versión gratuita es gratis para uso personal, sin límite de tiempo y con casi todas las funciones. Myelin Pro es un pago único de 49,99 USD, o 29,99 USD para estudiantes, que añade agentes de IA por MCP, ejecución de código y límites más altos. Tus notas nunca quedan tras un muro de pago.

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

  features: {
    meta: {
      title: 'Funciones | Myelin Notes',
      description:
        'Todo lo que puede hacer Myelin Notes: formas que se ajustan solas, regla y ajustes de lápiz para escribir a mano, citas y tinta anclada en PDF, páginas con diagramas Mermaid, agentes de IA por MCP local y más.',
    },
    eyebrow: 'Funciones',
    headline: 'Todo lo que puede hacer Myelin Notes.',
    subheadline:
      'La página de inicio muestra el panorama general. Aquí está el detalle: las herramientas para escribir a mano, los PDF, las páginas y el lienzo, y cómo encajan entre sí.',
    jumpNav: 'Secciones',
    sections: {
      handwriting: {
        label: 'Escritura a mano',
        heading:
          'Tinta que se siente como un lápiz, con trucos que el papel no tiene.',
        lede: 'Escribe con un lápiz óptico, con el dedo o con el ratón. Myelin endereza lo que quieres recto y deja tu letra como es.',
        details: [
          'Lápices sensibles a la presión, con estabilización ajustable para trazos más firmes',
          'Rechazo de la palma, y un modo Lápiz o Toque para decidir qué hacen tus dedos',
          'El botón del lápiz cambia a la goma, al instante o al levantar el lápiz',
          'Una goma de trazos o una precisa que borra solo lo que toca',
          'Selección por rectángulo o lazo, para mover, copiar, bloquear o reordenar',
          'Colores personalizados que guardas una vez y reutilizas, y texto con la fuente que elijas',
        ],
      },
      pdfs: {
        label: 'PDF',
        heading: 'PDF en los que trabajas, no solo que miras.',
        lede: 'Anota, cita y reorganiza PDF en el mismo lienzo que el resto de tus notas, y exporta el resultado.',
        details: [
          'Exporta el PDF anotado cuando termines',
          'Salta a cualquier página con el navegador de páginas',
          'Muestra un PDF como Páginas, o lado a lado como Columnas',
          'Pon una bandera en una página del PDF para volver a ella',
          'Encuentra palabras dentro de los PDF con la búsqueda del lienzo',
        ],
      },
      pages: {
        label: 'Páginas',
        heading: 'Páginas que hacen más que guardar texto.',
        lede: 'Los marcos de página son documentos de texto enriquecido sobre el lienzo. Escribe / para insertar lo que quieras, o escribe directamente en Markdown.',
        details: [
          'Atajos de Markdown para encabezados, listas, citas y formato',
          'Listas de tareas, avisos y tablas',
          'Bloques de fórmulas, y bloques de código que puedes ejecutar con Pro',
          '[[Enlaces entre notas]] con vista previa al pasar el cursor, actualizados al renombrar una nota',
          'Imágenes, vídeos, YouTube y tarjetas de enlace incrustados',
          'Diseño en Páginas, Columnas o Continuo',
        ],
      },
      canvas: {
        label: 'Lienzo',
        heading: 'Un lienzo infinito en el que no te pierdes.',
        lede: 'Coloca páginas, PDF, imágenes, audio y tinta donde quieras, y vuelve a cualquier punto con una tecla.',
        details: [
          'Imágenes que puedes recortar, girar, bloquear y anclar a una página',
          'Haz una foto con la cámara y colócala directamente',
          'Bloques LaTeX para ecuaciones en cualquier parte del lienzo',
          'Tema claro u oscuro, o el del sistema',
          'Reasigna los atajos de teclado en Ajustes',
        ],
      },
      sync: {
        label: 'Sincronización en directo',
        heading: 'Escribe con otros, sin un servidor que guarde tus notas.',
        lede: 'Abre una nota en dos dispositivos y se conectan directamente entre sí. Lo que escribes en uno aparece en el otro mientras lo escribes.',
        details: [
          'Los dispositivos con la misma nota abierta se encuentran solos',
          'Los cambios viajan por una conexión QUIC cifrada de extremo a extremo (iroh)',
          'Ambos dispositivos necesitan acceso al mismo repositorio de sincronización de GitHub',
          'Sin cuenta de Myelin',
        ],
      },
      agents: {
        label: 'Agentes de IA',
        heading: 'Trae tu propia IA, en tu propio equipo.',
        lede: 'Myelin no tiene un chatbot integrado. En su lugar ejecuta un servidor MCP local, para que la app de IA que ya usas pueda leer tus notas y, si lo permites, escribir en ellas. Los agentes de IA forman parte de Myelin Pro.',
        details: [
          'El servidor solo escucha en 127.0.0.1, en el puerto que elijas',
          'Copia la instrucción de instalación desde Ajustes para conectar tu agente',
          'Los agentes pueden leer notas, enlaces, páginas, PDF, imágenes, escritura a mano y capturas del lienzo',
          'La escritura sigue desactivada hasta que actives las escrituras MCP directas en Ajustes',
          'Con la escritura activada, los agentes pueden crear notas, páginas, LaTeX y tinta, y editar etiquetas',
        ],
      },
      connect: {
        label: 'Buscar y conectar',
        heading: 'Todo lo que escribes se puede encontrar.',
        lede: 'El audio, la búsqueda y los enlaces unen tus notas, así que la idea del mes pasado está a unas pocas teclas.',
      },
      more: {
        label: 'Y más',
        heading: 'Tus archivos, tu sincronización, tu idioma.',
        lede: 'Lo esencial, en una lista.',
        details: [
          'Las notas son archivos normales en tu disco, en un formato abierto (Yjs)',
          'Funciona sin conexión y sin cuenta',
          'Sincroniza entre dispositivos a través de un repositorio de GitHub que tú controlas',
          'Importa desde Goodnotes, OneNote, Obsidian, Notion, Markdown y PDF',
          'Exporta a PDF, Markdown, una bóveda de Obsidian o JSON del espacio de trabajo',
          'En inglés, español, francés y chino simplificado',
        ],
      },
    },
    clips: {
      shapes: {
        title: 'Formas que se ajustan solas',
        body: 'Dibuja a mano alzada un rectángulo, una elipse, un triángulo o una línea y deja el lápiz quieto. Se convierte en una forma limpia.',
        alt: 'Formas dibujadas a mano con el lápiz se convierten en formas limpias al dejar el lápiz quieto',
      },
      toolWheel: {
        title: 'Rueda de herramientas y ajustes de lápiz',
        body: 'Haz clic derecho para abrir una rueda con tus herramientas y lápices guardados justo donde escribes. Sin ir a la barra de herramientas.',
        alt: 'La rueda de herramientas se abre en el cursor y se elige en ella un lápiz guardado',
      },
      ruler: {
        title: 'Regla',
        body: 'Activa la Regla, arrastra su control hasta el ángulo que quieras y dibuja a lo largo del borde para una línea perfectamente recta.',
        alt: 'La regla se gira a 30 grados y un trazo tembloroso a lo largo del borde queda perfectamente recto',
      },
      lasso: {
        title: 'Ordena lo que escribiste',
        body: 'Rodea con el lazo un trozo de escritura para arrastrarlo a su sitio, o tira de una esquina para cambiar su tamaño. Selecciona un solo dibujo para girarlo con el control de encima.',
        alt: 'Se rodea la escritura con el lazo, se arrastra bajo su título y se reduce desde una esquina, y luego una flecha gira hasta señalarla',
      },
      pdfQuote: {
        title: 'Cita texto de tus PDF',
        body: 'Selecciona texto en un PDF, elige Citar y toca una página para colocarlo, con un enlace al lugar de donde salió.',
        alt: 'Una frase seleccionada en un PDF se cita en una nota como bloque de cita con un enlace al PDF',
      },
      pdfAnchor: {
        title: 'Notas que se quedan en la página',
        body: 'Lo que escribes en una página de un PDF queda unido a esa página. Si mueves el PDF o cambias su disposición, tus notas siguen en el mismo lugar de la página. Anclar a la página fija imágenes y formas de la misma manera.',
        alt: 'Se rodea y anota una fórmula en la página 2 de un PDF; luego el PDF cambia a Columnas y la tinta se mueve con su página',
      },
      slash: {
        title: 'Inserta lo que quieras con /',
        body: 'Escribe / en una página para encabezados, tablas, avisos, fórmulas y código. Un bloque de código mermaid dibuja un diagrama, y Insertar contenido convierte un enlace en un vídeo o una tarjeta de enlace.',
        alt: 'El menú / inserta un bloque de código cuyo diagrama de flujo mermaid se dibuja como diagrama, y luego Insertar contenido convierte un enlace de YouTube en una tarjeta de vídeo',
      },
      imageAnchor: {
        title: 'Imágenes que fluyen con el texto',
        body: 'Ancla una imagen a una página y el texto le hace sitio. Escribe encima y la imagen baja con las palabras.',
        alt: 'Una foto en una página se ancla, el texto le hace sitio y, al escribir encima, la foto baja',
      },
      canvasStyle: {
        title: 'Un estilo para cada lienzo',
        body: 'Elige cuadrícula, puntos, líneas o, con Pro, tu propia imagen, y ajusta los colores. Cada lienzo puede tener el suyo, y Ajustes fija el predeterminado.',
        alt: 'El panel Estilo del lienzo cambia el fondo a líneas y elige un color de papel cálido',
      },
      flags: {
        title: 'Banderas para volver',
        body: 'Coloca una bandera con la herramienta Bandera (B) y elige un tipo como Pendiente o Revisar, o crea el tuyo. Salta entre las banderas de un lienzo, o abre Banderas para filtrarlas en todas tus notas.',
        alt: 'Un encabezado recibe una bandera Pendiente y una página de un PDF una bandera Revisar; la lista de banderas salta al PDF y luego la página Banderas filtra las banderas Revisar de todas las notas',
      },
      liveCollab: {
        title: 'Colaboración en directo',
        body: 'La tinta aparece en la otra pantalla trazo a trazo mientras dibujas, y el texto letra a letra, en ambas direcciones.',
        alt: 'La tinta dibujada en un Mac aparece en el PC de Ada mientras se escribe, y luego una tarea que Ada teclea aparece en el Mac letra a letra',
      },
      agents: {
        title: 'Tu app de IA, hablando con Myelin',
        body: 'La ventana de chat representa la app de IA que uses: no forma parte de Myelin. A través de MCP en tu equipo, lee tu escritura a mano y añade al lienzo una página con un resumen escrito.',
        alt: 'Una app de IA independiente lee por MCP notas escritas a mano en Myelin y añade a su lado una página con un resumen escrito',
      },
    },
    notes: [
      {
        title: 'Grabación de audio',
        body: 'Graba una clase o una reunión directamente en el lienzo, o importa una nota de voz.',
      },
      {
        title: 'Transcripción en el dispositivo',
        body: 'Un modelo Whisper incluido transcribe en tu equipo. Toca la marca de tiempo de cualquier línea para reproducir desde ahí.',
      },
      {
        title: 'Búsqueda',
        body: 'Busca en tu biblioteca por título, etiquetas y texto o transcripciones guardados, y encuentra cualquier palabra en el lienzo abierto.',
      },
      {
        title: 'Enlaces y retroenlaces',
        body: 'Enlaza notas con [[corchetes dobles]], consulta todos los retroenlaces y pasa el cursor por un enlace para ver la nota.',
      },
      {
        title: 'Vista de grafo',
        body: 'Mira cómo se enlazan tus notas y abre cualquiera desde el grafo.',
      },
      {
        title: 'Etiquetas anidadas',
        body: 'Etiqueta tus notas, anida unas etiquetas dentro de otras y filtra la biblioteca por cualquiera de ellas.',
      },
      {
        title: 'Paleta de comandos',
        body: 'Abre una nota, crea una nueva o abre el grafo sin soltar el teclado.',
      },
      {
        title: 'Historial de versiones',
        body: 'Cada nota guarda sus versiones anteriores, y cualquiera se restaura con un clic.',
      },
    ],
    closing: {
      heading: 'Compruébalo tú mismo.',
      body: 'Gratis para uso personal y sin cuenta. Descarga la app o prueba antes un lienzo en tu navegador.',
    },
  },

  pricing: {
    meta: {
      title: 'Precios | Myelin Notes',
      description:
        'Myelin Notes es gratis para uso personal. Myelin Pro es un pago único de 49,99 USD, o 29,99 USD para estudiantes, con agentes de IA por MCP, ejecución de código y límites más altos.',
    },
    eyebrow: 'Precios',
    headline: 'Gratis para usar. Pro cuando quieras más.',
    subheadline:
      'La versión gratuita lo tiene casi todo. Pro es un pago único que desbloquea el resto y apoya el desarrollo de Myelin.',
    free: {
      name: 'Gratis',
      price: '0 USD',
      tagline: 'Para uso personal, sin límite de tiempo.',
      includesLabel: 'Incluye',
      includes: [
        'Escritura a mano, PDF, páginas y el lienzo infinito',
        'Grabación de audio con transcripción en el dispositivo',
        'Sincronización con GitHub y colaboración en directo',
        'Importación, exportación, búsqueda y enlaces',
        'Hasta 6 ajustes de lápiz personalizados',
        '2 tipos de bandera',
      ],
      cta: 'Descargar',
    },
    pro: {
      name: 'Pro',
      price: '49,99 USD',
      priceNote: 'pago único',
      tagline: 'Pagas una vez. Sin suscripción.',
      includesLabel: 'Todo lo de Gratis, y además',
      includes: [
        'Agentes de IA a través de un servidor MCP local',
        'Ejecuta bloques de código en tus páginas',
        'Tipos de bandera ilimitados',
        'Ajustes de lápiz personalizados ilimitados',
        'Tus propias imágenes como fondo del lienzo',
        'Modelos de transcripción más precisos',
        'Apoya el desarrollo de Myelin',
      ],
      cta: 'Comprar Pro',
      licenseNote:
        'Recibes una clave de licencia por correo. Desbloquea Pro en hasta 3 de tus dispositivos.',
      checkoutFailed: 'No hemos podido abrir el pago. Inténtalo de nuevo.',
    },
    student: {
      name: 'Estudiantes',
      tagline:
        'Todo lo de Pro, para estudiantes con un correo de su centro de estudios.',
      price: '29,99 USD',
      note: 'Introduce el correo de tu centro de estudios y te enviaremos un enlace al pago con precio de estudiante.',
      emailLabel: 'Correo del centro de estudios',
      submit: 'Enviar enlace',
      sending: 'Enviando…',
      sent: 'Revisa tu bandeja de entrada: te hemos enviado el enlace.',
      notAcademic:
        'No reconocemos ese correo como de un centro de estudios. Escribe a soporte si falta tu centro.',
      failed: 'No hemos podido enviar el enlace. Inténtalo de nuevo.',
      linkExpired:
        'Este enlace de estudiante ha caducado. Solicita uno nuevo más abajo.',
    },
    faqTitle: 'Preguntas sobre precios',
    faqs: [
      {
        question: '¿Cómo desbloqueo Pro?',
        answer:
          'Compra Pro y recibirás una clave de licencia por correo. Introdúcela en la app de Myelin para desbloquear Pro en ese dispositivo.',
      },
      {
        question: '¿En cuántos dispositivos puedo usarlo?',
        answer:
          'Una clave de licencia desbloquea Pro en hasta 3 de tus dispositivos.',
      },
      {
        question: '¿Es una suscripción?',
        answer: 'No. Pro es un pago único.',
      },
      {
        question: '¿Cómo funciona el precio para estudiantes?',
        answer:
          'Introduce el correo de tu centro de estudios en esta página. Si pertenece a un centro reconocido, te enviamos un enlace para comprar Pro por 29,99 USD. El enlace es válido durante 24 horas.',
      },
      {
        question: '¿Qué pasa con mis notas si sigo con la versión gratuita?',
        answer:
          'Nada. Tus notas son archivos normales en tu disco, y la versión gratuita los abre todos.',
      },
    ],
  },

  linkLabels: {
    features: 'Funciones',
    pricing: 'Precios',
    privacy: 'Privacidad',
    support: 'Ayuda',
  },

  footer: {
    nav: 'Pie de página',
    tagline: 'Escritura a mano, texto y PDFs. Una sola nota.',
    platforms: 'Mac · Windows · Linux · iPhone, iPad y Android muy pronto',
  },

  shots: {
    hero: 'Un PDF y un marco de página con texto en un mismo lienzo: el lápiz encierra una ecuación, dibuja una flecha hasta la nota, se escribe una línea y se anota a mano «¡resultado clave!»',
    pdf: 'Un PDF con una frase resaltada, una línea subrayada y «¡E = mc²!» escrito en el margen, y después el PDF anotado se exporta',
    pageFrame:
      'Un marco de página con una lista de tareas y un bloque de código TypeScript que se ejecuta y muestra su salida al lado',
    audio:
      'Una grabación de audio colocada en el lienzo, grabada, transcrita y luego encontrada buscando «entropy»',
    graph:
      'La vista de grafo de Myelin Notes, con los enlaces salientes y los retroenlaces de una nota',
  },

  canvas: {
    addCustomColor: 'Añade un color personalizado (hex, p. ej. #3b82f6)',
  },
};

export default es;
