import express from 'express';
import serverless from 'serverless-http';
import { getStore } from '@netlify/blobs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const router = express.Router();

app.use(express.json());

// Helper para obtener la instancia del almacenamiento de Netlify Blobs
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

    // Validación defensiva
    if (!step || !source) {
      return res.status(400).json({
        status: 'error',
        message: 'Los campos "step" y "source" son obligatorios.'
      });
    }

    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const eventId = `metric_${Date.now()}_${randomSuffix}`;
    const timestamp = new Date().toISOString();

    const metricRecord = {
      id: eventId,
      step: String(step).toLowerCase().trim(),
      source: String(source).toLowerCase().trim(),
      sessionId: sessionId || 'anon_guest',
      metadata: metadata || {},
      timestamp
    };

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
// Endpoint 2: Consultar y resumir métricas + RETO 1 (GET /api/metrics)
// -------------------------------------------------------------
router.get('/metrics', async (req, res) => {
  try {
    const { step: filterStep, source: filterSource } = req.query;
    const store = obtenerAlmacenMetricas();
    const { blobs } = await store.list();

    // Obtener los datos JSON de los últimos 50 eventos
    const eventos = await Promise.all(
      blobs.slice(0, 50).map(async (blob) => {
        return await store.get(blob.key, { type: 'json' });
      })
    );

    let eventosValidos = eventos.filter(Boolean);

    // RETO 1: Filtrado dinámico por Query Parameters
    if (filterStep) {
      eventosValidos = eventosValidos.filter(
        (e) => e.step === String(filterStep).toLowerCase().trim()
      );
    }
    if (filterSource) {
      eventosValidos = eventosValidos.filter(
        (e) => e.source === String(filterSource).toLowerCase().trim()
      );
    }

    // Agregación de métricas
    const summary = {
      totalEvents: eventosValidos.length,
      byStep: {},
      bySource: {}
    };

    for (const evento of eventosValidos) {
      summary.byStep[evento.step] = (summary.byStep[evento.step] || 0) + 1;
      summary.bySource[evento.source] = (summary.bySource[evento.source] || 0) + 1;
    }

    return res.status(200).json({
      status: 'success',
      data: {
        summary,
        recentEvents: eventosValidos
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
// RETO 3: Exportación de Métricas a CSV (GET /api/metrics/export)
// -------------------------------------------------------------
router.get('/metrics/export', async (req, res) => {
  try {
    const { format } = req.query;
    if (format !== 'csv') {
      return res.status(400).json({
        status: 'error',
        message: 'Formato no soportado. Usa ?format=csv'
      });
    }

    const store = obtenerAlmacenMetricas();
    const { blobs } = await store.list();

    const eventos = await Promise.all(
      blobs.map(async (blob) => await store.get(blob.key, { type: 'json' }))
    );

    const eventosValidos = eventos.filter(Boolean);

    // Construcción del archivo CSV
    const headers = ['id', 'step', 'source', 'sessionId', 'timestamp'];
    const csvRows = [headers.join(',')];

    for (const ev of eventosValidos) {
      const row = [
        ev.id,
        ev.step,
        ev.source,
        ev.sessionId,
        ev.timestamp
      ];
      csvRows.push(row.join(','));
    }

    const csvContent = csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="metricas_funnel.csv"');
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error('Error al exportar CSV:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Error al generar la exportación en CSV.'
    });
  }
});

app.use('/api', router);

export const handler = serverless(app);