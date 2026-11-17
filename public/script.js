const canvas = document.getElementById('lluviaCanvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const gotas = [];
const numeroDeGotas = 400;

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

// ==========================================
// 2. MENÚ DESPLEGABLE DE OTROS JUEGOS
// ==========================================
function mostrarOpciones() {
  document.getElementById("misOpciones").classList.toggle("mostrar");
}

window.addEventListener('click', function(event) {
  if (!event.target.matches('.boton-menu')) {
    const menus = document.getElementsByClassName("contenido-menu");
    for (let i = 0; i < menus.length; i++) {
      const menuAbierto = menus[i];
      if (menuAbierto.classList.contains('mostrar')) {
        menuAbierto.classList.remove('mostrar');
      }
    }
  }
});

// ==========================================
// 3. TELEMETRÍA DE FUNNEL Y NETLIFY BLOBS (TAREA 7)
// ==========================================

// Reto 2: Gestor de Sesión Unívoca en sessionStorage
function obtenerOSegmentarSesion() {
  let sessionId = sessionStorage.getItem('sessionId');
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 10);
    sessionStorage.setItem('sessionId', sessionId);
  }
  return sessionId;
}

// Reto 2: Extracción Automática de Parámetros UTM
function extraerMetadata() {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get('utm_source') || 'directo',
    utm_medium: params.get('utm_medium') || 'ninguno',
    utm_campaign: params.get('utm_campaign') || 'ninguno',
    device: window.innerWidth < 768 ? 'mobile' : 'desktop'
  };
}

// Envío asíncrono y no bloqueante hacia el servidor Express / Netlify Blobs
async function registrarMetrica(paso, origen, metadataExtra = {}) {
  try {
    const metadata = { ...extraerMetadata(), ...metadataExtra };
    
    await fetch('/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step: paso,
        source: origen,
        sessionId: obtenerOSegmentarSesion(),
        metadata: metadata
      }),
      keepalive: true // Garantiza que el paquete HTTP se entregue aun al salir de la página
    });
  } catch (err) {
    console.warn('Telemetría no enviada:', err);
  }
}

// Disparo de eventos según la interacción del usuario
window.addEventListener('DOMContentLoaded', () => {
  const meta = extraerMetadata();
  
  // Paso 1 (mofu_landing): Carga inicial de la Landing Page
  registrarMetrica('mofu_landing', meta.utm_source);

  // Paso 2 (bofu_interaction): Clic en el botón de Pre-registro
  const btnPreRegistro = document.querySelector('.hero-contenido .btn-cta');
  if (btnPreRegistro) {
    btnPreRegistro.addEventListener('click', () => {
      registrarMetrica('bofu_interaction', meta.utm_source, { action: 'clic_preregistro' });
    });
  }

  // Paso 3 (bofu_cross_promo): Clics hacia los juegos de compañeros (Yolcatl / RRR)
  const enlacesAliados = document.querySelectorAll('#misOpciones a');
  enlacesAliados.forEach(enlace => {
    enlace.addEventListener('click', () => {
      const nombreProyecto = enlace.textContent.trim().toLowerCase();
      registrarMetrica('bofu_cross_promo', meta.utm_source, { targetProject: nombreProyecto });
    });
  });

  // Paso 4 (feedback_submission): Envío del formulario de registro
  const formRegistro = document.getElementById('form-registro');
  if (formRegistro) {
    formRegistro.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const nombre = document.getElementById('user-name').value;
      const social = document.getElementById('user-social').value;

      registrarMetrica('feedback_submission', meta.utm_source, { 
        hasSocial: Boolean(social) 
      });

      alert(`¡Gracias por registrarte en Black Studios, ${nombre}!`);
      formRegistro.reset();
    });
  }
});