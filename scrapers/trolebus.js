const axios = require("axios");
const cheerio = require("cheerio");
const { detectarIncidentes, incidentesAEstado } = require("../utils/detector_incidentes");
const db = require("../firebase");
const admin = require("firebase-admin");

const LINEAS = ["1","2","3","4","5","6","7","8","9","10","11","12","13"];

const URLS = [
  "https://www.rtp.cdmx.gob.mx/informacion/trolebus",
  "https://semovi.cdmx.gob.mx/programas-y-proyectos/trolebus",
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
      const PALABRAS = ["suspendido", "retraso", "falla", "sin servicio"];
      if (PALABRAS.some((p) => texto.includes(p))) {
        return "Posible afectación - Verificar fuente oficial";
      }
      return null;
    } catch {}
  }
  return null;
}

async function actualizarTrolebus() {
  console.log("🚎 Trolebús — scraping...");

  let estadoGeneral = null;
  let fuente = "oficial";

  try {
    estadoGeneral = await intentarAxios();
  } catch {}

  if (!estadoGeneral) {
    const incidentes = await detectarIncidentes("Trolebús CDMX");
    estadoGeneral = incidentesAEstado(incidentes);
    fuente = incidentes.length > 0 ? "noticias" : "estimado";
  }

  const estado = {};
  LINEAS.forEach((l) => {
    estado[`Linea_${l}`] = estadoGeneral;
  });

  await db.collection("estado_servicio").doc("trolebus").set(
    {
      ...estado,
      fuente,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`✅ Trolebús — ${estadoGeneral} — fuente: ${fuente}`);
}

module.exports = actualizarTrolebus;
