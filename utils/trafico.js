const axios = require("axios");
const db = require("../firebase");
const admin = require("firebase-admin");

// C5 CDMX — incidentes viales (Open Data CDMX)
const C5_URL =
  "https://api.datos.cdmx.gob.mx/api/3/action/datastore_search" +
  "?resource_id=d93471b7-63dd-4f45-8c0e-21e7c345f20c" +
  "&limit=50" +
  "&sort=fecha_creacion+desc";

// Horas pico en CDMX (hora local)
function nivelPorHoraPico() {
  const hora = parseInt(
    new Date().toLocaleString("es-MX", {
      timeZone: "America/Mexico_City",
      hour: "numeric",
      hour12: false,
    })
  );

  if ((hora >= 7 && hora <= 9) || (hora >= 17 && hora <= 20)) {
    return { nivel: "Alto", descripcion: "Hora pico — tráfico intenso esperado" };
  }
  if ((hora >= 10 && hora <= 13) || (hora >= 14 && hora <= 16)) {
    return { nivel: "Moderado", descripcion: "Tráfico moderado" };
  }
  if (hora >= 22 || hora < 6) {
    return { nivel: "Bajo", descripcion: "Tráfico fluido" };
  }
  return { nivel: "Moderado", descripcion: "Condiciones normales" };
}

async function scrapearTrafico() {
  try {
    let nivel = "Moderado";
    let descripcion = "Condiciones normales";
    let incidentes = [];
    let fuente = "estimado";

    // Intentar C5 CDMX Open Data
    try {
      const resp = await axios.get(C5_URL, {
        timeout: 10000,
        headers: { Accept: "application/json" },
      });

      const records = resp.data?.result?.records ?? [];

      // Incidentes de las últimas 2 horas
      const hace2h = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const recientes = records.filter((r) => {
        const f = r.fecha_creacion || r.fecha_inicio || "";
        return f ? new Date(f) > hace2h : false;
      });

      incidentes = recientes.slice(0, 6).map((r) => ({
        tipo: r.tipo_incidente || r.clasificacion_del_incidente || "Incidente",
        alcaldia: r.alcaldia || r.delegacion || "",
        hora: r.fecha_creacion || r.fecha_inicio || "",
      }));

      const total = recientes.length;
      if (total > 20) {
        nivel = "Alto";
        descripcion = `${total} incidentes viales en las últimas 2 horas`;
      } else if (total > 8) {
        nivel = "Moderado";
        descripcion = `${total} incidentes viales en las últimas 2 horas`;
      } else if (total === 0) {
        const hp = nivelPorHoraPico();
        nivel = hp.nivel;
        descripcion = hp.descripcion;
      } else {
        nivel = "Bajo";
        descripcion = `${total} incidentes menores reportados`;
      }

      fuente = "c5_cdmx";
    } catch {
      // C5 no disponible — estimar por hora
      const hp = nivelPorHoraPico();
      nivel = hp.nivel;
      descripcion = hp.descripcion + " (estimado por hora)";
      fuente = "estimado";
    }

    await db.collection("contexto").doc("trafico").set({
      nivel,
      descripcion,
      incidentes,
      fuente,
      Ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`🚗 Tráfico: ${nivel} — ${descripcion}`);
  } catch (err) {
    console.error("❌ Tráfico:", err.message);
  }
}

module.exports = scrapearTrafico;
