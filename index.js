const scrapeMetro          = require("./scrapers/metro");
const scrapeMetrobus       = require("./scrapers/metrobus");
const scrapeCablebus       = require("./scrapers/cablebus");
const scrapeMexibus        = require("./scrapers/mexibus");
const scrapeMexicable      = require("./scrapers/mexicable");
const scrapeRTP            = require("./scrapers/rtp");
const scrapeCorredor       = require("./scrapers/corredor");
const scrapeTrenInterurbano = require("./scrapers/tren_interurbano");
const scrapeTrenLigero     = require("./scrapers/tren_ligero");
const scrapeTrenSuburbano  = require("./scrapers/tren_suburbano");
const scrapeTrolebus       = require("./scrapers/trolebus");

const scrapearClima    = require("./utils/clima");
const scrapearTrafico  = require("./utils/trafico");
const scrapearNoticias = require("./utils/noticias");
const generarAlertas   = require("./utils/alertas");

const { cerrarNavegador } = require("./utils/navegador");

// ─────────────────────────────────────────────
//  Intervalos
// ─────────────────────────────────────────────
const INTERVALO_TRANSPORTE = 5  * 60 * 1000; //  5 min
const INTERVALO_CONTEXTO   = 10 * 60 * 1000; // 10 min
const INTERVALO_NOTICIAS   = 30 * 60 * 1000; // 30 min

const scrapers_transporte = {
  metro:           scrapeMetro,
  metrobus:        scrapeMetrobus,
  cablebus:        scrapeCablebus,
  mexibus:         scrapeMexibus,
  mexicable:       scrapeMexicable,
  rtp:             scrapeRTP,
  corredor:        scrapeCorredor,
  tren_interurbano: scrapeTrenInterurbano,
  tren_ligero:     scrapeTrenLigero,
  tren_suburbano:  scrapeTrenSuburbano,
  trolebus:        scrapeTrolebus,
};

// ─────────────────────────────────────────────
//  Ciclo de transporte (cada 5 min)
// ─────────────────────────────────────────────
async function runTransporte() {
  console.log(`\n🚀 [${new Date().toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City" })}] Actualizando estado de transporte...`);

  const results = await Promise.allSettled(
    Object.values(scrapers_transporte).map((fn) => fn())
  );

  Object.keys(scrapers_transporte).forEach((nombre, idx) => {
    if (results[idx].status === "rejected") {
      console.error(`  ❌ ${nombre}:`, results[idx].reason?.message ?? results[idx].reason);
    }
  });

  console.log("🏁 Transporte actualizado\n");
}

// ─────────────────────────────────────────────
//  Ciclo de contexto: clima + tráfico (cada 10 min)
// ─────────────────────────────────────────────
async function runContexto() {
  console.log(`\n🌤️  [${new Date().toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City" })}] Actualizando clima y tráfico...`);

  // Clima y tráfico en paralelo, luego alertas (depende del clima ya escrito)
  await Promise.allSettled([
    scrapearClima(),
    scrapearTrafico(),
  ]);

  await generarAlertas();

  console.log("🏁 Contexto actualizado\n");
}

// ─────────────────────────────────────────────
//  Ciclo de noticias (cada 30 min)
// ─────────────────────────────────────────────
async function runNoticias() {
  console.log(`\n📰 [${new Date().toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City" })}] Actualizando noticias...`);
  await scrapearNoticias();
  console.log("🏁 Noticias actualizadas\n");
}

// ─────────────────────────────────────────────
//  Arranque — modo one-shot (GitHub Actions / cron externo)
//  El scheduling lo maneja el workflow, no el proceso.
// ─────────────────────────────────────────────
async function start() {
  console.log("═══════════════════════════════════════════");
  console.log("  Movilidad Integrada — Scraper v2 (one-shot)");
  console.log(`  ${new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}`);
  console.log("═══════════════════════════════════════════\n");

  await runContexto();
  await runNoticias();
  await runTransporte();

  await cerrarNavegador();
  console.log("\n✅ Ciclo completo. Proceso terminado.");
}

process.on("SIGINT",  async () => { await cerrarNavegador(); process.exit(0); });
process.on("SIGTERM", async () => { await cerrarNavegador(); process.exit(0); });

start()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("❌ Error fatal:", err);
    await cerrarNavegador();
    process.exit(1);
  });
