# Propuesta de Consolidación de Contrato para el Módulo 8 (Notificaciones, Documentos y Soporte)

**De:** Grupo 10  
**Para:** Grupo 7  
**Asunto:** Acuerdo de Contrato OpenAPI 3.1 Unificado para M8  

---

Estuvimos revisando en detalle el contrato OpenAPI que armaron y comparándolo con el que veníamos trabajando nosotros.

La verdad es que nos pareció bien cómo plantearon la estructura, las rutas RESTful en español, el estándar de errores con RFC 9457 (`application/problem+json`), y la idea de tener un endpoint de eventos para no depender sí o sí de tener RabbitMQ conectado en las primeras entregas.

Como la consigna pide que los demás módulos (M1, M5, M6, M7, M9) puedan hablar indistintamente con cualquiera de nuestras dos implementaciones, **nuestro objetivo principal es llegar a un contrato 100% unificado donde ninguno de los dos equipos tenga que tirar código a la basura ni hacer un refactor pesado**.

Estuvimos trabajando en una propuesta de **fusión equilibrada** que toma como base casi todo el diseño de ustedes y solo incorpora 4 o 5 ajustes prácticos que nos simplifican la vida a los dos. 

Les dejamos acá el resumen para que lo lean tranquilos y nos digan qué les parece.

---

## 1. Lo que tomamos directamente de la propuesta de ustedes

Para mantener la coherencia con el enunciado de la cátedra y simplificar la integración general:

1. **Rutas y Recursos en Español (`/api/v1/...`):**  
   Adoptamos formalmente el español en todas las rutas canónicas del contrato (`/api/v1/notificaciones`, `/api/v1/comprobantes`, `/api/v1/tickets`, `/api/v1/viajes/{viajeId}/qr`). Desde el Grupo 10 adaptamos nuestros controladores en NestJS para que respondan ahí sin problemas.
2. **Endpoint de Eventos (`POST /api/v1/eventos`):**  
   Nos parece un golazo haberlo puesto. Nosotros veníamos consumiendo directo por RabbitMQ, pero para la demo de TP1 (donde cada grupo suele levantar sus cosas en local o en su máquina) tener este endpoint HTTP que responda `202 Accepted` resuelve un montón de fricción con M5, M6, M7 y M9.
3. **Manejo de Errores con RFC 9457 (`Problema`):**  
   Adoptamos el esquema `application/problem+json`. En NestJS ponemos un filtro global de excepciones para responder con esa misma estructura.
4. **Ciclo de Vida y Seguridad del QR (RF-8.3):**  
   Respetamos tal cual el flujo que propusieron: generación por viaje (`POST /api/v1/viajes/{viajeId}/qr`) con token opaco, y validación atómica en `POST /api/v1/qr/validaciones`.

---

## 2. Las pequeñas mejoras que proponemos sumar (para beneficiar a ambos)

Estudiando cómo interactúan el Frontend y los módulos M6 (Viajes) y M7 (Pagos), vimos que convenía sumar estas flexibilidades:

### A. Descarga polimórfica de comprobante en `GET /api/v1/comprobantes/{comprobanteId}/pdf`
* **El dilema:** Cuando un viaje termina en M6 o en el dashboard del cliente, la app conoce inmediatamente el `viajeId` (o `tripId`), pero no necesariamente tiene a mano el UUID interno del comprobante (`comprobanteId`). Si exigimos solo `comprobanteId`, el cliente se ve obligado a hacer primero un `GET /api/v1/comprobantes?viajeId=xxx` para buscar el ID y recién después pedir el PDF.
* **Nuestra propuesta:** Que el parámetro `{comprobanteId}` sea flexible: si el backend recibe un UUID de comprobante, descarga por comprobante; si recibe un ID de viaje, busca el comprobante de ese viaje y sirve el PDF directo. Así el cliente puede llamar directamente a `/api/v1/comprobantes/{viajeId}/pdf` sin vueltas.

### B. Emisión Dual de Comprobantes: Automática por Evento + Registro Síncrono Fallback
* **La situación:** En su contrato, la emisión la dispara la recepción de un evento (`VIAJE_FINALIZADO` o `PAGO_CAPTURADO`). Eso está perfecto para el flujo normal.
* **Nuestra propuesta:** Proponemos conservar además un `POST /api/v1/comprobantes` síncrono. ¿Por qué? Porque si en las pruebas de integración M7 o M6 todavía no tienen listos los eventos, o si un operador necesita registrar manualmente un comprobante desde el backoffice, este endpoint sirve como un excelente salvavidas/fallback.

### C. Soporte de `qrDataUrl` en la respuesta del QR
* **La situación:** En `POST /api/v1/viajes/{viajeId}/qr`, ustedes devuelven `imagenPng` (base64 puro).
* **Nuestra propuesta:** Sumar un campo opcional `qrDataUrl` (con el formato `data:image/png;base64,...`). De esta forma, si cualquiera de los dos grupos hace un frontend en React, Vue o HTML puro, se puede clavar directo un `<img src={data.qrDataUrl} />` sin tener que concatenar strings en el cliente.

### D. Identidad Híbrida en Tickets de Soporte (`POST /api/v1/tickets`)
* **La situación:** Su contrato define que `usuarioId` y el rol se extraen obligatoriamente del claim `sub` del JWT Bearer Token de M1.
* **Nuestra propuesta:** Mantener eso como la regla principal (si viene el token de M1, manda el token), pero permitir que el cuerpo del JSON acepte de forma opcional `usuarioId`. Esto nos salva la vida a la hora de probar tickets desde Swagger o Postman si en ese momento no tenemos a M1 corriendo para emitir tokens.

### E. Catálogo de Eventos AMQP en OpenAPI (para TP2)
* Mantuvimos en el contrato el endpoint HTTP `POST /api/v1/eventos`, pero dejamos además documentados en `components/schemas` los esquemas JSON de los eventos que irán por RabbitMQ (`TripCompletedEvent`, `PaymentCapturedEvent`, etc.), así cuando la cátedra nos pida la mensajería asíncrona en TP2, el contrato ya está listo.

---

## 3. ¿Qué cambios tendríamos que hacer cada grupo?

Para que vean que buscamos el menor esfuerzo para ambos:

### Lo que tienen que ajustar ustedes:
1. En el endpoint del PDF (`GET /api/v1/comprobantes/{comprobanteId}/pdf`), si no encuentran el registro por `comprobanteId`, chequear si coincide con un `viajeId` antes de tirar 404.
2. En la respuesta del QR (`POST /api/v1/viajes/{viajeId}/qr`), si quieren, agregar el string con el prefijo `data:image/png;base64,...` en `qrDataUrl`.
3. En el `POST /api/v1/tickets`, si no llega token Bearer, permitir tomar el `usuarioId` que venga en el JSON.

### Lo que ajustamos nosotros:
1. Mapeamos todos nuestros controladores de NestJS a las rutas en español de ustedes (`/api/v1/notificaciones`, `/api/v1/comprobantes`, `/api/v1/tickets`, `/api/v1/viajes/:viajeId/qr`).
2. Implementamos el endpoint `POST /api/v1/eventos` para recibir los hitos por HTTP además de RabbitMQ.
3. Incorporamos el filtro global para responder los errores con el formato RFC 9457 (`application/problem+json`).

---

## 4. Próximos pasos

Ya dejamos el contrato consolidado y validado en nuestro repositorio:
* Archivo consolidado: [`packages/contracts/openapi.yaml`](packages/contracts/openapi.yaml) (OpenAPI 3.1 sin errores de sintaxis ni `$ref` rotos).

Abrazo grande,  
**Equipo de Módulo 8 — Grupo 10**
