const axios = require("axios");
const cheerio = require("cheerio");
const { detectarIncidentes, incidentesAEstado } = require("../utils/detector_incidentes");
const db = require("../firebase");
const admin = require("firebase-admin");

const LINEAS = ["1", "1A", "2", "2A", "3", "3A", "4"];
const URLS = [
  "https://mexibus.edomex.gob.mx/estado_servicio",
  "https://mexibus.edomex.gob.mx/",
];

async function intentarAxios() {
  for (const url of URLS) {
    try {
      const resp = await axios.get(url, {
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; transit-monitor/1.0)" },
      });
      const $ = cheerio.load(resp.data);
      const estado = {};

      $("tr, li, .linea, [class*='linea']").each((_, el) => {
        const texto = $(el).text().trim();
        const match = texto.match(
          /[Ll]ínea\s*([\dA]+)\D{0,20}?(Operando|Normal|Retraso|Cerrada|Sin servicio|Suspendida)/i
        );
        if (match) estado[`Linea_${match[1].toUpperCase()}`] = match[2];
      });

      if (Object.keys(estado).length > 0) return estado;
    } catch {}
  }
  return {};
}

async function actualizarMexibus() {
  console.log("🚌 MexiBús — scraping...");

  let estado = {};
  let fuente = "oficial";

  try {
    estado = await intentarAxios();
  } catch {}

  if (Object.keys(estado).length === 0) {
    const incidentes = await detectarIncidentes("Mexibús Estado de México");
    const estadoGeneral = incidentesAEstado(incidentes);
    LINEAS.forEach((l) => {
      estado[`Linea_${l}`] = estadoGeneral;
    });
    fuente = incidentes.length > 0 ? "noticias" : "estimado";
  }

  await db.collection("estado_servicio").doc("mexibus").set(
    {
      ...estado,
      fuente,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`✅ MexiBús — fuente: ${fuente}`);
}

module.exports = actualizarMexibus;
