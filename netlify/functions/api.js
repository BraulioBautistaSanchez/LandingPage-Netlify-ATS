import express from 'express';
import serverless from 'serverless-http';
import { getStore } from '@netlify/blobs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const router = express.Router();

app.use(express.json());

// Helper para conectar al almacén de Netlify Blobs
function obtenerAlmacenMetricas() {
  return getStore({
    name: 'funnel-metrics',
    consistency: 'strong'
  });
}

// -------------------------------------------------------------
// Endpoint 1: Registrar evento en el funnel (POST /api/metrics)
// -------------------------------------------------------------
router.post('/metrics', async (req, res) => {
  try {
    const { step, source, sessionId, metadata } = req.body;

    // 1. Validación obligatoria
    if (!step || !String(step).trim() || !source || !String(source).trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Los campos "step" y "source" son obligatorios y no pueden estar vacíos.'
      });
    }

    // 2. Construcción del objeto de telemetría
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const eventId = `metric_${Date.now()}_${randomSuffix}`;
    const timestamp = new Date().toISOString();

    const metricRecord = {
      id: eventId,
      step: String(step).toLowerCase().trim(),
      source: String(source).toLowerCase().trim(),
      sessionId: sessionId ? String(sessionId).trim() : 'anon_guest',
      metadata: typeof metadata === 'object' && metadata !== null ? metadata : {},
      timestamp
    };

    // 3. Persistir en Netlify Blobs
    const store = obtenerAlmacenMetricas();
    await store.setJSON(eventId, metricRecord);

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
// Endpoint 2: Consultar y filtrar métricas (GET /api/metrics) [Incluye Reto 1]
// -------------------------------------------------------------
router.get('/metrics', async (req, res) => {
  try {
    const { step, source } = req.query;
    const store = obtenerAlmacenMetricas();
    const { blobs } = await store.list();

    // Obtener todos los registros válidos
    const todosLosEventos = (
      await Promise.all(
        blobs.map(async (blob) => await store.get(blob.key, { type: 'json' }))
      )
    ).filter(Boolean);

    // Ordenar del más reciente al más antiguo
    todosLosEventos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Aplicar filtros dinámicos si vienen en la URL (?step=... & ?source=...)
    let eventosFiltrados = todosLosEventos;
    if (step) {
      const stepFiltro = String(step).toLowerCase().trim();
      eventosFiltrados = eventosFiltrados.filter((e) => e.step === stepFiltro);
    }
    if (source) {
      const sourceFiltro = String(source).toLowerCase().trim();
      eventosFiltrados = eventosFiltrados.filter((e) => e.source === sourceFiltro);
    }

    // Calcular resumen analítico sobre los datos filtrados
    const summary = {
      totalEvents: eventosFiltrados.length,
      byStep: {},
      bySource: {}
    };

    for (const evento of eventosFiltrados) {
      summary.byStep[evento.step] = (summary.byStep[evento.step] || 0) + 1;
      summary.bySource[evento.source] = (summary.bySource[evento.source] || 0) + 1;
    }

    return res.status(200).json({
      status: 'success',
      data: {
        summary,
        recentEvents: eventosFiltrados.slice(0, 50)
      }
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
// Endpoint Extra (Reto 3): Exportar métricas a CSV (GET /api/metrics/export)
// -------------------------------------------------------------
router.get('/metrics/export', async (req, res) => {
  try {
    const format = (req.query.format || 'csv').toLowerCase();
    if (format !== 'csv') {
      return res.status(400).json({
        status: 'error',
        message: 'Formato no soportado. Usa ?format=csv'
      });
    }

    const store = obtenerAlmacenMetricas();
    const { blobs } = await store.list();

    const eventos = (
      await Promise.all(
        blobs.map(async (blob) => await store.get(blob.key, { type: 'json' }))
      )
    ).filter(Boolean);

    eventos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Construir CSV plano con los encabezados solicitados
    const headers = ['id', 'step', 'source', 'sessionId', 'timestamp'];
    const rows = eventos.map((e) =>
      headers
        .map((field) => `"${String(e[field] ?? '').replace(/"/g, '""')}"`)
        .join(',')
    );

    const csvContent = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="metricas_funnel.csv"');
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error('Error al exportar CSV:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Fallo interno al exportar métricas a CSV.',
      details: error.message
    });
  }
});

app.use('/api', router);

export const handler = serverless(app);