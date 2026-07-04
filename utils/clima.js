const axios = require("axios");
const db = require("../firebase");
const admin = require("firebase-admin");

// Coordenadas del Zócalo, CDMX
const LAT = 19.4326;
const LON = -99.1332;

// Códigos WMO → descripción en español
const WMO = {
  0: "Despejado",
  1: "Mayormente despejado",
  2: "Parcialmente nublado",
  3: "Nublado",
  45: "Neblina",
  48: "Neblina con escarcha",
  51: "Llovizna leve",
  53: "Llovizna moderada",
  55: "Llovizna densa",
  61: "Lluvia leve",
  63: "Lluvia moderada",
  65: "Lluvia fuerte",
  71: "Nieve leve",
  73: "Nieve moderada",
  75: "Nieve fuerte",
  77: "Granizo",
  80: "Chubascos leves",
  81: "Chubascos moderados",
  82: "Chubascos intensos",
  85: "Nevadas leves",
  86: "Nevadas fuertes",
  95: "Tormenta eléctrica",
  96: "Tormenta con granizo leve",
  99: "Tormenta con granizo fuerte",
};

// Códigos WMO que pueden afectar el transporte
const CODIGOS_IMPACTO_ALTO = [65, 75, 82, 85, 86, 95, 96, 99];
const CODIGOS_IMPACTO_MEDIO = [61, 63, 71, 73, 80, 81];
const CODIGOS_IMPACTO_BAJO = [45, 48, 51, 53, 55];

async function scrapearClima() {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${LAT}&longitude=${LON}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,` +
      `precipitation,weather_code,wind_speed_10m,uv_index` +
      `&timezone=America%2FMexico_City` +
      `&forecast_days=1`;

    const resp = await axios.get(url, { timeout: 10000 });
    const c = resp.data.current;

    const codigo = c.weather_code ?? 0;
    const descripcion = WMO[codigo] ?? "Sin datos";

    let impacto = "Ninguno";
    if (CODIGOS_IMPACTO_ALTO.includes(codigo)) {
      impacto = "Alto";
    } else if (CODIGOS_IMPACTO_MEDIO.includes(codigo)) {
      impacto = "Moderado";
    } else if (CODIGOS_IMPACTO_BAJO.includes(codigo)) {
      impacto = "Bajo";
    }

    await db.collection("contexto").doc("clima").set({
      temperatura: Math.round(c.temperature_2m ?? 0),
      sensacion_termica: Math.round(c.apparent_temperature ?? 0),
      humedad: Math.round(c.relative_humidity_2m ?? 0),
      precipitacion_mm: c.precipitation ?? 0,
      viento_kmh: Math.round(c.wind_speed_10m ?? 0),
      indice_uv: c.uv_index ?? 0,
      descripcion,
      codigo_wmo: codigo,
      impacto_transporte: impacto,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`☁️  Clima: ${descripcion} ${Math.round(c.temperature_2m)}°C — impacto: ${impacto}`);
  } catch (err) {
    console.error("❌ Clima:", err.message);
  }
}

module.exports = scrapearClima;
