const axios = require("axios");
const cheerio = require("cheerio");
const { nuevaPagina } = require("../utils/navegador");
const { detectarIncidentes, incidentesAEstado } = require("../utils/detector_incidentes");
const db = require("../firebase");
const admin = require("firebase-admin");

const URLS = [
  "https://treninterurbano.com.mx/",
  "https://www.tren-interurbano.com.mx/",
  "https://treninterurbano.com.mx/aviso-de-servicio",
];

async function intentarAxios() {
  for (const url of URLS) {
    try {
      const resp = await axios.get(url, {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      const $ = cheerio.load(resp.data);
      const texto = $("body").text().toLowerCase();

      const PALABRAS = ["suspendido", "retraso", "falla", "sin servicio", "paro"];
      if (PALABRAS.some((p) => texto.includes(p))) {
        return { Linea_1: "Posible afectación - Verificar fuente oficial" };
      }

      const match = texto.match(
        /(operando|normal|servicio normal|en servicio)/i
      );
      if (match) return { Linea_1: "Operando con Normalidad" };
    } catch {}
  }
  return {};
}

async function actualizarTrenInterurbano() {
  console.log("🚄 Tren Interurbano — scraping...");

  let estado = {};
  let fuente = "oficial";

  try {
    estado = await intentarAxios();
  } catch {}

  if (Object.keys(estado).length === 0) {
    const incidentes = await detectarIncidentes("Tren Interurbano El Insurgente CDMX");
    estado = { Linea_1: incidentesAEstado(incidentes) };
    fuente = "noticias";
  }

  await db.collection("estado_servicio").doc("tren_interurbano").set(
    {
      ...estado,
      fuente,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`✅ Tren Interurbano — ${JSON.stringify(estado)} fuente: ${fuente}`);
}

module.exports = actualizarTrenInterurbano;
