/**
 * evento_diario.js — Garantiza al menos una incidencia puntual al día en
 * alguna línea de algún sistema.
 *
 * Por qué: el clima y el tráfico explican los días malos, pero en un día
 * seco y fluido la pantalla se queda entera en verde, y la operación real
 * nunca es perfecta —siempre hay una unidad que se retira, una maniobra en la
 * vía, una revisión técnica—. Esto reserva una ventana del día para una
 * incidencia de ese tipo en una línea.
 *
 * ── Por qué es determinista y no aleatorio de verdad ─────────────────────────
 * El scraper corre cada 5 minutos y cada corrida es un proceso nuevo. Con
 * `Math.random()` la incidencia saltaría de línea en línea cada 5 minutos.
 * Sembrando el generador con la fecha de la Ciudad de México, todas las
 * corridas del mismo día eligen lo mismo: una sola incidencia, en una sola
 * línea, con principio y fin, y sin necesidad de guardar estado.
 *
 * Lo elegido queda escrito en `contexto/evento_dia` para poder auditarlo.
 */

const db = require("../firebase");
const admin = require("firebase-admin");

// La ventana vive dentro del horario de servicio y dura lo suficiente para
// que varias corridas del scraper la vean (el ciclo es de 5 min).
const HORA_MINIMA = 6;
const HORA_MAXIMA = 21;
const DURACION_MIN_MINUTOS = 60;
const DURACION_MAX_MINUTOS = 150;

// Una de cada seis acaba deteniendo la línea; el resto solo la retrasa.
const PROBABILIDAD_CRITICO = 1 / 6;

const INCIDENCIAS = [
  { causa: "mantenimiento", advertencia: "Retrasos por retiro de una unidad",
    critico: "Servicio detenido por revisión técnica en la vía" },
  { causa: "mantenimiento", advertencia: "Marcha lenta por maniobras en la vía",
    critico: "Servicio detenido por maniobras en la vía" },
  { causa: "mantenimiento", advertencia: "Retrasos por revisión técnica de una unidad",
    critico: "Servicio detenido por falla de una unidad" },
  { causa: "afluencia", advertencia: "Alta afluencia por menor número de unidades",
    critico: "Acceso detenido por saturación de andenes" },
  { causa: "accidente", advertencia: "Avance lento por un percance en la vía",
    critico: "Servicio detenido por un percance en la vía" },
  { causa: "otro", advertencia: "Retrasos por una incidencia en la vía",
    critico: "Servicio detenido por una incidencia en la vía" },
];

////////////////////////////////////////////////////////////////////////
// ALEATORIEDAD SEMBRADA
////////////////////////////////////////////////////////////////////////

function fechaCDMX() {
  // en-CA da YYYY-MM-DD, que es justo la semilla que se necesita.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function minutosDelDiaCDMX() {
  const partes = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const buscar = (t) => parseInt(partes.find((p) => p.type === t)?.value ?? "0", 10);
  return buscar("hour") * 60 + buscar("minute");
}

function semilla(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: basta para repartir, y da la misma secuencia en cada corrida. */
function generador(semillaInicial) {
  let s = semillaInicial;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

////////////////////////////////////////////////////////////////////////
// ELECCIÓN
////////////////////////////////////////////////////////////////////////

/**
 * Pares (sistema, línea) ordenados, para que el índice que saque el generador
 * signifique siempre lo mismo dentro del día.
 */
function paresDeDocumentos(docs) {
  const pares = [];
  for (const doc of docs) {
    const campos = Object.keys(doc.data());
    const lineas = campos.filter((c) => c.startsWith("Linea_"));
    // Corredores y RTP traen un solo `Estado` en lugar de líneas.
    if (lineas.length === 0 && campos.includes("Estado")) lineas.push("Estado");
    for (const linea of lineas) pares.push({ sistema: doc.id, linea });
  }
  pares.sort((a, b) =>
    a.sistema === b.sistema ? a.linea.localeCompare(b.linea)
                            : a.sistema.localeCompare(b.sistema));
  return pares;
}

function hhmm(minutos) {
  const h = Math.floor(minutos / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

/**
 * La incidencia que le toca a `dia`, sin consultar la hora: qué línea, con qué
 * texto y en qué ventana. Pura, para poder comprobar que un mismo día siempre
 * da lo mismo y que a lo largo del año reparte entre sistemas.
 */
function elegirEvento(dia, pares) {
  const rnd = generador(semilla(dia));

  const elegido = pares[Math.floor(rnd() * pares.length)];
  const inicioMin = Math.floor(
    (HORA_MINIMA + rnd() * (HORA_MAXIMA - HORA_MINIMA)) * 60);
  const duracion = Math.floor(
    DURACION_MIN_MINUTOS + rnd() * (DURACION_MAX_MINUTOS - DURACION_MIN_MINUTOS));
  const incidencia = INCIDENCIAS[Math.floor(rnd() * INCIDENCIAS.length)];
  const nivel = rnd() < PROBABILIDAD_CRITICO ? "critico" : "advertencia";

  return {
    sistema: elegido.sistema,
    linea: elegido.linea,
    causa: incidencia.causa,
    nivel,
    estado: incidencia[nivel],
    origen: "incidencia_operativa",
    inicioMin,
    finMin: inicioMin + duracion,
    inicio: hhmm(inicioMin),
    fin: hhmm(inicioMin + duracion),
  };
}

/**
 * La incidencia del día, o null si ahora mismo no está en su ventana.
 *
 * Siempre deja constancia en `contexto/evento_dia`, también fuera de la
 * ventana, para poder ver a qué hora le toca.
 */
async function eventoDelDia(docs) {
  try {
    const pares = paresDeDocumentos(
      docs ?? (await db.collection("estado_servicio").get()).docs);
    if (pares.length === 0) return null;

    const dia = fechaCDMX();
    const { inicioMin, finMin, ...evento } = elegirEvento(dia, pares);

    const ahora = minutosDelDiaCDMX();
    const activo = ahora >= inicioMin && ahora < finMin;
    evento.activo = activo;

    await db.collection("contexto").doc("evento_dia").set({
      ...evento,
      dia,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `📍 Incidencia del día: ${evento.sistema} ${evento.linea} ` +
      `${evento.inicio}–${evento.fin} (${evento.nivel}) — ` +
      (activo ? "activa ahora" : "fuera de ventana"));

    return activo ? evento : null;
  } catch (err) {
    console.error("❌ Evento diario:", err.message);
    return null;
  }
}

module.exports = { eventoDelDia, elegirEvento };
