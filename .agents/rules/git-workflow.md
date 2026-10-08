# Regla de Git Workflow y Commits para el Equipo de 10 Personas

Esta regla asegura que los 10 integrantes mantengan un repositorio ordenado, sin ramas rotas y con trazabilidad limpia.

## 1. Estrategia de Ramificación (Branching)

- **`main`**: Rama de entregas oficiales a los profesores de la cátedra.
  - Protegida: Nadie hace `git push` directo a `main`.
  - Solo recibe merges desde `develop` al finalizar un hito / TP.
- **`develop`**: Rama viva de integración continua.
  - Protegida: Todos los cambios entran mediante **Pull Requests (PR)**.
- **Ramas de Trabajo (Feature Branches)**:
  - Salen siempre de `develop` y se nombran según el módulo y propósito:
    - Funcionalidades: `feat/m8-<submodulo>-<nombre-corto>` (ej. `feat/m8-tickets-crud`, `feat/m8-qr-verification`, `feat/m8-pdf-generator`)
    - Correcciones: `fix/m8-<descripcion>`
    - Tests: `test/m8-<descripcion>`
    - Documentación: `docs/m8-<descripcion>`
    - Refactor: `refactor/m8-<descripcion>`

## 2. Formato de Commits (Conventional Commits)
Cada commit debe seguir el estándar:
`<tipo>(<alcance>): <descripción imperativa en minúsculas>`

### Ejemplos Válidos:
- `feat(support): add endpoint to create support tickets linked to trips`
- `feat(documents): implement single-use qr generation with redis ttl`
- `fix(notifications): handle retry backoff when mail server is offline`
- `docs(openapi): update responses schemas for receipt re-send endpoint`
- `test(support): add unit tests for ticket state transitions`
- `refactor(backend): decouple prisma models from ticket domain entity`

## 3. Protocolo de Pull Requests (PR)
1. Antes de abrir el PR:
   - Ejecutar `npm run lint` y `npm run test` localmente.
   - Hacer `git fetch origin` y `git rebase origin/develop` si hay cambios recientes.
2. Completar la plantilla de Pull Request (`.github/pull_request_template.md`).
3. Asignar al **compañero de la célula** como Revisor (Code Reviewer).
4. El PR solo se mergea cuando:
   - El compañero de célula aprueba formalmente la revisión.
   - El pipeline de GitHub Actions (CI) está en verde.
   - Se utiliza **Squash and Merge** con título convencional limpio.
