/**
 * condiciones.js — Deriva el estado de cada línea a partir del clima, el
 * tráfico y la hora, cuando el operador no reporta nada.
 *
 * Por qué existe: los operadores publican "Operando con Normalidad" casi
 * siempre, así que la pantalla quedaba en verde incluso bajo una tormenta.
 * Este paso añade lo que sí se puede saber del contexto.
 *
 * ── No sobreescribe `Linea_*` ────────────────────────────────────────────────
 * Lo derivado va a un mapa aparte, `condiciones`:
 *
 *   condiciones: {
 *     Linea_1: { estado: "Marcha lenta por lluvia", causa: "lluvia",
 *                nivel: "advertencia", origen: "clima" },
 *   }
 *
 * El dato del operador se queda intacto en `Linea_*` y manda: la app solo
 * aplica lo derivado a la línea cuyo estado oficial es normal. Así este paso
 * es idempotente —se recalcula entero en cada ciclo— y cuando la condición
 * pasa, el mapa se vacía y la línea vuelve a verde sin tener que acordarse de
 * cuál era su texto original.
 *
 * Lo derivado se marca en la app como estimado, nunca como reporte oficial.
 */

const db = require("../firebase");
const admin = require("firebase-admin");

const { eventoDelDia } = require("./evento_diario");

////////////////////////////////////////////////////////////////////////
// EXPOSICIÓN DE CADA SISTEMA
////////////////////////////////////////////////////////////////////////

/**
 * Cuánto le pega cada condición a cada sistema, de 0 a 1.
 *
 * El criterio es físico, no estadístico: el Metro va bajo tierra y el tráfico
 * no lo toca, pero concentra la afluencia; el Trolebús comparte carril y
 * cuelga de una catenaria; los cables se paran por viento y rayos, no por
 * coches.
 */
const EXPOSICION = {
  metro:            { lluvia: 0.35, trafico: 0.0,  afluencia: 1.0,  viento: 0.0 },
  metrobus:         { lluvia: 0.70, trafico: 0.55, afluencia: 0.90, viento: 0.1 },
  trolebus:         { lluvia: 1.00, trafico: 0.90, afluencia: 0.50, viento: 0.6 },
  rtp:              { lluvia: 0.80, trafico: 1.00, afluencia: 0.50, viento: 0.1 },
  corredores:       { lluvia: 0.90, trafico: 1.00, afluencia: 0.60, viento: 0.1 },
  mexibus:          { lluvia: 0.80, trafico: 0.80, afluencia: 0.80, viento: 0.1 },
  cablebus:         { lluvia: 0.85, trafico: 0.0,  afluencia: 0.30, viento: 1.0 },
  mexicable:        { lluvia: 0.85, trafico: 0.0,  afluencia: 0.30, viento: 1.0 },
  tren_ligero:      { lluvia: 0.70, trafico: 0.35, afluencia: 0.60, viento: 0.2 },
  tren_suburbano:   { lluvia: 0.45, trafico: 0.0,  afluencia: 0.80, viento: 0.1 },
  tren_interurbano: { lluvia: 0.35, trafico: 0.0,  afluencia: 0.55, viento: 0.1 },
};

// Un sistema no listado arriba se trata como transporte de superficie medio.
const EXPOSICION_POR_DEFECTO =
  { lluvia: 0.7, trafico: 0.7, afluencia: 0.6, viento: 0.2 };

////////////////////////////////////////////////////////////////////////
// INTENSIDAD DE CADA CONDICIÓN
////////////////////////////////////////////////////////////////////////

// Escala común: 0 nada, 1 leve, 2 notable, 3 severo.
const SEVERIDAD_CLIMA = { Ninguno: 0, Bajo: 1, Moderado: 2, Alto: 3 };
const SEVERIDAD_TRAFICO = { Bajo: 0, Moderado: 1, Alto: 2 };

function horaCDMX() {
  const partes = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date());
  const buscar = (t) => partes.find((p) => p.type === t)?.value ?? "";
  return {
    hora: parseInt(buscar("hour"), 10),
    minuto: parseInt(buscar("minute"), 10),
    diaSemana: buscar("weekday").toLowerCase(),
  };
}

/** Afluencia esperada por hora pico; el fin de semana la demanda se aplana. */
function severidadAfluencia() {
  const { hora, diaSemana } = horaCDMX();
  const finDeSemana = diaSemana.startsWith("sáb") || diaSemana.startsWith("sab") ||
                      diaSemana.startsWith("dom");
  if (finDeSemana) {
    return hora >= 12 && hora <= 19 ? 1 : 0;
  }
  if ((hora >= 7 && hora <= 9) || (hora >= 18 && hora <= 20)) return 3;
  if (hora === 6 || hora === 10 || hora === 17 || hora === 21) return 2;
  if (hora >= 11 && hora <= 16) return 1;
  return 0;
}

function esTormenta(codigoWMO) {
  return codigoWMO >= 95;
}

////////////////////////////////////////////////////////////////////////
// TEXTOS
////////////////////////////////////////////////////////////////////////

/**
 * El texto importa: `LineaServicio.nivel` y `LineaServicio.causa` del lado
 * Dart se deducen de estas palabras. "detenido" y "suspendido" pintan rojo;
 * "lento", "retrasos" y "afluencia" pintan amarillo.
 */
const TEXTOS = {
  tormenta: {
    critico: "Servicio detenido por tormenta eléctrica",
    advertencia: "Retrasos por tormenta eléctrica",
  },
  lluvia: {
    critico: "Servicio detenido por lluvia intensa",
    advertencia: "Marcha lenta por lluvia",
  },
  viento: {
    critico: "Servicio detenido por viento fuerte",
    advertencia: "Marcha lenta por rachas de viento",
  },
  trafico: {
    critico: "Servicio detenido por bloqueo en la vialidad",
    advertencia: "Avance lento por tráfico en la vialidad",
  },
  afluencia: {
    critico: "Acceso detenido por saturación de andenes",
    advertencia: "Alta afluencia de usuarios",
  },
};

////////////////////////////////////////////////////////////////////////
// CÁLCULO
////////////////////////////////////////////////////////////////////////

/**
 * Condición que mejor describe al sistema ahora mismo, o null.
 *
 * `severidad * exposicion` mantiene separadas las dos preguntas: qué tan
 * fuerte está la condición y a quién le pega. Lluvia Alta (3) sobre Trolebús
 * (1.0) da 3.0 y lo detiene; la misma lluvia sobre el Metro (0.35) da 1.05 y
 * ni lo menciona.
 */
function condicionDeSistema(sistema, clima, trafico) {
  const exp = EXPOSICION[sistema] ?? EXPOSICION_POR_DEFECTO;

  const codigoWMO = clima?.codigo_wmo ?? 0;
  const sevClima = SEVERIDAD_CLIMA[clima?.impacto_transporte ?? "Ninguno"] ?? 0;
  const vientoKmh = clima?.viento_kmh ?? 0;

  const candidatos = [];

  if (sevClima > 0) {
    const causa = esTormenta(codigoWMO) ? "tormenta" : "lluvia";
    // La tormenta sale de la escala a propósito: suma rayos y encharcamiento
    // de golpe, y es la única condición de clima que llega a detener una línea.
    const sev = causa === "tormenta" ? sevClima + 1 : sevClima;
    candidatos.push({ causa, puntaje: sev * exp.lluvia, origen: "clima" });
  }

  if (vientoKmh >= 40) {
    // Los cables se suspenden por viento fuerte, no se limitan a ir despacio:
    // por eso la ráfaga de 70 km/h pesa más que una lluvia intensa.
    const sev = vientoKmh >= 70 ? 4 : vientoKmh >= 55 ? 2.5 : 1;
    candidatos.push({ causa: "viento", puntaje: sev * exp.viento, origen: "clima" });
  }

  const sevTrafico = SEVERIDAD_TRAFICO[trafico?.nivel ?? "Bajo"] ?? 0;
  if (sevTrafico > 0) {
    candidatos.push({
      causa: "trafico",
      puntaje: sevTrafico * exp.trafico,
      origen: trafico?.fuente === "c5_cdmx" ? "incidentes_viales" : "trafico",
    });
  }

  const sevAfluencia = severidadAfluencia();
  if (sevAfluencia > 0) {
    candidatos.push({
      causa: "afluencia",
      puntaje: sevAfluencia * exp.afluencia,
      origen: "hora_pico",
    });
  }

  if (candidatos.length === 0) return null;

  const mejor = candidatos.reduce((a, b) => (b.puntaje > a.puntaje ? b : a));

  // Debajo de 1.8 la condición existe pero no justifica alarmar: la línea se
  // queda en verde.
  if (mejor.puntaje < 1.8) return null;

  // El umbral de rojo queda alto a propósito. Decir "detenido" sin que lo
  // diga el operador es una afirmación fuerte, y solo se sostiene donde la
  // condición de verdad para el servicio: tormenta eléctrica sobre catenaria
  // o corredor confinado, y ráfagas sobre un cable. La hora pico y el tráfico
  // no llegan nunca, y con razón: saturan, no detienen.
  const nivel = mejor.puntaje >= 3.5 ? "critico" : "advertencia";
  return {
    causa: mejor.causa,
    nivel,
    origen: mejor.origen,
    estado: TEXTOS[mejor.causa][nivel],
  };
}

////////////////////////////////////////////////////////////////////////
// APLICACIÓN
////////////////////////////////////////////////////////////////////////

/**
 * Serializa el mapa de condiciones con las claves ordenadas.
 *
 * Firestore no promete devolver las claves de un mapa en el orden en que se
 * escribieron, así que comparar el JSON tal cual daría "cambió" siempre.
 */
function huella(condiciones) {
  const mapa = condiciones ?? {};
  return Object.keys(mapa)
    .sort()
    .map((linea) => {
      const c = mapa[linea] ?? {};
      return `${linea}|${c.estado}|${c.causa}|${c.nivel}|${c.origen}`;
    })
    .join("\n");
}

async function aplicarCondiciones() {
  try {
    const [climaDoc, traficoDoc] = await Promise.all([
      db.collection("contexto").doc("clima").get(),
      db.collection("contexto").doc("trafico").get(),
    ]);

    const clima = climaDoc.exists ? climaDoc.data() : null;
    const trafico = traficoDoc.exists ? traficoDoc.data() : null;

    if (!clima && !trafico) {
      console.log("⚠️  Condiciones: sin clima ni tráfico — no hay de qué derivar");
      return;
    }

    const sistemas = await db.collection("estado_servicio").get();
    const evento = await eventoDelDia(sistemas.docs);

    let totalLineas = 0;
    let escrituras = 0;
    const resumen = [];

    for (const doc of sistemas.docs) {
      const datos = doc.data();
      // Corredores y RTP no se desglosan por línea: traen un solo `Estado`,
      // que aquí se trata como si fuera su única línea.
      const lineas = Object.keys(datos).filter((k) => k.startsWith("Linea_"));
      if (lineas.length === 0 && datos.Estado !== undefined) lineas.push("Estado");

      const condicion = condicionDeSistema(doc.id, clima, trafico);
      const condiciones = {};

      if (condicion) {
        for (const linea of lineas) {
          condiciones[linea] = { ...condicion };
        }
      }

      // El evento del día pesa sobre la condición general: es un hecho de una
      // línea concreta, no del clima de toda la ciudad.
      if (evento && evento.sistema === doc.id) {
        const linea = lineas.includes(evento.linea) ? evento.linea : lineas[0];
        if (linea) {
          condiciones[linea] = {
            estado: evento.estado,
            causa: evento.causa,
            nivel: evento.nivel,
            origen: evento.origen,
          };
        }
      }

      const n = Object.keys(condiciones).length;
      totalLineas += n;
      if (n > 0) {
        const muestra = condiciones[Object.keys(condiciones)[0]];
        resumen.push(`${doc.id}:${n}×${muestra.causa}`);
      }

      // Solo se escribe cuando lo derivado cambia. Reescribirlo cada ciclo
      // dispararía `notificarEstadoServicio` cada 5 minutos sin que ninguna
      // línea haya cambiado de estado.
      if (huella(datos.condiciones) === huella(condiciones)) {
        continue;
      }

      await doc.ref.set(
        {
          condiciones,
          condiciones_actualizacion:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      escrituras++;
    }

    if (totalLineas === 0) {
      console.log("✅  Condiciones: nada que derivar — todas las líneas sin afectación");
    } else {
      console.log(`⚠️  Condiciones: ${totalLineas} líneas afectadas — ${resumen.join(", ")}`);
    }
    console.log(`   documentos actualizados: ${escrituras}/${sistemas.size}`);
  } catch (err) {
    console.error("❌ Condiciones:", err.message);
  }
}

module.exports = aplicarCondiciones;
module.exports.condicionDeSistema = condicionDeSistema;
module.exports.severidadAfluencia = severidadAfluencia;
