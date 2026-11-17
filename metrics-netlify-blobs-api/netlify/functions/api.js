import express from 'express';
import serverless from 'serverless-http';
import { getStore } from '@netlify/blobs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const router = express.Router();

app.use(express.json());

// Helper para conectar al almacén de Blobs
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

    // 1. Validación defensiva mínima
    if (!step || !source) {
      return res.status(400).json({
        status: 'error',
        message: 'Los campos "step" y "source" son obligatorios.'
      });
    }

    // 2. Construir el objeto de telemetría
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
// Endpoint 2: Consultar y resumir métricas (GET /api/metrics)
// -------------------------------------------------------------
router.get('/metrics', async (req, res) => {
  try {
    const store = obtenerAlmacenMetricas();
    const { blobs } = await store.list();

    // Obtener el contenido de los últimos eventos (hasta un máximo de 50)
    const eventosRecientes = await Promise.all(
      blobs.slice(0, 50).map(async (blob) => {
        return await store.get(blob.key, { type: 'json' });
      })
    );

    // Filtrar posibles nulos y calcular agregaciones
    const eventosValidos = eventosRecientes.filter(Boolean);

    const summary = {
      totalEvents: blobs.length,
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

// Vincular router al prefijo /api
app.use('/api', router);

// Exportar handler para Netlify Functions
export const handler = serverless(app);