// node --test   (desde scraper/)
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  avisarIncidencias,
  avisarEstado,
  cambiosDeEstado,
  MAX_AVISOS_ESTADO,
} = require("../utils/avisos");

const callado = { log() {}, error() {} };

function mensajeria({ fallar = false } = {}) {
  const enviados = [];
  return {
    enviados,
    send: async (m) => {
      if (fallar) throw new Error("fcm caído");
      enviados.push(m);
      return "id";
    },
  };
}

function baseIncidencias(docs) {
  const datos = new Map(Object.entries(docs));
  return {
    datos,
    collection: () => ({
      get: async () => ({
        docs: [...datos.entries()].map(([id, d]) => ({
          id,
          data: () => d,
          ref: { update: async (c) => Object.assign(datos.get(id), c) },
        })),
      }),
    }),
  };
}

const inc = (extra = {}) => ({
  tipo: "Accidente",
  titulo: "Choque en carril confinado",
  descripcion: "",
  activa: true,
  sistemaId: "metrobus",
  lineaIds: ["MB_L1"],
  lineasNombres: ["Línea 1"],
  bloqueaServicio: true,
  ...extra,
});

test("una incidencia nueva se notifica una vez y queda marcada", async () => {
  const db = baseIncidencias({ a: inc() });
  const m = mensajeria();
  assert.equal(await avisarIncidencias(db, m, callado), 1);
  assert.equal(m.enviados.length, 1);
  assert.equal(m.enviados[0].topic, "incidencias");
  assert.equal(db.datos.get("a").notificadaNueva, true);

  // Otro ciclo: no se repite.
  assert.equal(await avisarIncidencias(db, m, callado), 0);
  assert.equal(m.enviados.length, 1);
});

test("al resolverse se notifica otra vez, y solo una", async () => {
  const db = baseIncidencias({ a: inc({ notificadaNueva: true, activa: false }) });
  const m = mensajeria();
  assert.equal(await avisarIncidencias(db, m, callado), 1);
  assert.equal(db.datos.get("a").notificadaResuelta, true);
  assert.equal(await avisarIncidencias(db, m, callado), 0);
});

test("creada y resuelta entre dos ciclos: no se avisa de nada", async () => {
  const db = baseIncidencias({ a: inc({ activa: false }) });
  const m = mensajeria();
  assert.equal(await avisarIncidencias(db, m, callado), 0);
  assert.equal(m.enviados.length, 0);
  assert.equal(db.datos.get("a").notificadaNueva, true);
  assert.equal(db.datos.get("a").notificadaResuelta, true);
});

test("si FCM falla no se marca, para reintentar en el siguiente ciclo", async () => {
  const db = baseIncidencias({ a: inc() });
  assert.equal(await avisarIncidencias(db, mensajeria({ fallar: true }), callado), 0);
  assert.equal(db.datos.get("a").notificadaNueva, undefined);
  assert.equal(await avisarIncidencias(db, mensajeria(), callado), 1);
});

const sistema = (lineas, condiciones) => ({ ...lineas, condiciones });

test("detecta qué sistemas cambiaron de estado efectivo", () => {
  const antes = { metro: sistema({ Linea_1: "Servicio normal", Linea_2: "Servicio normal" }) };
  const despues = { metro: sistema({ Linea_1: "Retrasos", Linea_2: "Servicio normal" }) };
  const c = cambiosDeEstado(antes, despues);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].lineas, ["Linea_1"]);
});

test("sin cambios no hay avisos; un sistema nuevo no cuenta", async () => {
  const igual = { metro: sistema({ Linea_1: "Servicio normal" }) };
  const m = mensajeria();
  assert.equal(await avisarEstado(m, igual, igual, callado), 0);
  const nuevo = { ...igual, rtp: sistema({ Linea_1: "Retrasos" }) };
  assert.equal(await avisarEstado(m, igual, nuevo, callado), 0);
  assert.equal(m.enviados.length, 0);
});

test("un cambio manda un aviso al tópico estado_servicio", async () => {
  const m = mensajeria();
  const antes = { metro: sistema({ Linea_1: "Servicio normal" }) };
  const despues = { metro: sistema({ Linea_1: "Retrasos" }) };
  assert.equal(await avisarEstado(m, antes, despues, callado), 1);
  assert.equal(m.enviados[0].topic, "estado_servicio");
  assert.match(m.enviados[0].notification.body, /Linea 1: Retrasos/);
});

test("muchos sistemas a la vez se agrupan en un solo aviso", async () => {
  const antes = {}, despues = {};
  for (let i = 0; i <= MAX_AVISOS_ESTADO; i++) {
    antes["s" + i] = sistema({ Linea_1: "Servicio normal" });
    despues["s" + i] = sistema({ Linea_1: "Retrasos" });
  }
  const m = mensajeria();
  assert.equal(await avisarEstado(m, antes, despues, callado), 1);
  assert.match(m.enviados[0].notification.body, /sistemas actualizaron/);
});
