// node --test   (desde scraper/)
const test = require("node:test");
const assert = require("node:assert/strict");
const { corteReinicio, purgarIncidencias } = require("../utils/reinicio_incidencias");

// CDMX es UTC-6 todo el año: las 2:00 a. m. locales son las 08:00 UTC.
const utc = (...a) => new Date(Date.UTC(...a));

test("antes de las 2 a. m. el corte es el de ayer", () => {
  assert.deepEqual(corteReinicio(utc(2026, 9, 31, 7, 30)), utc(2026, 9, 30, 8));
});
test("a las 2:00 en punto ya cuenta el nuevo día", () => {
  assert.deepEqual(corteReinicio(utc(2026, 9, 31, 8)), utc(2026, 9, 31, 8));
});
test("durante el día el corte es el de esa mañana", () => {
  assert.deepEqual(corteReinicio(utc(2026, 9, 31, 14)), utc(2026, 9, 31, 8));
});
test("a las 23:59 de CDMX (ya es otro día en UTC) no cambia", () => {
  assert.deepEqual(corteReinicio(utc(2026, 10, 1, 5, 59)), utc(2026, 9, 31, 8));
});
test("cambio de año", () => {
  assert.deepEqual(corteReinicio(utc(2027, 0, 1, 7)), utc(2026, 11, 31, 8));
});
test("el corte nunca es futuro ni tiene 24 h o más", () => {
  for (let t = utc(2026, 0, 1).getTime(); t < utc(2027, 0, 1).getTime(); t += 37 * 60000) {
    const ahora = new Date(t);
    const c = corteReinicio(ahora);
    assert.ok(c.getTime() <= t, String(ahora));
    assert.ok(t - c.getTime() < 24 * 3600 * 1000, String(ahora));
    assert.equal(c.getUTCHours(), 8);
  }
});

// Base falsa: solo lo que usa purgarIncidencias.
function baseFalsa(docs) {
  const datos = new Map(Object.entries(docs));
  return {
    datos,
    collection: () => ({
      where: (campo, op, valor) => {
        assert.equal(campo, "timestamp");
        assert.equal(op, "<");
        return {
          limit: (n) => ({
            get: async () => {
              const ids = [...datos.entries()]
                .filter(([, d]) => d.timestamp instanceof Date && d.timestamp < valor)
                .slice(0, n)
                .map(([id]) => id);
              return { empty: ids.length === 0, docs: ids.map((id) => ({ id, ref: { id } })) };
            },
          }),
        };
      },
    }),
    batch: () => {
      const ids = [];
      return {
        delete: (ref) => ids.push(ref.id),
        commit: async () => ids.forEach((id) => datos.delete(id)),
      };
    },
  };
}

test("borra solo las anteriores al corte y devuelve cuántas", async () => {
  const ahora = utc(2026, 9, 31, 9); // 3:00 a. m. CDMX → corte 08:00 UTC de hoy
  const db = baseFalsa({
    ayer_activa: { timestamp: utc(2026, 9, 31, 3) },
    ayer_resuelta: { timestamp: utc(2026, 9, 30, 20), activa: false },
    de_hoy: { timestamp: utc(2026, 9, 31, 8, 30) },
    sin_fecha: {}, // escritura aún sin confirmar: nunca se borra
  });
  assert.equal(await purgarIncidencias(db, { ahora }), 2);
  assert.deepEqual([...db.datos.keys()].sort(), ["de_hoy", "sin_fecha"]);
});

test("procesa más documentos que el tamaño del lote", async () => {
  const docs = {};
  for (let i = 0; i < 25; i++) docs["v" + i] = { timestamp: utc(2026, 9, 1) };
  const db = baseFalsa(docs);
  assert.equal(await purgarIncidencias(db, { ahora: utc(2026, 9, 31, 9), lote: 10 }), 25);
  assert.equal(db.datos.size, 0);
});

test("sin nada que borrar devuelve 0", async () => {
  assert.equal(await purgarIncidencias(baseFalsa({}), { ahora: utc(2026, 9, 31, 9) }), 0);
});
