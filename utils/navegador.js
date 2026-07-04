const puppeteer = require("puppeteer");

let _browser = null;

async function obtenerNavegador() {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }
  return _browser;
}

async function nuevaPagina() {
  const browser = await obtenerNavegador();
  const page = await browser.newPage();

  // Bloquear recursos innecesarios para acelerar scraping
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const tipo = req.resourceType();
    if (["image", "font", "media"].includes(tipo)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.setExtraHTTPHeaders({
    "Accept-Language": "es-MX,es;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });

  return page;
}

async function cerrarNavegador() {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

module.exports = { obtenerNavegador, nuevaPagina, cerrarNavegador };
