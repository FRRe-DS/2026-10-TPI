# Desarrollo de Software - 2026

## Grupo 10: Módulo 8 (Notificaciones, Documentos y Soporte)

> **Plataforma Distribuida de Movilidad Urbana**  
> Repositorio del Grupo 10 (9 integrantes) para la implementación de **M8** utilizando NestJS, Arquitectura Hexagonal, TypeScript y PostgreSQL.

### Documentación del Proyecto
- [Guía de Puesta en Marcha y Flujo de Git](CONTRIBUIDORES.md): Cómo clonar, configurar variables de entorno y trabajar con ramas.
- [Arquitectura de Software (Hexagonal)](ARQUITECTURA.md): Justificación técnica, desacoplamiento y modelo en capas.
- [Organización de Roles y Células](ROLES.md): Distribución de responsabilidades para los 9 integrantes (1 Tech Lead + 4 células de 2 personas).
- [Guía de Gestión en Teams y Trello](GUIA_COLABORADORES.md): Canales de comunicación y tablero Kanban del equipo.
- [Especificación OpenAPI 3.0](packages/contracts/openapi.yaml): Contrato formal de interfaces de M8.

---

## Consideraciones Generales

En este repositorio se deberán definir todas las interfaces entre los diferentes módulos que contiene el enunciado. Para ello se deberá utilizar [OpenAPI Specification](https://swagger.io/specification/).

## Actividad 1:	Escenario por desarrollar

El producto de referencia será una **plataforma distribuida de movilidad urbana bajo demanda**. La plataforma permitirá gestionar clientes, conductores y vehículos, ubicación y disponibilidad, solicitudes de viaje, despacho, ciclo de vida del viaje, tarifas y pagos, comunicaciones y documentación, además de reservas de viajes para una fecha y hora futura.

La plataforma conectará clientes que necesitan trasladarse con conductores habilitados que ofrecen servicios en auto o moto. Deberá admitir solicitudes inmediatas y reservas para una fecha futura, acompañar el ciclo completo del viaje y coordinar identidad, datos de perfiles, ubicación, despacho, pagos y comunicaciones mediante servicios independientes

### Actores 

- **Cliente**: persona que administra su perfil, solicita o reserva viajes, selecciona el tipo de vehículo, paga, cancela y califica.
- **Conductor**: persona habilitada que administra vehículos, publica disponibilidad y ubicación, responde ofertas, ejecuta viajes y califica.
- **Operador o administrador**: rol que gestiona habilitaciones, bloqueos, parámetros, incidentes y consultas operativas.
- **Servicios externos**: proveedores de identidad, mapas, pagos, mensajería y almacenamiento, reales o simulados según la etapa.
- **Equipo integrador**: conjunto de grupos que opera una instancia completa y acuerda versiones, configuración y datos de demostración.

### Dominio de la solucion

- Un viaje tendrá un ciclo de vida controlado y un historial de transiciones no destructivo.
- Una solicitud sólo podrá quedar asignada a un conductor, incluso ante respuestas concurrentes.
- Una reserva activada originará como máximo una solicitud de despacho, aunque el evento se procese más de una vez.
- Un pago o reintegro deberá ser idempotente y auditable.
- Cada módulo será propietario de sus datos y colaborará mediante APIs o eventos.
- La ausencia o demora de un servicio externo deberá producir un comportamiento explícito, nunca un bloqueo indefinido.

### Modulos

| **ID** | **Módulo**                               | **Responsabilidad**                                                                                                     | **Integraciones clave**       |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **M1** | **Identidad y Acceso**                   | Credenciales, autenticación, roles, permisos y revocación.                                                              | Todos los módulos protegidos. |
| **M2** | **Clientes**                             | Perfil, preferencias, direcciones, historial resumido y calificaciones.                                                 | M1, M6, M9.                   |
| **M3** | **Conductores y Vehículos**              | Perfil, habilitación, vehículos, documentación y estado operativo.                                                      | M1, M4, M5, M6.               |
| **M4** | **Ubicación y Disponibilidad**           | Posición vigente, disponibilidad, proximidad, distancia y ETA (Estimated Time of Arrival / Tiempo Estimado de Llegada). | M3, M5, mapas.                |
| **M5** | **Solicitud y Despacho**                 | Solicitudes inmediatas o activadas por reserva, candidatos, ofertas y asignación única.                                 | M2, M3, M4, M6, M9.           |
| **M6** | **Viajes y Ciclo de Vida**               | Estados, arribo, inicio, finalización, cancelación y auditoría.                                                         | M5, M7, M8.                   |
| **M7** | **Tarifas, Pagos y Liquidaciones**       | Estimación, cobro, cancelación, reintegro y liquidación.                                                                | M4, M6, M9, pasarela.         |
| **M8** | **Notificaciones, Documentos y Soporte** | Avisos, QR, comprobantes, seguimiento de envíos y tickets.                                                              | Eventos de M5, M6, M7 y M9.   |
| **M9** | **Reservas de Viajes**                   | Programación futura, modificación, confirmación, recordatorio y activación.                                             | M2, M4, M5, M7, M8.           |

### Requerimientos funcionales 

Los siguientes requerimientos constituyen la línea base común. La cátedra definirá cuáles integran cada entrega y podrá ajustar su profundidad. Las reglas adicionales acordadas por un grupo deberán conservar la numeración o incorporar un identificador nuevo para mantener la trazabilidad.

#### M1: Identidad y Acceso

| **ID** | **Requerimiento**          | **Descripción funcional**                                                                                                                     |
| ------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-1.1 | Registro de identidad      | El sistema deberá permitir registrar clientes y conductores con los datos mínimos definidos por la cátedra, validando unicidad y formato.     |
| RF-1.2 | Autenticación              | El sistema deberá permitir iniciar sesión y obtener una credencial de acceso para consumir operaciones protegidas.                            |
| RF-1.3 | Roles y permisos           | El sistema deberá diferenciar, como mínimo, los roles Cliente, Conductor y Operador o Administrador, y autorizar cada operación según el rol. |
| RF-1.4 | Validación de credenciales | El servicio deberá permitir a los demás módulos validar la identidad y los permisos sin compartir contraseñas ni datos internos.              |
| RF-1.5 | Recuperación y revocación  | El sistema deberá permitir recuperar el acceso y revocar credenciales o sesiones cuando corresponda.                                          |
| RF-1.6 | Identidad federada         | La evolución del módulo deberá admitir OAuth 2.0, OpenID Connect o un mecanismo equivalente aprobado por la cátedra.                          |


#### M2:  Clientes

| **ID** | **Requerimiento**          | **Descripción funcional**                                                                                                                            |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-2.1 | Perfil de cliente          | El sistema deberá permitir crear, consultar y actualizar los datos del perfil del cliente.                                                           |
| RF-2.2 | Direcciones frecuentes     | El sistema deberá permitir registrar orígenes y destinos favoritos o recientes sin depender de datos internos del módulo de ubicación.               |
| RF-2.3 | Preferencias               | El sistema deberá permitir guardar preferencias de tipo de vehículo, comunicación y accesibilidad definidas para el escenario.                       |
| RF-2.4 | Historial de viajes        | El cliente deberá poder consultar un historial resumido obtenido mediante APIs del módulo de viajes y no mediante acceso directo a su base de datos. |
| RF-2.5 | Calificación del conductor | El cliente deberá poder registrar una valoración posterior a un viaje completado, evitando duplicados para el mismo viaje.                           |
| RF-2.6 | Estado de cuenta           | El cliente y el operador autorizado deberán poder consultar el estado del perfil y los bloqueos administrativos vigentes.                            |


#### M3: Conductores y Vehículos

| **ID** | **Requerimiento**        | **Descripción funcional**                                                                                                        |
| ------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| RF-3.1 | Perfil de conductor      | El sistema deberá permitir crear y consultar los datos del conductor y su estado de habilitación.                                |
| RF-3.2 | Vehículos Auto y Moto    | El sistema deberá permitir registrar uno o más vehículos e indicar los tipos de servicio para los que se encuentran habilitados. |
| RF-3.3 | Documentación            | El sistema deberá registrar metadatos de licencia, seguro y documentación del vehículo, incluyendo vencimientos.                 |
| RF-3.4 | Habilitación             | Un operador autorizado deberá poder aprobar, observar, suspender o rechazar una habilitación con motivo trazable.                |
| RF-3.5 | Estado operativo         | El sistema deberá impedir que un conductor o vehículo no habilitado participe del despacho.                                      |
| RF-3.6 | Disponibilidad           | El conductor deberá poder declararse conectado o desconectado y disponible o no disponible, coordinando ese estado con M4.       |
| RF-3.7 | Calificación del cliente | El conductor deberá poder valorar al cliente después de un viaje completado, evitando registros duplicados.                      |


#### M4: Ubicación y Disponibilidad

| **ID** | **Requerimiento**          | **Descripción funcional**                                                                                                            |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| RF-4.1 | Actualización de ubicación | El sistema deberá recibir coordenadas del conductor con marca temporal mientras se encuentre conectado.                              |
| RF-4.2 | Conductores cercanos       | El sistema deberá consultar conductores disponibles próximos a un origen y compatibles con el tipo de vehículo solicitado.           |
| RF-4.3 | Vencimiento de ubicación   | El sistema deberá excluir ubicaciones antiguas mediante un tiempo de vida configurable para evitar conductores fantasma.             |
| RF-4.4 | Cambio de disponibilidad   | El sistema deberá reflejar cambios de disponibilidad y reservar temporalmente a un conductor cuando participe de una oferta o viaje. |
| RF-4.5 | Geocodificación            | El sistema deberá resolver direcciones y coordenadas mediante un proveedor externo o un servicio simulado.                           |
| RF-4.6 | ETA y distancia            | El sistema deberá obtener o estimar distancia y tiempo para apoyar el despacho, la reserva y el cálculo de tarifa.                   |
| RF-4.7 | Privacidad de ubicación    | El sistema deberá limitar la conservación y exposición de coordenadas al propósito y período definidos para el escenario.            |


#### M5: Solicitud y Despacho

| **ID** | **Requerimiento**         | **Descripción funcional**                                                                                             |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| RF-5.1 | Solicitud de viaje        | El cliente deberá poder solicitar un viaje inmediato indicando origen, destino y tipo de vehículo.                    |
| RF-5.2 | Solicitud desde reserva   | El módulo deberá aceptar la activación de una reserva vigente y crear como máximo una solicitud de despacho asociada. |
| RF-5.3 | Búsqueda de candidatos    | El sistema deberá seleccionar conductores disponibles según proximidad, habilitación y tipo de vehículo.              |
| RF-5.4 | Oferta con vencimiento    | El sistema deberá enviar una oferta a uno o más conductores con un tiempo máximo de respuesta.                        |
| RF-5.5 | Aceptar o rechazar        | El conductor deberá poder aceptar o rechazar una oferta mientras se encuentre vigente.                                |
| RF-5.6 | Asignación única          | Ante respuestas concurrentes, el sistema deberá garantizar que sólo un conductor quede asignado a la solicitud.       |
| RF-5.7 | Cancelación previa        | El cliente deberá poder cancelar antes de la asignación o conforme a las reglas acordadas.                            |
| RF-5.8 | Sin disponibilidad        | El sistema deberá informar cuando no existan candidatos adecuados o finalice el período de búsqueda.                  |
| RF-5.9 | Trazabilidad del despacho | El sistema deberá registrar eventos de búsqueda, oferta, rechazo, vencimiento, aceptación y cancelación.              |

#### M6: Viajes y Ciclo de Vida

| **ID** | **Requerimiento**         | **Descripción funcional**                                                                                                |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| RF-6.1 | Estados del viaje         | El sistema deberá administrar estados válidos y transiciones controladas del viaje.                                      |
| RF-6.2 | Consulta de estado        | Clientes, conductores y operadores autorizados deberán poder consultar el estado actual y un resumen del viaje.          |
| RF-6.3 | Arribo del conductor      | El conductor asignado deberá poder indicar que llegó al punto de retiro.                                                 |
| RF-6.4 | Inicio validado           | El viaje sólo deberá iniciarse cuando se cumpla la condición de verificación acordada, por ejemplo un QR de un solo uso. |
| RF-6.5 | Finalización              | El conductor deberá poder finalizar el viaje registrando los datos necesarios de tiempo, distancia y cierre.             |
| RF-6.6 | Cancelación por cliente   | El cliente deberá poder cancelar con un motivo, respetando el estado y el eventual cargo definido.                       |
| RF-6.7 | Cancelación por conductor | El conductor deberá poder cancelar con un motivo y devolver la solicitud al despacho cuando corresponda.                 |
| RF-6.8 | Historial de transiciones | El sistema deberá mantener un historial no destructivo de estados, actores, fechas y motivos.                            |


#### M7: Tarifas, Pagos y Liquidaciones

| **ID** | **Requerimiento**        | **Descripción funcional**                                                                                           |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| RF-7.1 | Estimación de tarifa     | El sistema deberá calcular una estimación basada en tipo de vehículo, distancia, tiempo y parámetros configurables. |
| RF-7.2 | Método de pago           | El cliente deberá poder registrar o seleccionar un medio de pago permitido por el escenario.                        |
| RF-7.3 | Autorización y captura   | El sistema deberá simular o integrar la autorización y captura del pago conforme al estado del viaje.               |
| RF-7.4 | Cargo de cancelación     | El sistema deberá calcular y registrar un cargo de cancelación cuando las reglas lo indiquen.                       |
| RF-7.5 | Reintegro                | El sistema deberá registrar un reintegro total o parcial ante una cancelación o ajuste válido posterior al cobro.   |
| RF-7.6 | Idempotencia de pago     | La repetición de una misma orden de cobro o reintegro no deberá generar operaciones financieras duplicadas.         |
| RF-7.7 | Historial financiero     | El sistema deberá conservar la trazabilidad de autorizaciones, capturas, rechazos, cargos y reintegros.             |
| RF-7.8 | Liquidación al conductor | El sistema deberá calcular o simular el importe a liquidar al conductor y registrar su estado.                      |

#### M8:  Notificaciones, Documentos y Soporte

| **ID** | **Requerimiento**         | **Descripción funcional**                                                                                                         |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| RF-8.1 | Notificaciones de viaje   | El sistema deberá notificar los hitos de solicitud, asignación, arribo, inicio, cancelación y finalización por uno o más canales. |
| RF-8.2 | Notificaciones de reserva | El sistema deberá notificar creación, modificación, confirmación, recordatorio, activación y cancelación de reservas.             |
| RF-8.3 | QR de verificación        | El sistema deberá generar un QR temporal y de un solo uso asociado al viaje, sin exponer datos sensibles.                         |
| RF-8.4 | Comprobante PDF           | El sistema deberá generar un comprobante posterior a la finalización o pago con identificadores, fechas e importe.                |
| RF-8.5 | Reenvío de comprobante    | El usuario autorizado deberá poder volver a solicitar el enlace o envío del comprobante.                                          |
| RF-8.6 | Seguimiento de entrega    | El sistema deberá registrar el estado de los intentos de notificación y permitir reintentos controlados.                          |
| RF-8.7 | Soporte asociado          | El sistema deberá crear y consultar tickets asociados a un viaje, reserva o pago y registrar su estado.                           |
| RF-8.8 | Consumo asíncrono         | El módulo deberá procesar eventos desde una cola para que comunicaciones y documentos no bloqueen el flujo principal.             |

#### M9: Reservas de Viajes

| **ID**  | **Requerimiento**               | **Descripción funcional**                                                                                                                |
| ------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| RF-9.1  | Crear reserva                   | El cliente deberá poder reservar un viaje indicando origen, destino, tipo de vehículo, fecha, hora y zona horaria.                       |
| RF-9.2  | Ventana de anticipación         | El sistema deberá validar la anticipación mínima y máxima permitida para crear o modificar una reserva.                                  |
| RF-9.3  | Validación de datos             | El sistema deberá validar cliente habilitado, direcciones, cobertura, tipo de vehículo y condiciones definidas para la fecha solicitada. |
| RF-9.4  | Estimación y condiciones        | El sistema deberá solicitar una estimación de tarifa y presentar condiciones de confirmación, modificación y cancelación.                |
| RF-9.5  | Confirmación                    | El sistema deberá registrar la reserva en estado pendiente o confirmada según las reglas y dependencias acordadas.                       |
| RF-9.6  | Modificar o reprogramar         | El cliente deberá poder modificar datos permitidos o reprogramar mientras la reserva no haya sido activada ni supere el límite temporal. |
| RF-9.7  | Cancelar reserva                | El cliente u operador autorizado deberá poder cancelar con motivo y eventual cargo según las reglas vigentes.                            |
| RF-9.8  | Recordatorios                   | El sistema deberá solicitar notificaciones previas configurables para cliente y, cuando corresponda, conductor.                          |
| RF-9.9  | Activación en despacho          | Al llegar el momento configurado, el sistema deberá solicitar a M5 la creación de una solicitud de viaje vinculada a la reserva.         |
| RF-9.10 | Activación idempotente          | Los reintentos o eventos duplicados deberán producir como máximo una solicitud de despacho para la misma reserva.                        |
| RF-9.11 | Vencimiento y no disponibilidad | El sistema deberá registrar la expiración o imposibilidad de servicio y notificar alternativas o cancelación según el alcance acordado.  |
| RF-9.12 | Historial de reserva            | El sistema deberá conservar un historial de creación, confirmación, cambios, recordatorios, activación y cancelación.                    |


### Requerimientos técnicos y no funcionales transversales

| **ID**                                                                                           | **Atributo**             | **Condición mínima**                                                                                                                       | **Etapa** |
| ------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| RNF-01                                                                                           | Libertad tecnológica     | Lenguaje y framework a elección del grupo, con aprobación y justificación técnica.                                                         | TP1       |
| RNF-02                                                                                           | Arquitectura modular     | Nueve servicios con límites y responsabilidades explícitas. Dos implementaciones independientes por módulo cuando la matrícula lo permita. | TP1       |
| RNF-03                                                                                           | Contratos                | APIs síncronas definidas con OpenAPI y errores consistentes. Eventos documentados en un catálogo común.                                    | TP1       |
| RNF-04                                                                                           | Contenedores             | Cada módulo y dependencia deberá ejecutarse mediante imágenes OCI reproducibles y versionadas.                                             | TP1       |
| RNF-05                                                                                           | Propiedad de datos       | Cada servicio controlará su persistencia. Quedará prohibido consultar directamente tablas de otro módulo.                                  | TP1-TP2   |
| RNF-06                                                                                           | Configuración y secretos | URLs, puertos, credenciales y claves se configurarán externamente y no se almacenarán en el repositorio.                                   | TP1       |
| RNF-07                                                                                           | Pruebas                  | Pruebas unitarias y de integración desde TP1, de integración distribuida en TP2 y End-to-End en TP3.                                       | TP1-TP3   |
| RNF-08                                                                                           | Concurrencia             | La solución impedirá doble asignación, doble activación, doble finalización y doble cobro ante solicitudes concurrentes.                   | TP1-TP3   |
| RNF-09                                                                                           | Idempotencia             | Operaciones críticas y consumidores de mensajes tolerarán reintentos sin duplicar efectos.                                                 | TP2       |
| RNF-10                                                                                           | Mensajería               | Se utilizará RabbitMQ o alternativa aprobada para flujos asíncronos acordados.                                                             | TP2       |
| RNF-11                                                                                           | Caché y vencimiento      | Redis o alternativa aprobada administrará estado efímero, TTL e invalidación cuando corresponda.                                           | TP2       |
| RNF-12                                                                                           | Seguridad                | Autenticación, autorización, validación, HTTPS en entornos publicados y controles básicos de vulnerabilidades web.                         | TP2-TP3   |
| RNF-13                                                                                           | Resiliencia              | Timeouts, reintentos limitados y tratamiento explícito de indisponibilidad sin bloqueos indefinidos.                                       | TP2-TP3   |
| RNF-14                                                                                           | Salud y diagnóstico      |
| Health checks, logs estructurados y correlación por identificador de solicitud, viaje o reserva. | TP2-TP3                  |
| RNF-15                                                                                           | Usabilidad               | Cliente responsivo con estados claros de espera, confirmación, rechazo, cancelación, error y recuperación.                                 | TP3       |
| RNF-16                                                                                           | Performance              | El consorcio definirá y medirá al menos una meta del recorrido crítico.                                                                    | TP3       |
| RNF-17                                                                                           | Automatización           | El repositorio ejecutará build y pruebas automáticamente. La publicación de imágenes será recomendada mediante pipeline.                   | TP2-TP3   |
| RNF-18                                                                                           | Portabilidad             | La solución completa se ejecutará localmente y podrá publicarse en cloud sin modificar el código de negocio.                               | TP3       |
| RNF-19                                                                                           | Privacidad y auditoría   | No se expondrán datos sensibles en logs, QR o URLs. Las operaciones críticas conservarán trazabilidad.                                     | TP3       |
| RNF-20                                                                                           | Documentación            | README, diagramas, contratos, decisiones y procedimientos deberán mantenerse junto con la versión correspondiente.                         | TP1-TP3   |


### Grupos y Módulos

| **Módulo** | **Grupo** |
| ---------- | --------- |
| M2         | Grupo 1   |
| M3         | Grupo 2   |
| M4         | Grupo 3   |
| M5         | Grupo 4   |
| M6         | Grupo 5   |
| M7         | Grupo 6   |
| M8         | Grupo 7   |
| M9         | Grupo 8   |
| M2         | Grupo 17  |
| M3         | Grupo 15  |
| M4         | Grupo 14  |
| M5         | Grupo 13  |
| M6         | Grupo 12  |
| M7         | Grupo 11  |
| M8         | Grupo 10  |
| M9         | Grupo 9   |