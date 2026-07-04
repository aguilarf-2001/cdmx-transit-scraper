const axios = require("axios");
const cheerio = require("cheerio");

// Palabras que indican un incidente en el transporte
const PALABRAS_INCIDENTE = [
  "falla", "fallas", "suspensión", "suspendido", "suspende",
  "cerrado", "cierre", "retraso", "retrasos", "accidente",
  "incendio", "paro", "interrupción", "afluencia", "emergencia",
  "detenido", "avería", "sin servicio", "irregularidad"
];

// Cache para no repetir peticiones en el mismo ciclo
const _cache = new Map();
const CACHE_TTL = 4 * 60 * 1000; // 4 minutos

/**
 * Busca incidentes recientes en Google News RSS para un sistema de transporte.
 * @param {string} sistemaQuery  Ej: "Metro CDMX", "MetroBús CDMX"
 * @param {number} ventanaHoras  Cuántas horas atrás buscar (default: 4)
 * @returns {string[]}  Titulares que mencionan incidentes
 */
async function detectarIncidentes(sistemaQuery, ventanaHoras = 4) {
  const cacheKey = sistemaQuery;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.items;
  }

  try {
    const q = encodeURIComponent(sistemaQuery);
    const url = `https://news.google.com/rss/search?q=${q}&hl=es-419&gl=MX&ceid=MX:es-419`;

    const resp = await axios.get(url, {
      timeout: 8000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; transit-monitor/1.0)",
        Accept: "application/rss+xml,application/xml,text/xml",
      },
    });

    const $ = cheerio.load(resp.data, { xmlMode: true });
    const corte = new Date(Date.now() - ventanaHoras * 60 * 60 * 1000);
    const encontrados = [];

    $("item").each((i, el) => {
      if (i >= 8) return false;

      const titulo = $(el).find("title").text().toLowerCase();
      const pubDate = new Date($(el).find("pubDate").text());

      if (pubDate < corte) return;

      const esIncidente = PALABRAS_INCIDENTE.some((p) => titulo.includes(p));
      if (esIncidente) {
        encontrados.push($(el).find("title").text().replace(/ - .*$/, ""));
      }
    });

    _cache.set(cacheKey, { ts: Date.now(), items: encontrados });
    return encontrados;
  } catch {
    return [];
  }
}

/**
 * Convierte resultados de incidentes a un estado legible.
 */
function incidentesAEstado(incidentes, estadoDefault = "Operando con Normalidad") {
  if (incidentes.length === 0) return estadoDefault;
  return "Posible afectación - Verificar fuente oficial";
}

module.exports = { detectarIncidentes, incidentesAEstado };
