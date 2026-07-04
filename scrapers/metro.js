const axios = require("axios");
const cheerio = require("cheerio");
const { nuevaPagina } = require("../utils/navegador");
const { detectarIncidentes, incidentesAEstado } = require("../utils/detector_incidentes");
const db = require("../firebase");
const admin = require("firebase-admin");

const URL_METRO = "https://www.metro.cdmx.gob.mx/la-red/estado-del-servicio";

// Líneas del Metro CDMX
const LINEAS_METRO = [
  "1","2","3","4","5","6","7","8","9","12","A","B"
];

// Intenta extraer estados con axios + cheerio (sin browser)
async function intentarAxios() {
  const resp = await axios.get(URL_METRO, {
    timeout: 12000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "es-MX,es;q=0.9",
    },
  });

  const $ = cheerio.load(resp.data);
  const estado = {};

  // Buscar celdas que mencionen número/letra de línea + estado
  $("table tr, .linea, [class*='linea'], [class*='estado']").each((_, el) => {
    const texto = $(el).text();
    const match = texto.match(
      /[Ll]ínea\s*([0-9]+[A-Ba-b]?|[A-Ba-b])\s*[:\-]?\s*(Operando|Retraso|Cerrada|Alta afluencia|Sin servicio|Suspendida)/i
    );
    if (match) {
      const linea = match[1].toUpperCase();
      estado[`Linea_${linea}`] = match[2];
    }
  });

  return estado;
}

// Usa Puppeteer interceptando la respuesta AJAX (método original mejorado)
async function intentarPuppeteer() {
  const page = await nuevaPagina();
  let htmlTabla = null;

  page.on("response", async (response) => {
    const ct = response.headers()["content-type"] ?? "";
    if (ct.includes("xml") || ct.includes("html")) {
      try {
        const text = await response.text();
        if (text.includes("Línea") || text.includes("Linea")) {
          if (!htmlTabla || text.length > htmlTabla.length) {
            htmlTabla = text;
          }
        }
      } catch {}
    }
  });

  try {
    await page.goto(URL_METRO, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 5000));
  } finally {
    await page.close();
  }

  if (!htmlTabla) return {};

  const estado = {};
  const regex =
    /[Ll]ínea\s*([0-9]+[A-Ba-b]?|[A-Ba-b]).*?(Operando|Retraso|Cerrada|Alta afluencia|Sin servicio|Suspendida)/gi;
  let match;
  while ((match = regex.exec(htmlTabla)) !== null) {
    const linea = match[1].toUpperCase();
    estado[`Linea_${linea}`] = match[2];
  }
  return estado;
}

async function scrapeMetro() {
  console.log("🚇 Metro — scraping...");

  let estado = {};
  let fuente = "oficial";

  // 1. Intentar axios+cheerio (rápido)
  try {
    estado = await intentarAxios();
  } catch {}

  // 2. Si axios no encontró nada, intentar Puppeteer
  if (Object.keys(estado).length === 0) {
    try {
      estado = await intentarPuppeteer();
      fuente = "oficial_puppeteer";
    } catch (err) {
      console.warn("⚠️ Metro Puppeteer falló:", err.message);
    }
  }

  // 3. Si aún sin datos, usar noticias para señal
  if (Object.keys(estado).length === 0) {
    const incidentes = await detectarIncidentes("Metro CDMX servicio");
    const estadoGeneral = incidentesAEstado(incidentes);
    LINEAS_METRO.forEach((l) => {
      estado[`Linea_${l}`] = estadoGeneral;
    });
    fuente = "noticias";
    console.log("📰 Metro — usando señal de noticias");
  }

  const total = Object.keys(estado).filter((k) => k.startsWith("Linea_")).length;
  console.log(`✅ Metro: ${total} líneas — fuente: ${fuente}`);

  await db.collection("estado_servicio").doc("metro").set(
    {
      ...estado,
      fuente,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

module.exports = scrapeMetro;
