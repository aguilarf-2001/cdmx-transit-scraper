const { detectarIncidentes, incidentesAEstado } = require("../utils/detector_incidentes");
const db = require("../firebase");
const admin = require("firebase-admin");

async function actualizarTrenLigero() {
  console.log("🚋 Tren Ligero — scraping...");

  // Tren Ligero es operado por STC Metro; no tiene página propia de estado
  const incidentes = await detectarIncidentes("Tren Ligero CDMX Xochimilco");
  const estadoLinea = incidentesAEstado(incidentes);
  const fuente = incidentes.length > 0 ? "noticias" : "estimado";

  await db.collection("estado_servicio").doc("tren_ligero").set(
    {
      Linea_1: estadoLinea,
      fuente,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`✅ Tren Ligero — ${estadoLinea} — fuente: ${fuente}`);
}

module.exports = actualizarTrenLigero;
