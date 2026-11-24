import express from 'express';
import serverless from 'serverless-http';
import { getStore, connectLambda } from '@netlify/blobs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const router = express.Router();

app.use(express.json({ limit: '10kb' }));

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------
function obtenerAlmacen(name) {
  const config = { name, consistency: 'strong' };
  // Solo si defines credenciales manuales (útil fuera de Netlify)
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_AUTH_TOKEN) {
    config.siteID = process.env.NETLIFY_SITE_ID;
    config.token = process.env.NETLIFY_AUTH_TOKEN;
  }
  return getStore(config);
}
const obtenerAlmacenMetricas = () => obtenerAlmacen('funnel-metrics');
const obtenerAlmacenRegistros = () => obtenerAlmacen('preregistrations');

async function leerTodosLosEventos(store) {
  const { blobs } = await store.list();
  const eventos = (
    await Promise.all(blobs.map((blob) => store.get(blob.key, { type: 'json' })))
  ).filter(Boolean);
  eventos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return eventos;
}

// Opcional: si defines METRICS_READ_KEY en Netlify, las lecturas piden ?key=... o header x-api-key.
// Así nadie ajeno puede ver ni descargar las métricas. Si no la defines, todo sigue abierto como antes.
function protegerLectura(req, res, next) {
  const clave = process.env.METRICS_READ_KEY;
  if (!clave) return next();
  const recibida = req.query.key || req.get('x-api-key');
  if (recibida === clave) return next();
  return res.status(401).json({ status: 'error', message: 'No autorizado.' });
}

// Resumen analítico: conteos crudos + únicos + tiempo promedio
function construirResumen(eventos) {
  const resumen = {
    totalEvents: eventos.length,
    byStep: {},
    bySource: {},
    uniqueSessionsByStep: {},
    uniqueVisitors: 0,
    avgTimeOnPageSeconds: 0
  };
  const sesionesPorStep = {};
  const visitantes = new Set();
  const tiempoPorSesion = {}; // el mayor valor reportado por sesión

  for (const e of eventos) {
    resumen.byStep[e.step] = (resumen.byStep[e.step] || 0) + 1;
    resumen.bySource[e.source] = (resumen.bySource[e.source] || 0) + 1;
    (sesionesPorStep[e.step] ??= new Set()).add(e.sessionId);

    if (e.metadata?.visitorId) visitantes.add(e.metadata.visitorId);
    if (e.step === 'mofu_time_on_page') {
      const s = Number(e.metadata?.seconds) || 0;
      tiempoPorSesion[e.sessionId] = Math.max(tiempoPorSesion[e.sessionId] || 0, s);
    }
  }

  for (const [step, set] of Object.entries(sesionesPorStep)) {
    resumen.uniqueSessionsByStep[step] = set.size;
  }
  resumen.uniqueVisitors = visitantes.size;

  const tiempos = Object.values(tiempoPorSesion);
  if (tiempos.length) {
    resumen.avgTimeOnPageSeconds = Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length);
  }
  return resumen;
}

// Embudo: % de sesiones que llegaron a cada acción respecto a las que visitaron
function construirEmbudo(resumen) {
  const visitas = resumen.uniqueSessionsByStep['mofu_landing'] || 0;
  const pct = (step) =>
    visitas ? Number((((resumen.uniqueSessionsByStep[step] || 0) / visitas) * 100).toFixed(1)) : 0;
  return {
    sessions: visitas,
    preregisterClick: { sessions: resumen.uniqueSessionsByStep['bofu_preregister_click'] || 0, pct: pct('bofu_preregister_click') },
    apkDownload: { sessions: resumen.uniqueSessionsByStep['bofu_apk_download'] || 0, pct: pct('bofu_apk_download') },
    formSubmitted: { sessions: resumen.uniqueSessionsByStep['feedback_submission'] || 0, pct: pct('feedback_submission') }
  };
}

// -------------------------------------------------------------
// POST /api/metrics  → registrar evento
// -------------------------------------------------------------
router.post('/metrics', async (req, res) => {
  try {
    const { step, source, sessionId, metadata } = req.body;

    if (!step || !String(step).trim() || !source || !String(source).trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Los campos "step" y "source" son obligatorios y no pueden estar vacíos.'
      });
    }

    // Límites para que nadie llene el almacén con basura
    const metaObj = typeof metadata === 'object' && metadata !== null ? metadata : {};
    if (String(step).length > 60 || String(source).length > 60 || JSON.stringify(metaObj).length > 2000) {
      return res.status(400).json({ status: 'error', message: 'Payload demasiado grande.' });
    }

    const eventId = `metric_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const metricRecord = {
      id: eventId,
      step: String(step).toLowerCase().trim(),
      source: String(source).toLowerCase().trim(),
      sessionId: sessionId ? String(sessionId).trim().slice(0, 80) : 'anon_guest',
      metadata: metaObj,
      timestamp: new Date().toISOString()
    };

    await obtenerAlmacenMetricas().setJSON(eventId, metricRecord);

    return res.status(201).json({
      status: 'success',
      message: 'Métrica persistida correctamente en Netlify Blobs.',
      data: metricRecord
    });
  } catch (error) {
    console.error('Error al registrar métrica:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Fallo interno al persistir la métrica.',
      details: error.message
    });
  }
});

// -------------------------------------------------------------
// GET /api/metrics  → consultar y filtrar (?step=...&source=...)
// -------------------------------------------------------------
router.get('/metrics', protegerLectura, async (req, res) => {
  try {
    const { step, source } = req.query;
    const todos = await leerTodosLosEventos(obtenerAlmacenMetricas());

    let filtrados = todos;
    if (step) {
      const f = String(step).toLowerCase().trim();
      filtrados = filtrados.filter((e) => e.step === f);
    }
    if (source) {
      const f = String(source).toLowerCase().trim();
      filtrados = filtrados.filter((e) => e.source === f);
    }

    const summary = construirResumen(filtrados);
    // El embudo siempre se calcula con todos los eventos (con filtro no tendría sentido)
    const funnel = construirEmbudo(construirResumen(todos));

    return res.status(200).json({
      status: 'success',
      data: { summary, funnel, recentEvents: filtrados.slice(0, 50) }
    });
  } catch (error) {
    console.error('Error al consultar métricas:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Fallo interno al consultar métricas en Netlify Blobs.',
      details: error.message
    });
  }
});

// -------------------------------------------------------------
// GET /api/metrics/export?format=csv
// -------------------------------------------------------------
router.get('/metrics/export', protegerLectura, async (req, res) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    if (format !== 'csv') {
      return res.status(400).json({ status: 'error', message: 'Formato no soportado. Usa ?format=csv' });
    }

    const eventos = await leerTodosLosEventos(obtenerAlmacenMetricas());
    const headers = ['id', 'step', 'source', 'sessionId', 'timestamp'];
    const rows = eventos.map((e) =>
      headers.map((field) => `"${String(e[field] ?? '').replace(/"/g, '""')}"`).join(',')
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="metricas_funnel.csv"');
    return res.status(200).send([headers.join(','), ...rows].join('\n'));
  } catch (error) {
    console.error('Error al exportar CSV:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Fallo interno al exportar métricas a CSV.',
      details: error.message
    });
  }
});

// -------------------------------------------------------------
// POST /api/register  → guardar el pre-registro del formulario
// -------------------------------------------------------------
router.post('/register', async (req, res) => {
  try {
    const { name, email, social, sessionId } = req.body;
    const nombre = String(name || '').trim().slice(0, 60);
    const correo = String(email || '').trim().toLowerCase().slice(0, 120);

    if (!nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      return res.status(400).json({ status: 'error', message: 'Nombre y correo válidos son obligatorios.' });
    }

    const store = obtenerAlmacenRegistros();
    const existente = await store.get(correo, { type: 'json' });
    if (existente) {
      return res.status(200).json({ status: 'success', alreadyRegistered: true });
    }

    await store.setJSON(correo, {
      name: nombre,
      email: correo,
      social: String(social || '').trim().slice(0, 60),
      sessionId: sessionId ? String(sessionId).slice(0, 80) : null,
      createdAt: new Date().toISOString()
    });

    // TODO: aquí llamar a la función que ya manda el correo de confirmación
    // await enviarCorreoConfirmacion(correo, nombre);

    return res.status(201).json({ status: 'success', alreadyRegistered: false });
  } catch (error) {
    console.error('Error al registrar pre-registro:', error);
    return res.status(500).json({ status: 'error', message: 'Fallo interno al registrar.' });
  }
});

// Montar el router en ambos prefijos (por el redirect de Netlify)
app.use('/api', router);
app.use('/.netlify/functions/api', router);

const expressHandler = serverless(app);

export const handler = async (event, context) => {
  connectLambda(event);
  return expressHandler(event, context);
};