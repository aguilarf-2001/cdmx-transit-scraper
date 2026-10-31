/**
 * Construcción de los mensajes de notificación push. Es una copia de
 * `functions/mensajes.js` de la app (que no se puede desplegar en el plan
 * gratuito): si cambias los textos allí, cámbialos aquí. Se prueba sin
 * Firebase (ver test/avisos.test.js).
 */
const RUTA_ESTADO_SERVICIO = '/estado_servicio';

const NOMBRES_SISTEMA = {
  metro:       'STC Metro',
  metrobus:    'Metrobús',
  cablebus:    'Cablebús',
  suburbano:   'Tren Suburbano',
  interurbano: 'Tren Interurbano',
  tren_ligero: 'Tren Ligero',
  mexibus:     'Mexibús',
  mexicable:   'Mexicable',
  trolebus:    'Trolebús',
  rtp:         'RTP',
  corredor:    'Corredores CDMX',
};

function nombreSistema(id) {
  return NOMBRES_SISTEMA[id] ?? id;
}

function iconoTipo(tipo) {
  switch (tipo) {
    case 'Accidente':      return '🚨';
    case 'Retraso':        return '⏱';
    case 'Falla mecánica': return '🔧';
    case 'Clima':          return '⛈';
    default:               return 'ℹ️';
  }
}

/** "A, B, C" o "A, B, C y 4 más" para no desbordar la notificación. */
function resumenLineas(nombres, maximo = 3) {
  const lista = Array.isArray(nombres)
    ? nombres.filter((n) => typeof n === 'string' && n.trim() !== '')
    : [];
  if (lista.length <= maximo) return lista.join(', ');
  return `${lista.slice(0, maximo).join(', ')} y ${lista.length - maximo} más`;
}

/** Texto de "a quién afecta" o cadena vacía si la incidencia es general. */
function descripcionAfectacion(data) {
  const sistemaId = data.sistemaId ?? '';
  if (!sistemaId) return '';

  const lineas = resumenLineas(data.lineasNombres);
  return lineas
    ? `${nombreSistema(sistemaId)}: ${lineas}`
    : `${nombreSistema(sistemaId)}: todo el sistema`;
}

/** Datos que viajan con la notificación: la app los usa al tocarla. */
function datosIncidencia(docId, data, evento) {
  return {
    topic:     'incidencias',
    ruta:      RUTA_ESTADO_SERVICIO,
    evento,                                   // 'creada' | 'resuelta'
    docId:     String(docId),
    tipo:      String(data.tipo ?? ''),
    titulo:    String(data.titulo ?? ''),
    sistemaId: String(data.sistemaId ?? ''),
    bloquea:   data.bloqueaServicio === true ? 'true' : 'false',
  };
}

/** Mensaje al registrarse una incidencia. */
function mensajeIncidenciaNueva(docId, data) {
  const sistema = data.sistemaId ? ` · ${nombreSistema(data.sistemaId)}` : '';
  const afecta  = descripcionAfectacion(data);

  const partes = [data.titulo ?? 'Nueva incidencia registrada'];
  if (data.bloqueaServicio === true) partes.push('Servicio interrumpido');
  if (afecta) partes.push(afecta);

  return {
    title: `${iconoTipo(data.tipo)} ${data.tipo ?? 'Incidencia'}${sistema}`,
    body:  partes.join(' — '),
    data:  datosIncidencia(docId, data, 'creada'),
  };
}

/** Mensaje al resolverse (o retirarse) una incidencia. */
function mensajeIncidenciaResuelta(docId, data) {
  const afecta = descripcionAfectacion(data);
  const base = data.bloqueaServicio === true
    ? 'El servicio se restableció'
    : 'Incidencia resuelta';

  return {
    title: `✅ ${base}`,
    body:  [data.titulo ?? '', afecta].filter(Boolean).join(' — '),
    data:  datosIncidencia(docId, data, 'resuelta'),
  };
}

/** Envoltorio FCM de un mensaje de incidencia (canal, prioridad, colapso). */
function envoltorioIncidencia(docId, mensaje) {
  return {
    topic: 'incidencias',
    notification: { title: mensaje.title, body: mensaje.body },
    data: mensaje.data,
    android: {
      priority: 'high',
      notification: {
        channelId: 'incidencias',
        priority: 'high',
        // Mismo `tag` = la notificación de "resuelta" sustituye a la de
        // "creada" en vez de apilarse.
        tag: String(docId),
      },
    },
    apns: {
      headers: { 'apns-priority': '10', 'apns-collapse-id': String(docId).slice(0, 64) },
      payload: { aps: { sound: 'default', badge: 1, 'thread-id': String(docId) } },
    },
  };
}

// ── Estado de servicio ──────────────────────────────────────────────────────

// Mismo criterio que `nivelDeTexto` en la app: basta saber si el texto del
// operador es normal, porque solo entonces se aplica lo derivado del contexto.
function esNormal(texto) {
  const t = (texto ?? '').toString().toLowerCase();
  return !['suspend', 'sin servicio', 'cerrado', 'detenido', 'retras',
           'demora', 'lento', 'afluencia', 'incidencia'].some((p) => t.includes(p));
}

/**
 * Estado que la app acaba mostrando por línea: el del operador, salvo que sea
 * normal y el scraper haya derivado algo del clima, del tráfico o de la hora.
 */
function estadosEfectivos(datos) {
  if (!datos) return {};
  const condiciones = datos.condiciones ?? {};
  const salida = {};
  for (const clave of Object.keys(datos)) {
    if (!clave.startsWith('Linea_') && clave !== 'Estado') continue;
    const oficial = datos[clave];
    const derivado = condiciones[clave]?.estado;
    salida[clave] = esNormal(oficial) && derivado ? derivado : oficial;
  }
  return salida;
}

module.exports = {
  RUTA_ESTADO_SERVICIO,
  nombreSistema,
  iconoTipo,
  resumenLineas,
  descripcionAfectacion,
  mensajeIncidenciaNueva,
  mensajeIncidenciaResuelta,
  envoltorioIncidencia,
  esNormal,
  estadosEfectivos,
};
