/**
 * Reinicio diario de incidencias.
 *
 * Ninguna incidencia se conserva más de un día: a las 2:00 a. m. (hora de la
 * Ciudad de México) se borran todas. Como el scraper corre cada ~10 minutos, el
 * borrado ocurre como máximo unos minutos después de las 2:00. La app, además,
 * ignora por su cuenta las anteriores al último corte, así que en pantalla
 * desaparecen a las 2:00 en punto.
 *
 * Sin dependencias de Firebase en la parte de cálculo, para poder probarla.
 */

/** México no usa horario de verano desde 2022: CDMX es UTC-6 todo el año. */
const DESFASE_CDMX_MS = 6 * 60 * 60 * 1000;
const HORA_REINICIO = 2;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Instante (Date, UTC) del último reinicio de las 2:00 a. m. de CDMX. */
function corteReinicio(ahora = new Date()) {
  const local = new Date(ahora.getTime() - DESFASE_CDMX_MS);
  let corteLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    HORA_REINICIO
  );
  if (local.getTime() < corteLocal) corteLocal -= DIA_MS;
  return new Date(corteLocal + DESFASE_CDMX_MS);
}

/**
 * Borra las incidencias anteriores al último corte y devuelve cuántas.
 * Las que aún no tienen `timestamp` (escritura recién enviada, sin confirmar)
 * no entran en la consulta, así que nunca se borra una incidencia nueva.
 */
async function purgarIncidencias(db, { ahora = new Date(), lote = 400 } = {}) {
  const corte = corteReinicio(ahora);
  let borradas = 0;

  for (;;) {
    const snap = await db
      .collection("incidencias")
      .where("timestamp", "<", corte)
      .limit(lote)
      .get();
    if (snap.empty) return borradas;

    const escritura = db.batch();
    snap.docs.forEach((d) => escritura.delete(d.ref));
    await escritura.commit();
    borradas += snap.docs.length;
  }
}

module.exports = { corteReinicio, purgarIncidencias, HORA_REINICIO };
