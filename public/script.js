// =============================================================
// 1. LLUVIA DE FONDO (CANVAS)
// =============================================================
const canvas = document.getElementById('lluviaCanvas');
const ctx = canvas.getContext('2d');
const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function ajustarCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
ajustarCanvas();

// Menos gotas en móvil para no gastar batería
const numeroDeGotas = window.innerWidth < 768 ? 150 : 400;
const gotas = Array.from({ length: numeroDeGotas }, () => ({
  x: Math.random() * canvas.width,
  y: Math.random() * canvas.height,
  longitud: Math.random() * 20 + 10,
  velocidad: Math.random() * 10 + 5,
  grosor: Math.random() * 1.5 + 0.5
}));

function animar() {
  ctx.fillStyle = 'rgba(23, 24, 17, 0.3)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(174, 194, 224, 0.5)';
  ctx.lineCap = 'round';

  for (const gota of gotas) {
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

// US-08: respeta a quien pidió menos movimiento
if (!reducirMovimiento) animar();
window.addEventListener('resize', ajustarCanvas);

// =============================================================
// 2. MENÚ DESPLEGABLE (JUEGOS ALIADOS)
// =============================================================
const btnOtros = document.getElementById('btnOtros');
const menuOtros = document.getElementById('misOpciones');

function cerrarMenu() {
  menuOtros.classList.remove('mostrar');
  btnOtros.setAttribute('aria-expanded', 'false');
}

btnOtros.addEventListener('click', () => {
  const abierto = menuOtros.classList.toggle('mostrar');
  btnOtros.setAttribute('aria-expanded', String(abierto));
});
window.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-desplegable')) cerrarMenu();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarMenu();
});

// =============================================================
// 3. TELEMETRÍA (FUNNEL)
//    tofu_attraction · mofu_landing · mofu_time_on_page · mofu_scroll_depth
//    bofu_preregister_click · bofu_apk_download · bofu_cross_promo
//    feedback_submission
// =============================================================
const safe = (fn, fallback = null) => { try { return fn(); } catch (_) { return fallback; } };
const nuevoId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'id_' + Math.random().toString(36).substring(2, 11);

// Sesión (por pestaña) y visitante (persistente, para contar visitantes únicos)
function obtenerSessionId() {
  let id = safe(() => sessionStorage.getItem('funnel_session_id'));
  if (!id) { id = nuevoId(); safe(() => sessionStorage.setItem('funnel_session_id', id)); }
  return id;
}
const visitorExistente = safe(() => localStorage.getItem('funnel_visitor_id'));
const esVisitanteNuevo = !visitorExistente;
const visitorId = visitorExistente || nuevoId();
if (esVisitanteNuevo) safe(() => localStorage.setItem('funnel_visitor_id', visitorId));

function obtenerContextoUrl() {
  const params = new URLSearchParams(window.location.search);
  const utms = {};
  ['utm_source', 'utm_medium', 'utm_campaign'].forEach((k) => {
    if (params.get(k)) utms[k] = params.get(k);
  });
  return { source: params.get('src') || params.get('utm_source') || 'directo', utms };
}

// opciones.beacon = true → sendBeacon (sobrevive al cierre de la pestaña)
function registrarMetrica(step, extraMetadata = {}, customSource = null, opciones = {}) {
  try {
    const { source, utms } = obtenerContextoUrl();
    const body = JSON.stringify({
      step,
      source: customSource || source,
      sessionId: obtenerSessionId(),
      metadata: {
        visitorId,
        device: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
        ...utms,
        ...extraMetadata
      }
    });

    if (opciones.beacon && navigator.sendBeacon &&
        navigator.sendBeacon('/api/metrics', new Blob([body], { type: 'application/json' }))) {
      return;
    }
    fetch('/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch((err) => console.warn('Telemetría no enviada:', err));
  } catch (err) {
    console.warn('Telemetría no enviada:', err);
  }
}

// 3.1 Visita: una sola vez por sesión (recargar ya no infla el conteo)
window.addEventListener('DOMContentLoaded', () => {
  if (safe(() => sessionStorage.getItem('funnel_landing_sent'))) return;
  safe(() => sessionStorage.setItem('funnel_landing_sent', '1'));

  const params = new URLSearchParams(window.location.search);
  if (params.get('src') || params.get('utm_source')) registrarMetrica('tofu_attraction');
  registrarMetrica('mofu_landing', { newVisitor: esVisitanteNuevo, referrer: document.referrer || null });
});

// 3.2 Clicks: cualquier elemento con data-step (pre-registro, APK, cross-promo)
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-step]');
  if (!el) return;
  registrarMetrica(el.dataset.step, {
    location: el.dataset.location,
    target: el.dataset.target,
    label: (el.textContent || '').trim().slice(0, 40)
  });
});

// 3.3 Tiempo en página (solo cuenta con la pestaña visible; manda el total acumulado)
let msActivos = 0;
let desde = document.visibilityState === 'visible' ? Date.now() : null;
let ultimoEnviado = 0;

function enviarTiempo() {
  if (desde) { msActivos += Date.now() - desde; desde = Date.now(); }
  const segundos = Math.round(msActivos / 1000);
  if (segundos > 0 && segundos !== ultimoEnviado) {
    ultimoEnviado = segundos;
    registrarMetrica('mofu_time_on_page', { seconds: segundos }, null, { beacon: true });
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { enviarTiempo(); desde = null; }
  else desde = Date.now();
});
window.addEventListener('pagehide', enviarTiempo);

// 3.4 Profundidad de scroll
const hitos = new Set();
window.addEventListener('scroll', () => {
  const h = document.documentElement;
  const pct = ((h.scrollTop + window.innerHeight) / h.scrollHeight) * 100;
  [25, 50, 75, 100].forEach((m) => {
    if (pct >= m && !hitos.has(m)) { hitos.add(m); registrarMetrica('mofu_scroll_depth', { percent: m }); }
  });
}, { passive: true });

// =============================================================
// 4. FORMULARIO DE PRE-REGISTRO
// =============================================================
const form = document.getElementById('auth-form');
const estado = document.getElementById('form-status');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const boton = form.querySelector('button[type="submit"]');
  const nombre = document.getElementById('user-name').value.trim();
  const email = document.getElementById('user-email').value.trim();
  const social = document.getElementById('user-social').value.trim();

  boton.disabled = true;
  estado.textContent = 'Enviando...';

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nombre, email, social, sessionId: obtenerSessionId() })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || 'Error al registrar');

    registrarMetrica('feedback_submission', { form: 'black_studios_register', hasSocial: Boolean(social) });
    estado.textContent = json.alreadyRegistered
      ? `${nombre}, este correo ya estaba registrado. ¡Gracias!`
      : `¡Gracias por registrarte, ${nombre}! Tu acceso anticipado a After The Storm ha sido registrado.`;
    form.reset();
  } catch (err) {
    registrarMetrica('feedback_error', { form: 'black_studios_register', error: String(err.message).slice(0, 80) });
    estado.textContent = 'No pudimos completar tu registro. Intenta de nuevo en unos minutos.';
  } finally {
    boton.disabled = false;
  }
});

// =============================================================
// 5. US-09: resaltar la sección activa en el menú
// =============================================================
const enlacesNav = [...document.querySelectorAll('header nav a')];
const observador = new IntersectionObserver((entradas) => {
  entradas.forEach((en) => {
    if (!en.isIntersecting) return;
    enlacesNav.forEach((a) => {
      if (a.getAttribute('href') === '#' + en.target.id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  });
}, { rootMargin: '-40% 0px -55% 0px' });
document.querySelectorAll('main section[id]').forEach((s) => observador.observe(s));