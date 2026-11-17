Link de la página https://afterthestormats.netlify.app 


### 1. Persistencia vs. Estado Efímero
Las funciones serverless operan bajo la filosofía *stateless*: la infraestructura crea contenedores de forma bajo demanda que se destruyen tras tiempos de inactividad (*cold starts* y *freezes*). Cualquier variable global en memoria (ej. `let contador = 0`) se pierde por completo entre instancias. 
Netlify Blobs resuelve esto abstraendo el almacenamiento en un sistema de clave-valor distribuido fuera de la instancia de ejecución. 

**Diferencias clave con SQL:**
* **Esquema:** SQL requiere tablas rígidas y migraciones previa ingesta; Key-Value guarda documentos JSON semiestructurados al vuelo.
* **Conexiones:** Las bases SQL sufren de *connection exhaustion* si cientos de funciones serverless abren conexiones simultáneas. Blobs opera mediante APIs HTTP/REST stateless sin límites de pool de conexión.

### 2. Consistencia Fuerte vs. Consistencia Eventual
* **Consistencia Fuerte (`strong`):** Garantiza que cualquier lectura realizada tras una escritura devuelva inmediatamente el valor más reciente registrado en la red distribuida.
* **Consistencia Eventual:** Prioriza la velocidad de respuesta permitiendo que distintos nodos repliquen la información gradualmente.

**Impacto en alto tráfico:** Si utilizáramos consistencia eventual bajo tráfico masivo (como el Demo Day), el panel de control de métricas respondería desactualizado o desincronizado al consultar `GET /api/metrics`, mostrando recuentos obsoletos durante los segundos en los que se replica el blob entre nodos.

### 3. Garantía de Envío en Frontend (`keepalive` y `navigator.sendBeacon`)
Cuando un usuario hace clic en un enlace de salida (ejemplo: botón hacia el juego de un equipo aliado), el navegador destruye el contexto HTTP de la página actual antes de que las peticiones asíncronas tradicionales (`fetch` o `axios`) terminen su ciclo de solicitud/respuesta, abortándolas con un error `net::ERR_ABORTED`.

* **`keepalive: true`:** Le indica al motor HTTP del navegador que mantenga viva la petición en segundo plano aunque el marco del DOM de la página sea destruido.
* **`navigator.sendBeacon()`:** Utiliza un transporte POST HTTP asíncrono y optimizado por el navegador para enviar datos de analítica de forma no bloqueante justo antes de la descarga de la página (*unload*).

### 4. Particionamiento y Escalabilidad de Claves
Al escalar a 100,000 eventos, invocar `store.list()` seguido de un `Promise.all()` recorriendo y descargando cada objeto de manera individual provocará:
1. **Límites de Memoria/Timeout:** Agotar los recursos del ejecutor de la función serverless (limitada habitualmente a 10s y 1024MB).
2. **Latencia Elevada:** Realizar 100,000 peticiones GET individuales degrada severamente el tiempo de respuesta.

**Mitigaciones en Producción:**
* **Prefijos por Fecha / Paginación:** Organizar las claves por particiones cronológicas (`metrics/YYYY-MM-DD/metric_id`) y paginar las lecturas con `limit` y `cursor`.
* **Contadores Agregados:** En lugar de leer todos los eventos en cada consulta `GET`, mantener blobs agregados o contadores precalculados por fase (`summary_today`).

### 5. Higiene de Datos y Prevención de Spam
Un endpoint de métricas público sin protección es vulnerable a inyecciones de payload sintético, spam de base de datos o ataques de Denegación de Servicio (DoS).

**Técnicas de Mitigación:**
1. **CORS Estricto:** Configurar el encabezado `Access-Control-Allow-Origin` únicamente para el dominio oficial de la landing page.
2. **Rate Limiting:** Implementar un middleware (ej. `express-rate-limit` con token bucket) para limitar la cantidad de peticiones permitidas por IP/sessionId por minuto.
3. **Validación de Esquema Defensiva:** Emplear librerías como Zod o Joi para desinfectar e imponer reglas estrictas de estructura y longitud en el cuerpo del JSON antes de guardarlo en Blobs.
