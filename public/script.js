// =============================================================
// 1. ANIMACIÓN DE LLUVIA DE FONDO (CANVAS)
// =============================================================
const canvas = document.getElementById('lluviaCanvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const gotas = [];
const numeroDeGotas = 400; // Intensidad de la lluvia

for (let i = 0; i < numeroDeGotas; i++) {
  gotas.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    longitud: Math.random() * 20 + 10,
    velocidad: Math.random() * 10 + 5,
    grosor: Math.random() * 1.5 + 0.5
  });
}

function animar() {
  ctx.fillStyle = 'rgba(23, 24, 17, 0.3)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(174, 194, 224, 0.5)';
  ctx.lineCap = 'round';

  for (let i = 0; i < gotas.length; i++) {
    const gota = gotas[i];

    ctx.lineWidth = gota.grosor;
    ctx.beginPath();
    ctx.moveTo(gota.x, gota.y);
    ctx.lineTo(gota.x, gota.y + gota.longitud);
    ctx.stroke();

    gota.y += gota.velocidad;

    if (gota.y > canvas.height) {
      gota.y = -gota.longitud;
      gota.x = Math.random() * canvas.width;
      gota.velocidad = Math.random() * 10 + 5;
    }
  }

  requestAnimationFrame(animar);
}

animar();

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

// =============================================================
// 2. MENÚ DESPLEGABLE (JUEGOS ALIADOS)
// =============================================================
function mostrarOpciones() {
  document.getElementById('misOpciones').classList.toggle('mostrar');
}

window.addEventListener('click', function (event) {
  if (!event.target.matches('.boton-menu')) {
    const menus = document.getElementsByClassName('contenido-menu');
    for (let i = 0; i < menus.length; i++) {
      const menuAbierto = menus[i];
      if (menuAbierto.classList.contains('mostrar')) {
        menuAbierto.classList.remove('mostrar');
      }
    }
  }
});

// =============================================================
// 3. MOTOR DE TELEMETRÍA (FUNNEL + RETO 2: UUID Y UTMs)
// =============================================================

// Genera o recupera un UUID único por sesión en sessionStorage
function obtenerSessionId() {
  let sessionId = sessionStorage.getItem('funnel_session_id');
  if (!sessionId) {
    sessionId =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'sess_' + Math.random().toString(36).substring(2, 11);
    sessionStorage.setItem('funnel_session_id', sessionId);
  }
  return sessionId;
}

// Extrae parámetros UTM y el canal de origen (?src=...) de la URL
function obtenerContextoUrl() {
  const params = new URLSearchParams(window.location.search);
  const utmSource = params.get('utm_source');
  const utmMedium = params.get('utm_medium');
  const utmCampaign = params.get('utm_campaign');
  const src = params.get('src');

  const utms = {};
  if (utmSource) utms.utm_source = utmSource;
  if (utmMedium) utms.utm_medium = utmMedium;
  if (utmCampaign) utms.utm_campaign = utmCampaign;

  return {
    source: src || utmSource || 'directo',
    utms
  };
}

// Envía la métrica de forma asíncrona y no bloqueante hacia Netlify Blobs
async function registrarMetrica(step, extraMetadata = {}, customSource = null) {
  try {
    const { source, utms } = obtenerContextoUrl();
    const payload = {
      step,
      source: customSource || source,
      sessionId: obtenerSessionId(),
      metadata: {
        device: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
        ...utms,
        ...extraMetadata
      }
    };

    await fetch('/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    });
  } catch (err) {
    console.warn('Telemetría no enviada:', err);
  }
}

// =============================================================
// 4. FORMULARIO DE PRE-REGISTRO (BLACK STUDIOS) Y CARGA INICIAL
// =============================================================
function handleRegister(event) {
  event.preventDefault();

  const nombre = document.getElementById('user-name')?.value.trim() || 'Agente';
  const hasSocial = Boolean(document.getElementById('user-social')?.value.trim());

  registrarMetrica('feedback_submission', {
    form: 'black_studios_register',
    hasSocial
  });

  alert(`¡Gracias por registrarte, ${nombre}! Tu acceso anticipado a After The Storm ha sido registrado.`);
  event.target.reset();
}

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('src') || params.get('utm_source')) {
    registrarMetrica('tofu_attraction');
  }
  registrarMetrica('mofu_landing');
});