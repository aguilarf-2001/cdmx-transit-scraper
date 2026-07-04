const axios = require("axios");
const cheerio = require("cheerio");
const { nuevaPagina } = require("../utils/navegador");
const { detectarIncidentes, incidentesAEstado } = require("../utils/detector_incidentes");
const db = require("../firebase");
const admin = require("firebase-admin");

const LINEAS = ["1", "2", "3", "4", "4N", "4S", "5", "6", "7"];
const URL_ESTADO = "https://www.metrobus.cdmx.gob.mx/mapas-de-red/estado-del-servicio";
const URL_PRINCIPAL = "https://www.metrobus.cdmx.gob.mx";

async function intentarAxios() {
  const resp = await axios.get(URL_ESTADO, {
    timeout: 12000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  const $ = cheerio.load(resp.data);
  const estado = {};

  // Buscar tabla o lista de estados por línea
  $("tr, li, .linea, [class*='linea'], [class*='ruta']").each((_, el) => {
    const texto = $(el).text().trim();
    const match = texto.match(
      /[Ll]ínea\s*(\d+[NS]?)\D{0,20}?(Operando|Normal|Retraso|Cerrada|Sin servicio|Suspendida|Alta afluencia)/i
    );
    if (match) {
      estado[`Linea_${match[1]}`] = match[2];
    }
  });

  // Buscar también por texto plano en el body
  if (Object.keys(estado).length === 0) {
    const texto = $("body").text();
    const regex =
      /[Ll]ínea\s*(\d+[NS]?)\D{0,30}?(Operando|Normal|Retraso|Cerrada|Sin servicio|Suspendida)/gi;
    let match;
    while ((match = regex.exec(texto)) !== null) {
      estado[`Linea_${match[1]}`] = match[2];
    }
  }

  return estado;
}

async function intentarPuppeteer() {
  const page = await nuevaPagina();
  const estado = {};

  try {
    await page.goto(URL_ESTADO, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));

    const html = await page.content();
    const $ = cheerio.load(html);

    $("tr, li, .linea, [class*='linea'], [class*='estado'], [class*='ruta']").each((_, el) => {
      const texto = $(el).text().trim();
      const match = texto.match(
        /[Ll]ínea\s*(\d+[NS]?)\D{0,20}?(Operando|Normal|Retraso|Cerrada|Sin servicio|Suspendida|Alta afluencia)/i
      );
      if (match) {
        estado[`Linea_${match[1]}`] = match[2];
      }
    });

    // Si el HTML está cargado pero sin tabla de estados, buscar en todo el texto
    if (Object.keys(estado).length === 0) {
      const texto = $("body").text();
      const regex =
        /[Ll]ínea\s*(\d+[NS]?)\D{0,30}?(Operando|Normal|Retraso|Cerrada|Sin servicio)/gi;
      let match;
      while ((match = regex.exec(texto)) !== null) {
        estado[`Linea_${match[1]}`] = match[2];
      }
    }
  } finally {
    await page.close();
  }

  return estado;
}

async function actualizarMetrobus() {
  console.log("🚌 MetroBús — scraping...");

  let estado = {};
  let fuente = "oficial";

  try {
    estado = await intentarAxios();
  } catch {}

  if (Object.keys(estado).length === 0) {
    try {
      estado = await intentarPuppeteer();
      fuente = "oficial_puppeteer";
    } catch (err) {
      console.warn("⚠️ MetroBús Puppeteer falló:", err.message);
    }
  }

  if (Object.keys(estado).length === 0) {
    const incidentes = await detectarIncidentes("MetroBús CDMX");
    const estadoGeneral = incidentesAEstado(incidentes);
    LINEAS.forEach((l) => {
      estado[`Linea_${l}`] = estadoGeneral;
    });
    fuente = "noticias";
    console.log("📰 MetroBús — usando señal de noticias");
  }

  const total = Object.keys(estado).filter((k) => k.startsWith("Linea_")).length;
  console.log(`✅ MetroBús: ${total} líneas — fuente: ${fuente}`);

  await db.collection("estado_servicio").doc("metrobus").set(
    {
      ...estado,
      fuente,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

module.exports = actualizarMetrobus;
