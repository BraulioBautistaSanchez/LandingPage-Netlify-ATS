import express from 'express';
import serverless from 'serverless-http';
import { getStore } from '@netlify/blobs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const router = express.Router();

app.use(express.json());

// -------------------------------------------------------------
// AQUÍ COLOCAS LA FUNCIÓN QUE SOLICITAS
// -------------------------------------------------------------
function obtenerAlmacenMetricas() {
  return getStore('funnel-metrics');
}

// -------------------------------------------------------------
// Endpoint 1: Registrar evento en el funnel (POST /api/metrics)
// -------------------------------------------------------------
router.post('/metrics', async (req, res) => {
  try {
    const { step, source, sessionId, metadata } = req.body;

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

    // Aquí es donde se utiliza la función
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

// Vincular router al prefijo /api
app.use('/api', router);

export const handler = serverless(app)