const { detectarIncidentes, incidentesAEstado } = require("../utils/detector_incidentes");
const db = require("../firebase");
const admin = require("firebase-admin");

async function actualizarMexicable() {
  console.log("🚠 Mexicable — scraping...");

  const incidentes = await detectarIncidentes("Mexicable Estado de México teleférico");
  const estadoGeneral = incidentesAEstado(incidentes);
  const fuente = incidentes.length > 0 ? "noticias" : "estimado";

  await db.collection("estado_servicio").doc("mexicable").set(
    {
      Linea_1: estadoGeneral,
      Linea_2: estadoGeneral,
      fuente,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`✅ Mexicable — ${estadoGeneral} — fuente: ${fuente}`);
}

module.exports = actualizarMexicable;
