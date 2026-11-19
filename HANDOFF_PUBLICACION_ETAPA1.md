# Handoff — Etapa 4 · Publicación real con Meta Graph API (Etapa 1)

> **Fecha:** 9 de noviembre de 2026
> **Rama:** `connect_real_llm_vision` · **Base verificada:** commit `6db4661` · `typecheck` 0 errores · `npm test` **76/76** · `npm run build` OK
> **Objetivo de este documento:** servir de *prompt* + *paso a paso* para generar la siguiente implementación. **Aquí no se escribe código de producto.**
> **Decisión ya tomada:** se empieza por **Publicación Etapa 1 con token fijo** (sin OAuth ni App Review). OAuth/App Review queda para la fase de producción multi-cliente; el **desgaste de 30 días** va después, antes de subir volumen.

---

## 0. Estado actual (verificado)

| Paso del Happy Path | Estado |
|---|---|
| 1. Sucursal, Brand Kit, guardrails | ✅ Hecho |
| 2. Activos, prompts visuales, Inventario Cero | ✅ Hecho |
| 3. Copy con IA, cruce de activos y edición | ✅ Hecho |
| 4. Aprobar / programar (`pendiente` → `programado`) | ✅ Hecho |
| 5. **Publicar en Instagram / Facebook** | ❌ **No existe** |
| 6. Métricas reales | ⚠️ Solo `countPublishedThisMonth` (dato local) |

- Hoy **nada escribe `publicado`**: no hay OAuth, ni server function, ni worker, ni scheduler, ni una sola llamada a la Graph API.
- `settings.tsx` muestra un `toast.info` de "aún no está" al pulsar *Conectar* y borra los tokens simulados.
- Todo corre en el navegador; la app ya **genera artefactos Nitro/Cloudflare** en el build (`.output/server/wrangler.json`, `.wrangler/deploy/config.json`), o sea que las *server functions* son viables en el stack actual.

---

## 1. QUÉ SE NECESITA para hacerlo (checklist previo)

### 1.1 Dependencias externas — solo tú puedes darlas

- [ ] **Cuenta Meta for Developers** con una app creada.
- [ ] Producto **Instagram Graph API** habilitado en esa app (para Etapa 1 basta con Graph API Explorer; no hace falta App Review si publicas en **tu propia página**).
- [ ] **Página de Facebook** + **cuenta Instagram Business** vinculada a esa página (Settings → Instagram → Connected experiences).
- [ ] Usuario admin/dev con permisos sobre la página y la cuenta IG Business.
- [ ] **Token de usuario de larga duración** (60 días) obtenido con permisos:
      `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`.
      (Graph API Explorer → *Get Access Token* → *Extend Access Token*.)
- [ ] **URL pública de la app** donde viva la *server function* (las URLs de preview de Vercel sirven, pero conviene fijar dominio).
- [ ] **Decidir plataforma de despliegue** (ver §5): Vercel o Cloudflare Workers. De esto dependen las funciones server y el cron.
- [ ] Rotar `VITE_GEMINI_API_KEY` (sigue expuesta en el bundle público).

### 1.2 Secretos que deben vivir fuera del navegador

- [ ] `META_PAGE_ACCESS_TOKEN` (o el token de usuario que se intercambia por el de página) → *secret* de la plataforma (Wrangler Secrets / Vercel env).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` → solo en la server function (si RLS no permite a los clientes actualizar `publicaciones.estado` libremente).
- [ ] **Prohibido** que un token de Meta viaje en el bundle de Vite (`VITE_*`).

### 1.3 Base de datos (migraciones que ejecutas tú en Supabase SQL Editor)

Ya existen: `publicaciones (id, sucursal_id, texto_copy, fecha_publicacion, red_social, estado, activo_id)`,
`integraciones_sociales (id, sucursal_id, plataforma, token_cifrado)`, `activos`, `sucursales`, `perfiles`, bucket `galeria`.

Se necesitan **columnas nuevas** (el diseño debe confirmarlas antes de tocar código):

- [ ] `integraciones_sociales.page_id text`, `integraciones_sociales.ig_user_id text` → evitan resolver `/me/accounts` en cada publicación.
- [ ] `integraciones_sociales.token_expira_en timestamptz` → permite renovar/avisar antes del vencimiento.
- [ ] `publicaciones.estado` ya es `text`, así que acepta `publicando` y `error` sin migración; sí hacen falta:
      `publicaciones.ultimo_error text`, `publicaciones.intentos int default 0`,
      `publicaciones.publicado_en timestamptz`, `publicaciones.id_externo text` (id del media de IG o post de FB → idempotencia y métricas).
- [ ] Extensiones: `pg_cron` + `pg_net` (si el scheduler va por Supabase), o **Cron Triggers** de Cloudflare.

### 1.4 Reglas de arquitectura que son obligatorias (`AGENTS.md`)

1. Toda lógica de negocio (máquina de estados, backoff, límite de 25/24 h, manejo de errores de Graph API) va en **funciones puras en `src/lib/` con test en `src/test/`** — nunca inline en `src/routes/`.
2. UI solo con **tokens semánticos** de `src/styles.css` (los HEX solo viven en datos `brand_kit`).
3. `strict: true` + `exactOptionalPropertyTypes: true` (opciones con `| undefined`).
4. **100 % agnóstico al giro**: ningún prompt ni validación puede asumir café, clínica, etc.
5. Gates de aceptación: `npm run typecheck`, `npm test`, `npm run build` en **0 errores** (`npm run lint` falla por problemas preexistentes: no es gate).
6. **No hacer force-push ni reescribir historia ya publicada** (rama conectada a Lovable).

### 1.5 Fuera de alcance de esta implementación

- OAuth real, App Review, refresh automático de tokens, multi-tenant por cliente → **Etapa 2 de producción**.
- Desgaste de 30 días, métricas desde Insights API → pasos siguientes del Happy Path.
- Generación de imágenes con IA → **v2** (motor ya eliminado).

---

## 2. EL PROMPT (cópialo tal cual en el chat de implementación)

```text
Implementa la ETAPA 4 DEL HAPPY PATH de AutoSocial AI: PUBLICACIÓN REAL en Meta
Graph API, en la rama `connect_real_llm_vision`. Trabaja sobre la base verificada
del commit `6db4661` (typecheck 0, 76/76 tests, build OK).

OBJETIVO
Cerrar el único eslabón roto del Happy Path: hoy `publicaciones.estado` llega a
`programado` y nunca cambia. Hay que lograr: programado → publicando → publicado | error,
con publicación real en Instagram (Feed) y Facebook desde tu propia página,
SIN OAuth ni App Review (Etapa 1).

REGLAS OBLIGATORIAS
1. Lógica de negocio en funciones puras de `src/lib/` con tests en `src/test/`:
   máquina de estados, política de backoff, límite de 25 publicaciones/24 h por
   cuenta de IG, traducción de errores de Graph API a mensajes legibles.
   Nada de esta lógica en `src/routes/`.
2. El token de Meta NUNCA viaja al navegador: vive como secret y se lee solo
   dentro de la server function.
3. UI solo con tokens semánticos de `src/styles.css`. Tipos en `src/types/index.ts`.
4. TypeScript estricto (`strict` + `exactOptionalPropertyTypes`).
5. 100 % agnóstico al giro de negocio: prohibido asumir café/restaurante/etc.
6. GATES: `npm run typecheck` + `npm test` + `npm run build` en 0 errores antes
   de terminar. `npm run lint` no es gate (falla por problemas preexistentes).
7. No hagas force-push ni reescribas historia ya publicada (rama conectada a Lovable).

ALCANCE DE ESTA ENTREGA
A) Server function `publishPost(publicacionId)`:
   - Lee `publicaciones` y `integraciones_sociales` con service role.
   - Usa el page token del secret; resuelve `page_id`/`ig_user_id` (columnas nuevas
     si están, si no con `GET /me/accounts`).
   - Instagram: `POST /{ig-user-id}/media` (image_url público de `galeria` + caption)
     → espera `status_code = FINISHED` (reintentos cortos con tope) →
     `POST /{ig-user-id}/media_publish` → guarda `id_externo`.
   - Facebook: `POST /{page-id}/photos` con `url` y `message` → guarda `id_externo`.
   - Idempotencia: si `id_externo` ya existe o `estado` no es `programado`, no reenvía.
B) Reglas puras con test en `src/lib/` (nómbralas tú, p. ej. `src/lib/publish.ts`):
   máquina de estados permitida, backoff 1m/5m/15m con tope de intentos,
   pausa inmediata ante error `190`, límite de 25 publicaciones en 24 h,
   clasificación de errores de Graph API (190 token, 4/17 permisos, 613 rate limit).
C) Trigger de despacho: cada minuto toma `estado = 'programado' AND fecha_publicacion <= now()`
   con bloqueo tipo lease/claim para evitar doble envío. Adecuado a la plataforma
   decidida (Cloudflare Cron Triggers o `pg_cron` + `pg_net`). Si no se puede
   programar, deja el worker como paso identificado y documentado, sin bloquear el resto.
D) UI en `src/routes/index.tsx`: botón **"Publicar ahora"** en publicaciones
   `programado`, estados visibles (`programado`, `publicando`, `publicado`, `error`),
   mensaje del error de Meta en el detalle, botón **"Reintentar"** solo desde `error`.
E) Después de publicar: `contador_uso` del activo se incrementa de forma consistente
   con el flujo existente (revisa cómo lo hace hoy `index.tsx` antes de tocarlo).

ENTREGABLES
- Diseño corto de contratos (firmas y estados) al inicio, para aprobación.
- Código + tests nuevos en `src/test/` (tablas de casos de estado y errores de Meta).
- Checklist de QA manual con pasos exactos en el navegador.
- Migraciones SQL listas para que yo las ejecute a mano.

NO HAGAS (todavía)
- No implementes OAuth ni App Review, ni refresh de tokens.
- No implementes el desgaste de 30 días ni métricas desde la API.
- No toques el generador de prompts ni el Brand Kit.

PREGUNTA ANTES DE EMPEZAR SI HACE FALTA
- Plataforma de despliegue y dónde poner los secrets.
- Si `publicaciones` debe aceptar los campos nuevos (`ultimo_error`, `intentos`,
  `publicado_en`, `id_externo`) o prefieres otra estrategia de reintentos.
```

---

## 3. PASO A PASO (orden sugerido)

### Fase 0 — Diseño (sin código)
1. Confirmar plataforma de despliegue y dónde viven los secrets (§1.1/§1.2).
2. Confirmar el SQL de migración (§1.3): columnas nuevas en `integraciones_sociales` y `publicaciones`.
3. Redactar contratos: firmas de las funciones puras de `src/lib/`, transiciones de estado, política de backoff y qué código de error de Graph API hace qué.
4. **Aprobación del usuario antes de escribir código.**

### Fase 1 — Reglas puras + tests (`src/lib/` + `src/test/`)
5. Máquina de estados: `pendiente → programado → publicando → publicado | error` (+ `error → programado` solo con acción explícita).
6. Política de backoff (1 m → 5 m → 15 m) con tope de intentos y **pausa inmediata ante `190`**.
7. Límite de **25 publicaciones / 24 h por cuenta de Instagram** (regla de la plataforma, no de App Review).
8. Clasificador de errores de Graph API → mensaje humano (190, 4, 17, 613, 100…).
9. Tests: transiciones válidas/inválidas, agotamiento de reintentos, límite 25/24 h, `190` pausa todo.

### Fase 2 — Server function `publishPost`
10. Endpoint que reciba `publicacionId`, lea con service role y ejecute el flujo de IG/FB descrito en el §2.A.
11. Manejo de respuestas: éxito → `publicado` + `publicado_en` + `id_externo`; fallo recuperable → `error` + `ultimo_error` + `intentos`; `190` → marca integración como expirada.
12. **Nunca** exponer token, ni meter la llamada en el cliente.

### Fase 3 — Despacho programado
13. Cron cada minuto sobre `estado='programado' AND fecha_publicacion <= now()` con *claim* para evitar doble envío (UPDATE condicional con lease).
14. Si la plataforma no permite cron de minuto, documentar el bloqueo y dejarlo en Fase 4.

### Fase 4 — UI
15. Botón **Publicar ahora**, badges de estado, panel de error y **Reintentar**.
16. Estados con tokens semánticos; sin HEX crudos.

### Fase 5 — Gates y QA
17. `npm run typecheck` · `npm test` · `npm run build` → 0 errores; reportar conteo de tests.
18. QA manual (§4) y entrega del SQL al usuario.

---

## 4. QA MANUAL (aceptación)

1. Publicación `pendiente` → apruebar → queda `programado`.
2. *Publicar ahora* con token válido → `publicando` → `publicado`, con post visible en IG/FB.
3. Si Meta devuelve error → queda `error` con mensaje legible y el botón *Reintentar* aparece.
4. Token expirado (prueba con un token viejo) → **no** reintentos en bucle: integración marcada como expirada.
5. Límite 25/24 h: con 25 publicaciones en 24 h, la 26ª se bloquea con aviso claro.
6. Cron: publicación programada 2 min en el futuro se publica sola sin abrir la app (si el cron quedó en Fase 3, verificarlo o dejarlo anotado).
7. Recargar la app: los estados persisten y el contador mensual (`countPublishedThisMonth`) refleja lo publicado.
8. Gates: `typecheck` 0 · `npm test` en verde · `build` OK.

---

## 5. PUNTO DE DECISIÓN ABIERTO: ¿dónde corre esto?

| Opción | Cron | Secrets | Nota |
|---|---|---|---|
| **Cloudflare Workers** (el build ya genera `wrangler.json`) | Cron Triggers cada minuto ✅ | Wrangler Secrets | Encaja con lo que ya compila tu proyecto |
| **Vercel** | Hobby: cron **diario** ❌ (Pro sí) | Vercel env | Tus previews están en Vercel; revisar plan |
| **Supabase (Edge Function + `pg_cron`)** | `pg_cron` cada minuto ✅ | Supabase Vault / secrets de la función | Sin salir de tu backend actual |

**Antes de la Fase 0 hay que elegir una** (o combinar: lógica en Cloudflare/Vercel + `pg_cron` llamando a la function).

---

## 6. RIESGOS CONOCIDOS

- `190` token expirado/inválido → rompe publicando en silencio si no se pausa.
- `613` / rate limit y el tope duro de **25 posts de API por 24 h** en IG.
- Imagen debe ser **URL pública**: `galeria` está público, verificarlo si cambia la política del bucket.
- Doble envío si dos procesos corren el mismo `programado` → resolver con *claim*.
- Idempotencia sin `id_externo`: reintentar puede duplicar el post.
- Token de página caduca a los 60 días: avisar con anticipación (`token_expira_en`).
