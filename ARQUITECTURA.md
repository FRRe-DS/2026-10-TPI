# Arquitectura de Software - Módulo 8 (G10-M8)

**Materia**: Desarrollo de Software - 2026  
**Módulo**: M8 - Notificaciones, Documentos y Soporte  
**Grupo**: Grupo 10  

---

## 1. Justificación Tecnológica y Arquitectónica (RNF-01, RNF-02)

Para garantizar **modulación coherente, bajo acoplamiento y alta testabilidad**, el Módulo 8 implementa una **Arquitectura Hexagonal (Puertos y Adaptadores)** dentro de un monorepo administrado con `npm workspaces`:

- **Lenguaje Transversal**: TypeScript en Backend y Frontend para coherencia y tipado de extremo a extremo.
- **Backend Framework**: NestJS, elegido por su sistema de módulos encapsulados (`@Module`), contenedor de inyección de dependencias nativo y soporte de microservicios.
- **Frontend Dashboard**: React + Vite para operaciones internas (gestión de tickets de soporte, tracking de avisos y validación de QR).
- **Contratos Formales**: Especificación OpenAPI 3.0 en `packages/contracts/openapi.yaml` y tipos compartidos en `packages/contracts`.

---

## 2. Organización en Capas Concétricas (Hexagonal)

Cada submódulo dentro de `apps/backend/src/modules/` respeta estrictamente el principio de inversión de dependencias:

```text
               ┌────────────────────────────────────────────────────────┐
               │                  INFRAESTRUCTURA                       │
               │  • Controllers REST (NestJS)   • RabbitMQ Listeners    │
               │  • Prisma Repositories (Postgres)                      │
               │  • Redis Adapter (QR TTL)      • Nodemailer (Mailpit)  │
               │                                                        │
               │        ┌──────────────────────────────────────┐        │
               │        │              APLICACIÓN              │        │
               │        │  • UseCases (Orquestación de reglas) │        │
               │        │  • DTOs con validaciones             │        │
               │        │  • Interfaces de Servicios (Puertos) │        │
               │        │                                      │        │
               │        │        ┌────────────────────┐        │        │
               │        │        │      DOMINIO       │        │        │
               │        │        │  • Entidades puras │        │        │
               │        │        │  • Value Objects   │        │        │
               │        │        │  • Puertos Salida  │        │        │
               │        │        └────────────────────┘        │        │
               │        └──────────────────────────────────────┘        │
               └────────────────────────────────────────────────────────┘
```

1. **Dominio (`domain/`)**: Contiene la lógica del negocio pura sin dependencias de NestJS, base de datos ni librerías de terceros.
2. **Aplicación (`application/`)**: Orquesta los flujos de negocio mediante Casos de Uso que invocan interfaces (puertos) sin conocer la tecnología concreta.
3. **Infraestructura (`infrastructure/`)**: Implementa los puertos mediante adaptadores tecnológicos (Prisma, Redis, RabbitMQ, PDFKit).

---

## 3. Persistencia y Flexibilidad en la Nube (RNF-04, RNF-05, Supabase)

- **Propiedad de los Datos (RNF-05)**: M8 posee sus propias tablas en PostgreSQL y no realiza lecturas directas sobre bases de datos de otros módulos.
- **Persistencia Agnóstica**: Se utiliza **Prisma ORM**. Esto permite operar de forma indistinta sobre:
  - Un contenedor **PostgreSQL local** en Docker para desarrollo offline.
  - Una instancia gestionada de **Supabase Cloud** para despliegue productivo y compartición entre integrantes sin necesidad de levantar Docker.
- **Estado Efímero y TTL (RF-8.3, RNF-11)**: Los códigos QR temporales se registran en **Redis** con un tiempo de vida estricto (TTL de 300 segundos). Al ser verificados por primera vez por el conductor, el token se consume y elimina de forma atómica para impedir reutilizaciones.
- **Consumo Asíncrono Desacoplado (RF-8.8, RNF-10)**: M8 consume eventos de RabbitMQ emitidos por M5, M6, M7 y M9 sin bloquear el flujo transaccional principal.
