const http = require('http');

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
      <body style="font-family: sans-serif; max-width: 500px; margin: 40px auto;">
        <h2>Módulo 6 - Simulador de Viajes (API 2)</h2>
        <p>Conectado por red interna Docker a: <code>${URL_BACKEND_M8}</code></p>
        <button onclick="finalizar()" style="padding: 10px 16px; cursor: pointer;">
          Finalizar Viaje y Notificar a M8
        </button>
        <pre id="salida" style="background: #f4f4f4; padding: 12px; margin-top: 16px;"></pre>
        <script>
          async function finalizar() {
            document.getElementById('salida').textContent = 'Enviando a M8...';
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
        </script>
      </body>
    `);
  }

  // 2. Endpoint para finalizar un viaje y notificar a M8 por red interna
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

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
});

servidor.listen(PUERTO, () => {
  console.log(`[M6 API Viajes] Escuchando en puerto ${PUERTO} -> conectada a ${URL_BACKEND_M8}`);
});