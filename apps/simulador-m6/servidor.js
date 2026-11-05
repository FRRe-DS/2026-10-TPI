const http = require('http');
const crypto = require('crypto');

const PUERTO = process.env.PUERTO || 3001;
// Apunta al servicio "backend" usando el DNS interno de la red de Docker
const URL_BACKEND_M8 = process.env.URL_BACKEND_M8 || 'http://backend:3000/api/v1';

const servidor = http.createServer(async (req, res) => {
  // 1. Endpoint de salud (Healthcheck) para Docker Compose
  if (req.method === 'GET' && req.url === '/salud') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ estado: 'ok', servicio: 'M6 - API de Viajes (Simulador)' }));
  }

  // Página web simple para disparar el evento desde el navegador con un clic
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`
      <body style="font-family: sans-serif; max-width: 600px; margin: 40px auto;">
        <h2>Módulo 6 - Simulador de Viajes (API 2)</h2>
        <p>Conectado por red interna Docker a: <code>${URL_BACKEND_M8}</code></p>
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <button onclick="enviarEventoCoordinado()" style="padding: 10px 16px; cursor: pointer; font-weight: bold;">
            Emitir Hito Canónico (POST /api/v1/eventos)
          </button>
          <button onclick="finalizar()" style="padding: 10px 16px; cursor: pointer;">
            Finalizar Viaje (POST /simulator/trip-completed)
          </button>
        </div>
        <pre id="salida" style="background: #f4f4f4; padding: 12px; margin-top: 16px; overflow-x: auto;"></pre>
        <script>
          async function finalizar() {
            document.getElementById('salida').textContent = 'Enviando a M8 (/simulator/trip-completed)...';
            const r = await fetch('/viajes/finalizar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tripId: 'viaje-web-100',
                passengerEmail: 'alumno@utn.edu.ar',
                driverName: 'Carlos Conductor',
                fare: 5200
              })
            });
            const data = await r.json();
            document.getElementById('salida').textContent = JSON.stringify(data, null, 2);
          }

          async function enviarEventoCoordinado() {
            document.getElementById('salida').textContent = 'Enviando EventoEntrada a M8 (/api/v1/eventos)...';
            const r = await fetch('/viajes/evento-coordinado', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                viajeId: '550e8400-e29b-41d4-a716-446655440100',
                email: 'alumno@utn.edu.ar',
                monto: 5200
              })
            });
            const data = await r.json();
            document.getElementById('salida').textContent = JSON.stringify(data, null, 2);
          }
        </script>
      </body>
    `);
  }

  // 2. Endpoint para finalizar un viaje (ruta simulador tradicional)
  if (req.method === 'POST' && req.url === '/viajes/finalizar') {
    let cuerpo = '';
    req.on('data', (chunk) => (cuerpo += chunk));
    req.on('end', async () => {
      try {
        const datos = cuerpo ? JSON.parse(cuerpo) : {};

        // Llamada HTTP contenedor-a-contenedor hacia M8 (backend)
        const respuesta = await fetch(`${URL_BACKEND_M8}/simulator/trip-completed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datos),
        });

        const respuestaM8 = await respuesta.json();

        res.writeHead(respuesta.status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            origen: 'M6 - API de Viajes (Contenedor 2)',
            enviadoHacia: `${URL_BACKEND_M8}/simulator/trip-completed`,
            respuestaDeM8: respuestaM8,
          }),
        );
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'No se pudo conectar con el Backend M8',
            detalle: error.message,
          }),
        );
      }
    });
    return;
  }

  // 3. Endpoint para informar un hito bajo el Contrato Coordinado Definitivo (POST /api/v1/eventos)
  if (req.method === 'POST' && req.url === '/viajes/evento-coordinado') {
    let cuerpo = '';
    req.on('data', (chunk) => (cuerpo += chunk));
    req.on('end', async () => {
      try {
        const datos = cuerpo ? JSON.parse(cuerpo) : {};
        const eventoPayload = {
          eventoId: datos.eventoId || crypto.randomUUID(),
          tipo: datos.tipo || 'VIAJE_FINALIZADO',
          origen: 'M6',
          ocurridoEn: new Date().toISOString(),
          viajeId: datos.viajeId || '550e8400-e29b-41d4-a716-446655440100',
          destinatarios: [
            {
              usuarioId: datos.usuarioId || '550e8400-e29b-41d4-a716-446655440999',
              rol: 'CLIENTE',
              email: datos.email || 'alumno@utn.edu.ar',
              canalesPreferidos: ['EMAIL'],
            },
          ],
          detalle: {
            origen: datos.origen || 'Campus UTN FRRe',
            destino: datos.destino || 'Plaza 25 de Mayo',
            tipoVehiculo: 'AUTO',
            importe: {
              monto: Number(datos.monto || 5200),
              moneda: 'ARS',
            },
          },
        };

        const requestId = `m6-req-${Date.now()}`;
        const respuesta = await fetch(`${URL_BACKEND_M8}/eventos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Request-Id': requestId,
          },
          body: JSON.stringify(eventoPayload),
        });

        const respuestaM8 = await respuesta.json();

        res.writeHead(respuesta.status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            origen: 'M6 - API de Viajes (Contenedor 2)',
            enviadoHacia: `${URL_BACKEND_M8}/eventos`,
            xRequestId: respuesta.headers.get('x-request-id') || requestId,
            eventoEnviado: eventoPayload,
            respuestaDeM8: respuestaM8,
          }),
        );
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'No se pudo conectar con el Backend M8 (/eventos)',
            detalle: error.message,
          }),
        );
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
});

servidor.listen(PUERTO, () => {
  console.log(`[M6 API Viajes] Escuchando en puerto ${PUERTO} -> conectada a ${URL_BACKEND_M8}`);
});
