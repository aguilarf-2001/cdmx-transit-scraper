/**
 * alertas.js — Genera alertas de impacto en transporte por clima y tráfico.
 *
 * Lee el documento `contexto/clima` ya escrito por clima.js y determina
 * qué sistemas de transporte superficial se ven afectados.
 * Escribe en `contexto/alertas` con la estructura que lee TarjetaContexto.
 *
 * Sistemas superficiales afectados por lluvia/tormenta (de mayor a menor riesgo):
 *   trolebus, corredor, rtp, metrobus, tren_ligero, cablebus, metro (estaciones)
 */

const db     = require("../firebase");
const admin  = require("firebase-admin");

// Impacto WMO → sistemas y mensajes
const IMPACTO_LLUVIA = {
  Alto: [
    { id: "trolebus",   nombre: "TroleBús",           mensaje: "Alto riesgo de retrasos por inundaciones en vías" },
    { id: "corredor",   nombre: "Corredor",            mensaje: "Posibles suspensiones en corredores superficiales" },
    { id: "rtp",        nombre: "RTP",                 mensaje: "Retrasos por condiciones en vialidades" },
    { id: "metrobus",   nombre: "MetroBús",            mensaje: "Posibles demoras en corredores BRT" },
    { id: "tren_ligero",nombre: "Tren Ligero",         mensaje: "Riesgo de demoras en tramos a nivel" },
    { id: "cablebus",   nombre: "Cablebús",            mensaje: "Posible suspensión temporal por viento/lluvia intensa" },
    { id: "metro",      nombre: "Metro",               mensaje: "Posibles encharcamientos en accesos a estaciones" },
  ],
  Moderado: [
    { id: "trolebus",   nombre: "TroleBús",            mensaje: "Posibles retrasos por agua en vías" },
    { id: "rtp",        nombre: "RTP",                 mensaje: "Posibles demoras por condiciones de la vía" },
    { id: "metrobus",   nombre: "MetroBús",            mensaje: "Posibles demoras en corredores BRT" },
    { id: "corredor",   nombre: "Corredor",            mensaje: "Tráfico lento por condiciones del pavimento" },
  ],
  Bajo: [
    { id: "trolebus",   nombre: "TroleBús",            mensaje: "Monitoreo preventivo por llovizna" },
  ],
};

const IMPACTO_TORMENTA = {
  Alto: [
    { id: "cablebus",    nombre: "Cablebús",           mensaje: "Suspensión probable por viento y rayos" },
    { id: "trolebus",    nombre: "TroleBús",           mensaje: "Riesgo eléctrico en catenaria por tormenta" },
    { id: "corredor",    nombre: "Corredor",           mensaje: "Vías inundadas — alta probabilidad de desvíos" },
    { id: "rtp",         nombre: "RTP",                mensaje: "Suspensión preventiva de rutas en zonas de riesgo" },
    { id: "metrobus",    nombre: "MetroBús",           mensaje: "Retrasos importantes en todos los corredores" },
    { id: "metro",       nombre: "Metro",              mensaje: "Inundación potencial en estaciones subterráneas" },
  ],
};

const IMPACTO_VIENTO = {
  Alto: [
    { id: "cablebus",    nombre: "Cablebús",           mensaje: "Suspensión por vientos fuertes (>50 km/h)" },
    { id: "trolebus",    nombre: "TroleBús",           mensaje: "Riesgo en pantógrafo por ráfagas" },
  ],
};

function sistemasPorCondicion(causa, impacto) {
  if (causa === "tormenta") {
    return IMPACTO_TORMENTA[impacto] ?? IMPACTO_TORMENTA.Alto;
  }
  if (causa === "viento") {
    return IMPACTO_VIENTO[impacto] ?? [];
  }
  return IMPACTO_LLUVIA[impacto] ?? [];
}

function causaDeWMO(codigo) {
  if (codigo >= 95) return "tormenta";
  if ([71, 73, 75, 77].includes(codigo)) return null; // nieve — no aplica en CDMX
  if (codigo >= 51) return "lluvia";
  if ([45, 48].includes(codigo)) return null; // neblina — sin alerta
  return null;
}

function mensajeGeneral(causa, impacto, descripcion) {
  const desc = descripcion || "";
  if (causa === "tormenta") {
    return `Tormenta eléctrica — posibles suspensiones en transporte superficial`;
  }
  if (causa === "lluvia") {
    if (impacto === "Alto") {
      return `Lluvia intensa — retrasos graves en transporte superficial`;
    }
    if (impacto === "Moderado") {
      return `Lluvia moderada — posibles demoras en superficie`;
    }
    return `Llovizna — monitoreo preventivo`;
  }
  if (causa === "viento") {
    return `Vientos fuertes — revisión de operación en cablebús`;
  }
  return desc;
}

async function generarAlertas() {
  try {
    // Leer clima actual desde Firestore (ya fue escrito por clima.js)
    const climaDoc = await db.collection("contexto").doc("clima").get();

    if (!climaDoc.exists) {
      console.log("⚠️  Alertas: no hay documento de clima aún");
      return;
    }

    const clima = climaDoc.data();
    const codigoWMO = clima.codigo_wmo ?? 0;
    const impacto   = clima.impacto_transporte ?? "Ninguno";
    const descripcion = clima.descripcion ?? "";

    const causa = causaDeWMO(codigoWMO);

    // Sin impacto significativo → marcar alertas inactivas
    if (!causa || impacto === "Ninguno") {
      await db.collection("contexto").doc("alertas").set({
        activo: false,
        causa: null,
        impacto: "Ninguno",
        mensaje_general: "Condiciones normales — sin afectación al transporte",
        sistemas_afectados: [],
        Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log("✅  Alertas: condiciones normales — sin alerta activa");
      return;
    }

    const sistemas = sistemasPorCondicion(causa, impacto);
    const mensaje  = mensajeGeneral(causa, impacto, descripcion);

    await db.collection("contexto").doc("alertas").set({
      activo: true,
      causa,
      impacto,
      mensaje_general: mensaje,
      sistemas_afectados: sistemas,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`⚠️  Alertas [${impacto}]: ${causa} — ${sistemas.length} sistemas afectados`);
  } catch (err) {
    console.error("❌ Alertas:", err.message);
  }
}

module.exports = generarAlertas;
