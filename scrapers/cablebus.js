const axios = require("axios");
const cheerio = require("cheerio");
const { nuevaPagina } = require("../utils/navegador");
const { detectarIncidentes, incidentesAEstado } = require("../utils/detector_incidentes");
const db = require("../firebase");
const admin = require("firebase-admin");

const LINEAS = ["1", "2", "3"];
const URLS = [
  "https://www.cablebus.cdmx.gob.mx/servicio/estado-de-servicio",
  "https://www.cablebus.cdmx.gob.mx",
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
      const estado = {};

      $("tr, li, .linea, [class*='linea'], [class*='estado']").each((_, el) => {
        const texto = $(el).text().trim();
        const match = texto.match(
          /[Ll]ínea\s*(\d)\D{0,20}?(Operando|Normal|Retraso|Cerrada|Sin servicio|Suspendida)/i
        );
        if (match) estado[`Linea_${match[1]}`] = match[2];
      });

      if (Object.keys(estado).length > 0) return estado;
    } catch {}
  }
  return {};
}

async function intentarPuppeteer() {
  const page = await nuevaPagina();
  const estado = {};

  try {
    await page.goto(URLS[0], { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));

    const html = await page.content();
    const $ = cheerio.load(html);

    const texto = $("body").text();
    const regex =
      /[Ll]ínea\s*(\d)\D{0,20}?(Operando|Normal|Retraso|Cerrada|Sin servicio|Suspendida)/gi;
    let match;
    while ((match = regex.exec(texto)) !== null) {
      estado[`Linea_${match[1]}`] = match[2];
    }
  } finally {
    await page.close();
  }
  return estado;
}

async function actualizarCablebus() {
  console.log("🚡 CableBús — scraping...");

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
      console.warn("⚠️ CableBús Puppeteer falló:", err.message);
    }
  }

  if (Object.keys(estado).length === 0) {
    const incidentes = await detectarIncidentes("CableBús CDMX servicio");
    const estadoGeneral = incidentesAEstado(incidentes);
    LINEAS.forEach((l) => {
      estado[`Linea_${l}`] = estadoGeneral;
    });
    fuente = "noticias";
    console.log("📰 CableBús — usando señal de noticias");
  }

  await db.collection("estado_servicio").doc("cablebus").set(
    {
      ...estado,
      fuente,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`✅ CableBús — fuente: ${fuente}`);
}

module.exports = actualizarCablebus;
