const { detectarIncidentes, incidentesAEstado } = require("../utils/detector_incidentes");
const db = require("../firebase");
const admin = require("firebase-admin");

async function actualizarCorredores() {
  console.log("🚌 Corredores — scraping...");

  const incidentes = await detectarIncidentes("Corredor transporte CDMX BRT");
  const estadoGeneral = incidentesAEstado(incidentes);
  const fuente = incidentes.length > 0 ? "noticias" : "estimado";

  await db.collection("estado_servicio").doc("corredores").set(
    {
      Estado: estadoGeneral,
      fuente,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`✅ Corredores — ${estadoGeneral} — fuente: ${fuente}`);
}

module.exports = actualizarCorredores;
