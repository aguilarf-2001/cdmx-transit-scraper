const axios = require("axios");
const cheerio = require("cheerio");
const { detectarIncidentes, incidentesAEstado } = require("../utils/detector_incidentes");
const db = require("../firebase");
const admin = require("firebase-admin");

const URLS = [
  "https://www.rtp.cdmx.gob.mx/comunicacion/nota",
  "https://www.rtp.cdmx.gob.mx/",
];

async function intentarAxios() {
  for (const url of URLS) {
    try {
      const resp = await axios.get(url, {
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; transit-monitor/1.0)" },
      });
      const $ = cheerio.load(resp.data);
      const texto = $("body").text().toLowerCase();
      const PALABRAS = ["suspendido", "retraso", "falla", "sin servicio", "paro"];
      if (PALABRAS.some((p) => texto.includes(p))) {
        return "Posible afectación - Verificar fuente oficial";
      }
      return null;
    } catch {}
  }
  return null;
}

async function actualizarRTP() {
  console.log("🚍 RTP — scraping...");

  let estadoGeneral = null;
  let fuente = "oficial";

  try {
    estadoGeneral = await intentarAxios();
  } catch {}

  if (!estadoGeneral) {
    const incidentes = await detectarIncidentes("RTP CDMX autobús transporte");
    estadoGeneral = incidentesAEstado(incidentes);
    fuente = incidentes.length > 0 ? "noticias" : "estimado";
  }

  await db.collection("estado_servicio").doc("rtp").set(
    {
      Estado: estadoGeneral,
      fuente,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`✅ RTP — ${estadoGeneral} — fuente: ${fuente}`);
}

module.exports = actualizarRTP;
