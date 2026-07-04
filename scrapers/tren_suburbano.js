const axios = require("axios");
const cheerio = require("cheerio");
const { nuevaPagina } = require("../utils/navegador");
const { detectarIncidentes, incidentesAEstado } = require("../utils/detector_incidentes");
const db = require("../firebase");
const admin = require("firebase-admin");

const URLS = [
  "https://www.tren-suburbano.com.mx/",
  "https://www.tren-suburbano.com.mx/avisos-de-servicio",
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

      // Buscar avisos de servicio o alertas en la página
      const textoAviso = $(".aviso, .alerta, .servicio, .aviso-servicio, .alert").text();
      const textoBody = $("body").text();

      // Si hay texto que indica afectación
      const PALABRAS = ["suspendido", "retraso", "falla", "accidente", "sin servicio"];
      const hayAfectacion = PALABRAS.some((p) =>
        (textoAviso + textoBody).toLowerCase().includes(p)
      );

      if (hayAfectacion) {
        return { Linea_1: "Posible afectación - Verificar fuente oficial" };
      }

      // Buscar explícitamente el estado de la línea
      const match = textoBody.match(
        /[Ll]ínea\s*1?\s*[:\-]?\s*(Operando|Normal|Retraso|Cerrada|Sin servicio|Suspendida)/i
      );
      if (match) return { Linea_1: match[1] };
    } catch {}
  }
  return {};
}

async function intentarPuppeteer() {
  const page = await nuevaPagina();
  try {
    await page.goto(URLS[0], { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));

    const html = await page.content();
    const $ = cheerio.load(html);
    const texto = $("body").text().toLowerCase();

    const PALABRAS = ["suspendido", "retraso", "falla", "sin servicio"];
    if (PALABRAS.some((p) => texto.includes(p))) {
      return { Linea_1: "Posible afectación - Verificar fuente oficial" };
    }
    return { Linea_1: "Operando con Normalidad" };
  } finally {
    await page.close();
  }
}

async function actualizarTrenSuburbano() {
  console.log("🚃 Tren Suburbano — scraping...");

  let estado = {};
  let fuente = "oficial";

  try {
    estado = await intentarAxios();
  } catch {}

  if (Object.keys(estado).length === 0) {
    try {
      estado = await intentarPuppeteer();
      fuente = "oficial_puppeteer";
    } catch {}
  }

  if (Object.keys(estado).length === 0) {
    const incidentes = await detectarIncidentes("Tren Suburbano CDMX");
    estado = { Linea_1: incidentesAEstado(incidentes) };
    fuente = "noticias";
  }

  await db.collection("estado_servicio").doc("tren_suburbano").set(
    {
      ...estado,
      fuente,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`✅ Tren Suburbano — ${JSON.stringify(estado)} fuente: ${fuente}`);
}

module.exports = actualizarTrenSuburbano;
