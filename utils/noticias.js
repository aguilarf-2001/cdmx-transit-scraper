const axios = require("axios");
const cheerio = require("cheerio");
const db = require("../firebase");
const admin = require("firebase-admin");

// Consultas para Google News RSS (sin API key)
const QUERIES = [
  { q: "Metro CDMX servicio", tag: "metro" },
  { q: "MetroBús CDMX", tag: "metrobus" },
  { q: "CableBús CDMX", tag: "cablebus" },
  { q: "Trolebús CDMX falla", tag: "trolebus" },
  { q: "Tren Suburbano CDMX", tag: "tren_suburbano" },
  { q: "Tren Interurbano CDMX", tag: "tren_interurbano" },
  { q: "transporte público CDMX incidente", tag: "general" },
];

async function parsearRSS(xmlText) {
  const $ = cheerio.load(xmlText, { xmlMode: true });
  const items = [];

  $("item").each((i, el) => {
    if (i >= 4) return false;

    const titulo = $(el).find("title").text().trim();
    const link = $(el).find("link").text().trim() || $(el).find("guid").text().trim();
    const pubDate = $(el).find("pubDate").text().trim();
    const source = $(el).find("source").text().trim() || "";

    if (titulo) {
      items.push({
        titulo: titulo.replace(/ - [^-]*$/, "").trim(),
        fuente: source,
        fecha: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        url: link,
      });
    }
  });

  return items;
}

async function scrapearNoticias() {
  try {
    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const articulos = [];

    for (const query of QUERIES) {
      try {
        const q = encodeURIComponent(query.q);
        const url = `https://news.google.com/rss/search?q=${q}&hl=es-419&gl=MX&ceid=MX:es-419`;

        const resp = await axios.get(url, {
          timeout: 8000,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; transit-monitor/1.0)",
            Accept: "application/rss+xml, text/xml",
          },
        });

        const items = await parsearRSS(resp.data);

        items.forEach((item) => {
          const fecha = new Date(item.fecha);
          if (fecha > hace24h) {
            articulos.push({ ...item, tag: query.tag });
          }
        });

        // Pequeña pausa para no saturar
        await new Promise((r) => setTimeout(r, 300));
      } catch {
        // Saltar esta query si falla
      }
    }

    // Deduplicar por título y ordenar por fecha desc
    const vistos = new Set();
    const unicos = articulos
      .filter((a) => {
        if (vistos.has(a.titulo)) return false;
        vistos.add(a.titulo);
        return true;
      })
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, 12);

    await db.collection("contexto").doc("noticias").set({
      articulos: unicos,
      total: unicos.length,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`📰 Noticias: ${unicos.length} artículos recientes`);
  } catch (err) {
    console.error("❌ Noticias:", err.message);
  }
}

module.exports = scrapearNoticias;
