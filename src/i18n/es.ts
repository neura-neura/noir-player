import type { AppMessages } from './types';

export const es: AppMessages = {
  languages: {
    en: 'Ingles',
    es: 'Espanol',
    zh: 'Chino',
  },
  overlays: {
    generic: 'Suelta el archivo aqui',
    video: 'Suelta el video para abrirlo',
    subtitle: 'Suelta el subtitulo para cargarlo',
  },
  notices: {
    welcome: 'Selecciona un video o usa Abrir con en cualquier archivo compatible.',
    videoDetected: (fileName) => `Video detectado automaticamente: ${fileName}.`,
    videoLoaded: (fileName) => `Video cargado: ${fileName}.`,
    diskReadFailed: (fileName) => `No pude abrir ${fileName} desde el disco.`,
    inspectorOpened: (selector) =>
      `DevTools abierto. Inspecciona \`${selector}\` para afinar el estilo de subtitulos por defecto.`,
    inspectorUnavailable:
      'No pude abrir DevTools aqui. En modo escritorio usa Ctrl+Shift+I.',
    cssFontRemoved: 'Quite la hoja CSS externa de fuentes.',
    cssFontReady: (familyName) => `Fuente lista: ${familyName}.`,
    cssFontLoaded: 'La hoja CSS de fuentes ya esta cargada.',
    cssFontDisabled: 'Fuente CSS desactivada. Usando una fuente instalada.',
    installedFontApplied: (familyName) => `Fuente aplicada: ${familyName}.`,
    cssFontApplied: (familyName) => `Fuente CSS aplicada: ${familyName}.`,
    subtitleProcessing: (fileName) => `Procesando ${fileName}...`,
    subtitleLoaded: (fileName) =>
      `${fileName} cargado. Ajusta sincronizacion, fuente y estilo en el panel lateral.`,
    subtitleLoadFailed: 'No pude cargar ese subtitulo.',
    openVideoFirst: 'Primero abre un video y luego arrastra el subtitulo.',
    unsupportedFile: 'Ese archivo no es un video ni un subtitulo compatible.',
    subtitleCleared: 'Subtitulo retirado. Puedes cargar otro archivo cuando quieras.',
    noPreviousCue: 'No hay un subtitulo anterior para anclar aqui.',
    noNextCue: 'No hay un siguiente subtitulo para anclar aqui.',
    previousCueAligned: 'Subtitulo anterior alineado al tiempo actual.',
    nextCueAligned: 'Siguiente subtitulo alineado al tiempo actual.',
    exportSaved: (offsetValue, savedPath) =>
      `Subtitulo exportado con desfase ${offsetValue} en ${savedPath}.`,
    exportReady: (offsetValue) =>
      `Subtitulo exportado con desfase ${offsetValue}.`,
    restoreRemoteFontFailed: 'No pude restaurar la fuente remota por defecto.',
    remoteFontLoadFailed: 'No pude cargar esa hoja CSS de fuente remota.',
    videoReadyPrompt: (fileName) =>
      `Video listo: ${fileName}. Carga subtitulos o abre DevTools para revisar estilos.`,
    videoReadyPlaying: (fileName) =>
      `Video listo: ${fileName}. La reproduccion empezo automaticamente.`,
    videoReadyPaused: (fileName) =>
      `Video listo: ${fileName}. La reproduccion esta en pausa.`,
    languageChanged: (languageName) => `Idioma cambiado a ${languageName}.`,
    embeddedSubtitleSelected: (trackName) =>
      `Subtitulo incrustado seleccionado: ${trackName}.`,
    embeddedSubtitleMissing:
      'No pude leer los cues de ese subtitulo incrustado.',
    embeddedSubtitleLoading: (trackName) =>
      `Cargando subtitulo incrustado: ${trackName}...`,
  },
  toasts: {
    subtitleSaved: (savedPath) =>
      `Subtitulos guardados en Descargas: ${savedPath}`,
    subtitleSavedFallback: 'Subtitulos ajustados descargados.',
  },
  header: {
    eyebrow: 'Player cinematografico de escritorio',
    openVideo: 'Abrir video',
    inspect: 'Inspeccionar',
    language: 'Idioma',
  },
  hero: {
    eyebrow: 'Abrir video',
    title: 'Arrastra un video o abre uno con la app.',
    copy: 'En cuanto cargue, el panel te da subtitulos, sincronizacion y ajustes de estilo.',
    selectVideo: 'Seleccionar video',
    openDevtools: 'Abrir DevTools',
    dropTitle: 'Suelta aqui cualquier video',
    dropHint: 'Tambien puedes hacer clic aqui para seleccionarlo.',
  },
  stage: {
    video: 'Video',
    subtitles: 'Subtitulos',
    noneLoaded: 'sin cargar',
    offset: 'Desfase',
    changeVideo: 'Cambiar video',
    loadSubtitles: 'Cargar subtitulos',
  },
  dock: {
    subtitles: 'Subtitulos',
    settings: 'Ajustes',
    devTools: 'DevTools',
  },
  panel: {
    loadTab: 'Cargar',
    styleTab: 'Ajustes',
    close: 'Cerrar',
    autoEyebrow: 'Listo para subtitulos',
    loadTitle: 'El video ya esta listo. Ahora carga el subtitulo.',
    loadedFile: (fileName) => `Cargado: ${fileName}`,
    emptyDrop: 'Arrastra aqui un .srt, .vtt o .zip',
    cuesReady: (cueCount) => `${cueCount} cues listos para sincronizar.`,
    dropHint: 'Tambien puedes hacer clic aqui o usar el boton de abajo.',
    selectSubtitle: 'Seleccionar subtitulo',
    processing: 'Procesando...',
    removeSubtitle: 'Quitar subtitulo',
    embeddedTitle: 'Subtitulos incrustados',
    embeddedEmpty: 'No se detectaron subtitulos incrustados en este video.',
    useEmbedded: 'Usar esta pista',
    currentEmbedded: 'Actual',
    audioTitle: 'Pistas de audio',
    audioEmpty: 'No se detectaron pistas de audio alternativas en este video.',
    currentAudio: 'Activa',
  },
  behavior: {
    title: 'Comportamiento',
    language: 'Idioma de la interfaz',
    promptForSubtitles: 'Preguntar por subtitulos al abrir un video',
    promptForSubtitlesHelp:
      'Si esta encendido, el panel de carga se abre listo para subtitulos en cuanto el video queda disponible.',
    openFullscreen: 'Abrir en pantalla completa',
    openFullscreenHelp:
      'Viene apagado por defecto. La app intentara entrar en pantalla completa cuando cargue el video.',
    openPanel: 'Abrir el menu al cargar un video',
    openPanelHelp:
      'Viene encendido por defecto. El panel lateral se despliega automaticamente cuando el video queda listo.',
    autoplay: 'Empezar a reproducir automaticamente',
    autoplayHelp:
      'Viene apagado por defecto. Si esta apagado, el video se abre en pausa.',
  },
  sync: {
    title: 'Sincronizacion',
    offset: 'Desfase',
    rememberOffset: 'Recordar desfase',
    rememberOffsetHelp:
      'Viene apagado por defecto. Si esta apagado, la app se vuelve a abrir en 0.00 s.',
    reset: 'Restablecer (0.0)',
    shiftMinusHalf: 'Mover -0.5 s',
    shiftMinusTenth: 'Mover -0.1 s',
    shiftPlusTenth: 'Mover +0.1 s',
    shiftPlusHalf: 'Mover +0.5 s',
    previousHere: 'Anterior aqui',
    nextHere: 'Siguiente aqui',
    download: 'Descargar',
    advanced: 'Avanzado',
  },
  font: {
    title: 'Fuente',
    cssLoaded: 'Cargada por CSS',
    noCss: 'No hay una hoja CSS activa en este momento.',
    cssUrl: 'URL CSS',
    cssPlaceholder: 'https://.../fonts.css',
    loadCss: 'Cargar CSS',
    cssHelper:
      'Si eliges una fuente instalada, se desactiva la fuente CSS remota.',
    installed: 'Instaladas',
    installedHelper:
      'Vista previa real de cada fuente instalada en este equipo.',
    sample: 'Aa Bb Cc 123',
    searchPlaceholder: 'Buscar fuentes instaladas...',
    previousPage: 'Anterior',
    nextPage: 'Siguiente',
    pageSummary: (currentPage, totalPages) =>
      `Pagina ${currentPage} de ${totalPages}`,
    resultsSummary: (visibleCount, totalCount) =>
      `${visibleCount} visibles de ${totalCount} fuentes encontradas.`,
    noResults: 'No hay fuentes instaladas que coincidan con esa busqueda.',
  },
  style: {
    title: 'Estilo',
    preset: 'Predeterminado',
    size: 'Tamano',
    position: 'Posicion',
    color: 'Color',
    background: 'Fondo',
    opacity: 'Opacidad',
    weight: 'Peso',
    width: 'Anchura',
    customWidth: 'Personalizada',
    widthValue: 'Valor de anchura',
    shadow: 'Sombra',
    restoreDefault: 'Restaurar estilo base',
  },
  advanced: {
    title: 'Ajustes avanzados',
    show: 'Mostrar',
    hide: 'Ocultar',
    lineHeight: 'Interlineado',
    letterSpacing: 'Espaciado',
    paddingX: 'Relleno X',
    paddingY: 'Relleno Y',
    radius: 'Radio',
  },
  footer: {
    hint: 'Tip: usa Ctrl + Shift + I para inspeccionar `.caption-text`.',
  },
  misc: {
    enabled: 'Encendido',
    disabled: 'Apagado',
  },
  errors: {
    invalidTimestamp: (rawValue) => `Tiempo de subtitulo invalido: ${rawValue}`,
    zipMissing: 'El ZIP no contiene ningun archivo .srt o .vtt.',
    noValidCues: 'No encontre cues validos dentro del subtitulo.',
  },
};
