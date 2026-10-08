# Guía de Inicio y Trabajo en Equipo - Grupo 10 (Módulo 8)

Les armé esta guía para que los **9 integrantes** podamos trabajar de forma súper organizada, sin pisarnos ramas ni código, y con una arquitectura profesional y limpia para la materia.

Todo el proyecto ya está estructurado como un **Monorepo** con NestJS, Arquitectura Hexagonal, TypeScript y **Supabase Cloud** para la base de datos (así nadie tiene que renegar instalando o levantando PostgreSQL en su máquina).

---

## 📌 1. Lo que necesitas tener instalado antes de arrancar

1. **Node.js**: Versión 20 LTS o superior ([Descárgalo gratis acá](https://nodejs.org/)).
2. **Git**: Con tu usuario y mail configurados en tu terminal.
3. **Tu cuenta de GitHub**: Asegúrate de tener acceso al repositorio oficial de la cátedra: `https://github.com/FRRe-DS/2026-10-TPI`.

> 💡 **Nota sobre Docker**:  
> **NO es obligatorio tener Docker.** Como usamos **Supabase Cloud**, todos nos conectamos a la misma base de datos en la nube directamente desde Node.js. Docker solo es opcional si alguien quiere levantar servicios adicionales como Mailpit o RabbitMQ en local.

---

## 🚀 2. Paso a Paso: Cómo poner el proyecto en marcha en tu máquina

### Paso 1: Clonar el repositorio
Abre tu terminal en la carpeta donde guardas tus proyectos y clona el repo:
```bash
git clone https://github.com/FRRe-DS/2026-10-TPI.git
cd 2026-10-TPI
```

### Paso 2: Cambiarte a la rama de trabajo `develop`
**Muy importante:** todo nuestro desarrollo se integra en `develop`:
```bash
git checkout develop
git pull origin develop
```

### Paso 3: Instalar dependencias del proyecto
El proyecto usa `npm workspaces`. **Solo hace falta ejecutar `npm install` una sola vez en la raíz** y te instala las dependencias de todo el monorepo (backend, frontend y contratos):
```bash
npm install
```

### Paso 4: Crear tu archivo `.env` (Credenciales que les paso por Teams)
Por seguridad de la nube, las claves y contraseñas de la base de datos **no se suben a GitHub**. 

1. Crea tu archivo `.env` en la raíz copiando la plantilla:
   ```bash
   cp .env.example .env
   ```
2. **Abre el archivo `.env` y pega las variables que yo les voy a compartir por Microsoft Teams** (en el canal `#02-infra-supabase-github`). Ahí tendrán la cadena de conexión de Supabase y las configuraciones listas. No toquen nada más.

### Paso 5: Generar el cliente de base de datos (Prisma)
Una vez que tengas el `.env` con los datos de Supabase, ejecuta este comando para que TypeScript reconozca las tablas y modelos de la base de datos:
```bash
npx prisma generate --schema=apps/backend/prisma/schema.prisma
```
*(Opcional: Si quieres ver las tablas de Supabase en una interfaz web local, puedes correr `npm run prisma:studio` y abrir `http://localhost:5555`).*

---

## 💻 3. Cómo levantar el proyecto en tu máquina

- **Para iniciar el Backend (API NestJS):**
  ```bash
  npm run dev:backend
  ```
  - La API correrá en: `http://localhost:3000/api/v1`
  - **Swagger UI interactivo**: Entra a [http://localhost:3000/api/docs](http://localhost:3000/api/docs) para ver y probar todos los endpoints disponibles con documentación oficial.

- **Para iniciar el Frontend Dashboard (React / Vite):**
  ```bash
  npm run dev:frontend
  ```
  - Abre en tu navegador: `http://localhost:5173`

---

## ⚠️ 4. Indicaciones MUY IMPORTANTES para trabajar (Reglas del Equipo)

Para que seamos un equipo eficiente y no tengamos conflictos de Git ni errores antes de las entregas:

### 1. 🚫 Prohibido hacer push directo a `main` o a `develop`
Ambas ramas están protegidas por reglas de GitHub. Nadie puede subir código directamente a ellas. **Todo cambio entra mediante Pull Request (PR)**.

### 2. Trabajamos en Células de 2 personas (Pair Programming)
Revisen el archivo [ROLES.md](ROLES.md). Estamos divididos en parejas por subdominio:
- **Célula 1**: Notificaciones y Emails (RF-8.1, RF-8.2, RF-8.6, RF-8.8).
- **Célula 2**: Documentos, QR y PDFs (RF-8.3, RF-8.4, RF-8.5).
- **Célula 3**: Soporte y Tickets (RF-8.7).
- **Célula 4**: Frontend Backoffice (React / Vite).
- **Tech Lead (Heber)**: Infraestructura, Supabase, CI/CD, contratos y merges.

### 3. Flujo de Ramas: Siempre salimos desde `develop`
Antes de programar cualquier tarea:
```bash
git checkout develop
git pull origin develop
git checkout -b feat/m8-<tu-celula>-<descripcion-corta>
```
*Ejemplos de nombres de ramas:*
- `feat/m8-qr-generation`
- `feat/m8-tickets-persistence`
- `feat/m8-email-sender`
- `fix/m8-ticket-status-bug`

### 4. Commits claros (Conventional Commits)
Escriban commits claros en presente:
- `feat(support): add endpoint to create support tickets`
- `fix(qr): fix expiration check on single use token`
- `test(notifications): add unit tests for notification service`

### 5. Pull Requests y Revisión Mutua
1. Cuando terminen su tarea, suban la rama:
   ```bash
   git push origin feat/m8-...
   ```
2. Abran el Pull Request en GitHub apuntando hacia la rama **`develop`** (NUNCA hacia `main`).
3. Completen la plantilla del PR y **asignen a su compañero de célula como Reviewer**.
4. Su compañero de célula revisa el código en GitHub y deja su aprobación.
5. Una vez aprobado y con las pruebas de GitHub Actions en verde, se hace **Squash and Merge**.

### 6. Respetar la Arquitectura Hexagonal
El backend está separado en capas (`domain`, `application`, `infrastructure`).
- **El Dominio es sagrado**: No importen librerías de base de datos ni cosas de NestJS dentro de `domain/`.
- Ante cualquier duda de cómo estructurar un archivo, revisen [ARCHITECTURE.md](ARCHITECTURE.md).

---

##  ¿Te trabaste o tienes un error?
  Avisame si te falla algo crack