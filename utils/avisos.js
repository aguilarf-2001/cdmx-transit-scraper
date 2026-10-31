/**
 * Notificaciones push desde el scraper.
 *
 * Cloud Functions (que haría esto al instante) exige el plan Blaze; el scraper
 * ya corre gratis cada ~10 minutos con credenciales de administrador, así que
 * los avisos salen en el siguiente ciclo. Cubre:
 *   · incidencia nueva y resuelta (tópico `incidencias`)
 *   · cambio del estado efectivo de las líneas de un sistema (tópico
 *     `estado_servicio`)
 *
 * Recibe `db` y `messaging` por parámetro para poder probarse con dobles.
 */

const {
  nombreSistema,
  mensajeIncidenciaNueva,
  mensajeIncidenciaResuelta,
  envoltorioIncidencia,
  estadosEfectivos,
  RUTA_ESTADO_SERVICIO,
} = require("./mensajes");

/** Si cambian más sistemas que esto en un ciclo, se manda un solo aviso. */
const MAX_AVISOS_ESTADO = 4;

async function enviar(messaging, mensaje, origen, log) {
  try {
    await messaging.send(mensaje);
    log.log(`  📣 push enviado (${origen})`);
    return true;
  } catch (e) {
    log.error(`  ⚠️  push falló (${origen}): ${e.message}`);
    return false;
  }
}

// ── Incidencias ──────────────────────────────────────────────────────────────
// Cada documento lleva dos marcas, que pone este módulo: `notificadaNueva` y
// `notificadaResuelta`. Así un aviso nunca se manda dos veces aunque el ciclo
// se repita, y un fallo de FCM deja la marca sin poner para reintentar.

async function avisarIncidencias(db, messaging, log = console) {
  const snap = await db.collection("incidencias").get();
  let enviadas = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    const activa = d.activa !== false;

    if (activa && d.notificadaNueva !== true) {
      const ok = await enviar(
        messaging,
        envoltorioIncidencia(doc.id, mensajeIncidenciaNueva(doc.id, d)),
        `incidencia ${doc.id} (nueva)`,
        log
      );
      if (ok) {
        await doc.ref.update({ notificadaNueva: true });
        enviadas++;
      }
    } else if (!activa && d.notificadaNueva !== true) {
      // Creada y resuelta entre dos ciclos: nadie llegó a saber de ella.
      await doc.ref.update({ notificadaNueva: true, notificadaResuelta: true });
    } else if (!activa && d.notificadaResuelta !== true) {
      const ok = await enviar(
        messaging,
        envoltorioIncidencia(doc.id, mensajeIncidenciaResuelta(doc.id, d)),
        `incidencia ${doc.id} (resuelta)`,
        log
      );
      if (ok) {
        await doc.ref.update({ notificadaResuelta: true });
        enviadas++;
      }
    }
  }
  return enviadas;
}

// ── Estado de servicio ───────────────────────────────────────────────────────

/** Lee todos los documentos de `estado_servicio` como { sistema: datos }. */
async function leerEstados(db) {
  const snap = await db.collection("estado_servicio").get();
  const salida = {};
  snap.forEach((d) => {
    salida[d.id] = d.data();
  });
  return salida;
}

/**
 * Sistemas cuyas líneas cambiaron de estado efectivo entre `antes` y `despues`.
 * Un sistema que no existía antes no cuenta: sería un aviso falso por cada
 * línea.
 */
function cambiosDeEstado(antes, despues) {
  const cambios = [];
  for (const sistema of Object.keys(despues)) {
    if (!antes[sistema]) continue;
    const a = estadosEfectivos(antes[sistema]);
    const b = estadosEfectivos(despues[sistema]);
    const lineas = Object.keys(b).filter((k) => a[k] !== b[k]);
    if (lineas.length) cambios.push({ sistema, lineas, estados: b });
  }
  return cambios;
}

function mensajeEstado({ sistema, lineas, estados }) {
  const body =
    lineas.length === 1
      ? `${lineas[0].replace(/_/g, " ")}: ${estados[lineas[0]]}`
      : `${lineas.length} líneas actualizaron su estado`;
  return {
    topic: "estado_servicio",
    notification: { title: `🚇 ${nombreSistema(sistema)}`, body },
    data: { topic: "estado_servicio", ruta: RUTA_ESTADO_SERVICIO, sistema },
    apns: { payload: { aps: { sound: "default", badge: 1 } } },
    android: {
      priority: "high",
      notification: { channelId: "estado_servicio", priority: "high" },
    },
  };
}

async function avisarEstado(messaging, antes, despues, log = console) {
  const cambios = cambiosDeEstado(antes, despues);
  if (!cambios.length) return 0;

  // Tras un ciclo largo sin correr pueden haber cambiado muchos sistemas a la
  // vez: un solo aviso en lugar de una ráfaga.
  if (cambios.length > MAX_AVISOS_ESTADO) {
    const ok = await enviar(
      messaging,
      {
        topic: "estado_servicio",
        notification: {
          title: "🚇 Estado del servicio",
          body: `${cambios.length} sistemas actualizaron su estado`,
        },
        data: { topic: "estado_servicio", ruta: RUTA_ESTADO_SERVICIO },
        apns: { payload: { aps: { sound: "default", badge: 1 } } },
        android: {
          priority: "high",
          notification: { channelId: "estado_servicio", priority: "high" },
        },
      },
      "estado (varios sistemas)",
      log
    );
    return ok ? 1 : 0;
  }

  let enviadas = 0;
  for (const c of cambios) {
    if (await enviar(messaging, mensajeEstado(c), `estado ${c.sistema}`, log)) {
      enviadas++;
    }
  }
  return enviadas;
}

module.exports = {
  avisarIncidencias,
  avisarEstado,
  cambiosDeEstado,
  leerEstados,
  MAX_AVISOS_ESTADO,
};
