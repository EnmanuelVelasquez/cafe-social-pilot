# Contexto del proyecto — AutoSocial AI

> **Documento de traspaso para abrir un chat nuevo.**
> **Fecha:** 9 de noviembre de 2026
> **Rama:** `connect_real_llm_vision`
> **Último commit:** `e8bd177` — *feat: remove IA pack from code*
> **Árbol de trabajo:** con cambios sin commitear (limpieza del motor de imágenes, ver §4.6)
> **Verificación real ejecutada hoy:** `npm run typecheck` ✅ · `npm test` → **76/76** ✅ · `npm run build` ✅

Este documento **reemplaza** las cifras y el "próximo paso" de `HANDOFF_IMPLEMENTACION.md`
(ese archivo quedó desactualizado: decía 52/52 tests; quedó solo como histórico).

---

## 1. Qué es el producto

**AutoSocial AI** es una plataforma **multi-sucursal** y **100 % agnóstica al giro de negocio**
(cafeterías, clínicas, consultoras, tiendas, restaurantes…). Gestiona un banco de activos
visuales y genera publicaciones para **Instagram** y **Facebook** con IA.

La promesa del producto, en una frase:

> Subes fotos → la IA redacta el copy según tu marca → apruebas → se publica solo.

Ese es el **Happy Path**. Todo lo demás (generar imágenes con IA, métricas, multi-proveedor)
es acelerador, no ruta crítica.

---

## 2. Stack y despliegue

| Capa | Tecnología |
|---|---|
| Framework | TanStack Start + React + Vite |
| Build/servidor | Nitro (target **Cloudflare** por defecto, vía `@lovable.dev/vite-tanstack-config`) |
| Estilos | Tailwind + shadcn/ui, tokens semánticos en `src/styles.css` |
| Estado | Zustand (`useBranchStore`) |
| Backend de datos | Supabase (Postgres + Storage + RLS) |
| Tests | Vitest (`src/test/`) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) sobre `connect_real_llm_vision` |
| Hosting real | **Vercel** (preview: `cafe-social-pilot-git-connectreallmvision-personal0407.vercel.app`) |
| Sincronización | Proyecto conectado a **Lovable** (no reescribir historial publicado) |

**Importante sobre variables:** las `VITE_*` se **incrustan en el bundle en tiempo de build**.
Cambiarlas en Vercel exige **redesplegar**; no aplican a un deployment ya existente.

---

## 3. Reglas obligatorias (`AGENTS.md`)

1. **Lógica de negocio en funciones puras** en `src/lib/`, con test en `src/test/`. Nunca inline en rutas.
2. **Solo tokens semánticos de color** de `src/styles.css`. Cero hex crudos.
3. **No reescribir historial publicado** (`--force`, rebase o amend de commits ya subidos).
4. **Esquema de Supabase intacto**: `perfiles`, `sucursales`, `activos`, `publicaciones`,
   `integraciones_sociales` (el nombre real de la tabla en el código; `AGENTS.md` la llama `integraciones`).
5. **TypeScript estricto** con `exactOptionalPropertyTypes: true` (opcionales declarados con `| undefined`).

---

## 4. Qué está implementado y probado (100 % funcional)

### 4.1 Motor de IA — texto y visión (`src/lib/ai-engine.ts`)

- Modelo por defecto: **`gemini-3.8-flash`**, con `resolveGeminiModel()` que migra modelos retirados
  (`gemini-1.5-flash`, `gemini-2.0-flash`, `gemini-2.5-flash`).
- Endpoint base: `https://generativelanguage.googleapis.com/v1beta/models`.
- **Latencia optimizada** (de ~2 min a 2–4 s):
  - `thinkingConfig: { thinkingLevel: "LOW" }` en modelos 3.x.
  - `responseSchema` forzado a nivel de API (`AI_POST_RESPONSE_SCHEMA`, `VISION_TAGS_RESPONSE_SCHEMA`).
  - Filtrado de bloques `thought: true` al extraer el JSON.
- `generateWithRetry` con máximo `MAX_JSON_RETRIES = 2` reintentos ante JSON inválido.
- Errores HTTP tipados con `AIProviderHttpError` (400/401/403/429/5xx).
- **Sin fallback local**: si no hay proveedor configurado, lanza error explícito (no inventa textos).

### 4.2 Prompts de marca (agnósticos al giro)

- `buildBrandSystemPrompt` inyecta nombre, tono y **reglas negativas** al final (REQ-1.2).
- `buildPostGenerationUserPrompt` usa las etiquetas disponibles de la sucursal.
- `buildVisionTaggingPrompt` también es agnóstico.
- Pilares de contenido con reparto que siempre suma 100 % (`brand.ts` + tests).

### 4.3 Banco de activos (`src/routes/activos.tsx` + `src/lib/data.ts`)

- Subida a Supabase Storage, bucket **`galeria`** (público, `getPublicUrl`).
- Validación de archivo: JPG/PNG/WEBP, máximo 8 MB (`validateAssetFile`).
- **Validación de dimensiones para Meta** (`validateImageDimensions`):
  - mínimo 320×320 px;
  - Feed entre 4:5 (0.8) y 1.91:1, incluido 1:1, con 5 % de tolerancia;
  - Stories 9:16 con 5 % de tolerancia.
- `readImageDimensions` inspecciona `naturalWidth/naturalHeight` antes de subir.
- Tags iniciales instantáneos por nombre de archivo (`inferTagsFromFilename`), sin espera de red.
- **"Sugerir con IA Vision"** bajo demanda (no bloquea la subida).
- Borrado de activo elimina también el objeto de Storage (`extractStoragePath`).
- `contador_uso` alimenta el algoritmo de desgaste.

### 4.4 Contenido y publicaciones (`src/routes/index.tsx`)

- Generación de copy con IA + selección del mejor activo
  (`selectBestMatchingAsset`: mayor coincidencia de tags y menor `contador_uso`).
- Estado inicial según modo supervisado/autónomo (`resolveInitialPostStatus`).
- **Modal de edición/reprogramación**: red social, fecha/hora, activo vinculado y copy
  (máximo `MAX_POST_COPY_LENGTH = 2200`).
- Validación del payload con `validatePostEditPayload`.
- "Publicados este mes" con dato real (`countPublishedThisMonth`), no hardcodeado.
- Aprobación: `pendiente` → `programado`.

### 4.5 Sucursales (`src/routes/settings.tsx`)

- CRUD completo + eliminación con doble confirmación (`AlertDialog`).
- Verificación de borrado efectivo vía `hasAffectedRows` (detecta bloqueos RLS) y manejo de FK `23503`.
- `removeSucursal` en Zustand selecciona automáticamente la siguiente sucursal.

### 4.6 Generador Semanal de Prompts Visuales con IA (Paso 1 del MVP, entregado)

> **Decisión de producto (9-nov-2026):** la generación de **imágenes** con IA se **retiró del MVP**
> y queda para la v2. El flujo genera **prompts en inglés** listos para copiar en ImageFX,
> Midjourney o DALL·E; así se evita el coste de cuota (429, ver §7).

- **Plan del lote** (`calculateWeeklyBatchPlan`): 1–5 piezas (la UI ofrece `1`, `3`, `5`) con mezcla
  **40 % Venta / 30 % Educativo / 30 % Estilo de vida**, alternando pilares para no repetir seguidos.
- **Prompt de sistema** (`buildWeeklyVisualPromptsRequest`): nombre de la marca, tono, guía de estilo
  derivada del tono (`describeToneVisualStyle`), paleta y estilo del Brand Kit, `reserve_logo_space`
  y las reglas negativas. Cero referencias a un giro concreto.
- **Contrato de salida** (`parseAndValidateWeeklyPromptsResponse`): por pieza → prompt en **INGLÉS**
  (proporción, paleta, estilo y la frase literal de espacio para logo + cierre
  `Avoid: no deformed text, no gibberish letters, no watermarks`), idea en **español** y 3–5 tags en
  español sin `#`.
- **Referencias multimodales**: hasta 2 imágenes marcadas `brand_logo`/`brand_reference` en
  `inlineData` (`extractBrandReferenceAssets` + `fetchImageAsInlineData`); fallo silencioso por imagen.
- **Modelo**: `gemini-3.8-flash` con `retryUntilValid` (2 reintentos si el JSON no valida).
- **UI**: diálogo "Generador Semanal de Prompts Visuales (IA)" en Activos (cantidad, proporción,
  mezcla de pilares, campaña, resumen del Brand Kit) + botón en la alerta de Inventario Cero
  (`/activos?prompts=1`).
- **Eliminado del código** (9-nov-2026): `generateImageWithGemini`, `buildWeeklyImagePrompt`,
  `buildGeminiImageEndpoint`, `resolveGeminiImageModel`, `resolveGeminiImageSize`,
  `isImagenPredictModel`, `extractInlineImageFromGeminiPayload`, `buildGeneratedAssetTags`,
  `AI_GENERATED_TAG` y los helpers de Storage `sanitizeStorageSegment`, `resolveImageExtension`,
  `buildGeneratedAssetStoragePath`, `dataUrlToBlob`.

### 4.7 Calidad y automatización

- CI en cada push a la rama: `typecheck` + `test` + `build`.
- **Nota:** `npm run lint` **falla por problemas preexistentes** (prettier y `no-explicit-any` en
  `activos.tsx`). No es un gate aceptado; los gates son typecheck/test/build.

---

## 5. Cobertura de tests (76 tests · 6 archivos)

| Archivo | Cubre |
|---|---|
| `src/test/ai-engine.test.ts` | Validación JSON y reintentos; cruce de activos y desgaste; visión y auto-tagging; generación de copy sin fallback; **generador semanal de prompts** (mezcla de pilares, proporciones, tono/estilo) |
| `src/test/asset-stock-alert.test.ts` | Umbral de stock, inventario cero, validación de archivos, Storage/tags/RLS, edición de publicaciones, métricas, dimensiones Meta |
| `src/test/brand-kit.test.ts` | Brand Kit (`normalizeBrandKit`), flags `reserve_logo_space`, tags `brand_logo`/`brand_reference` |
| `src/test/brand-pillars.test.ts` | Reparto de pilares que siempre suma 100 %; guardrails de marca |
| `src/test/branch-store.test.ts` | Store de sucursales y borrado con selección automática |
| `src/test/app-routing.test.tsx` | Rutas de la app |

Los tests pasan `apiKey` y `model` explícitos, así que **no dependen de variables de entorno**.

---

## 6. Happy Path: estado real

```
Configurar sucursal → Cargar activos → Generar copy con IA → Aprobar/Programar → PUBLICAR → Métricas
```

| Paso | Estado | Evidencia |
|---|---|---|
| 1. Sucursal (nombre, tono, reglas negativas, Brand Kit) | ✅ Hecho | `settings.tsx`, `marca.tsx`, `brand.ts` |
| 2. Activos (subida, tags, validación Meta, marcado Logo/Referencia) | ✅ Hecho | `activos.tsx`, `data.ts` |
| 2b. Generador semanal de prompts visuales + Inventario Cero | ✅ Hecho | `activos.tsx`, `index.tsx` |
| 3. Copy con IA | ✅ Hecho | `index.tsx`, `ai-engine.ts` |
| 4. Aprobar / programar | ✅ Hecho | estados `pendiente` → `programado` |
| 5. **Publicar en Instagram/Facebook** | ❌ **NO EXISTE** | **Nada escribe el estado `publicado`** |
| 6. Métricas reales | ⚠️ Parcial | solo `countPublishedThisMonth` (dato local) |

### El punto exacto donde se rompe

- `settings.tsx` muestra un `toast.info` de "aún no está" al pulsar conectar y limpia tokens simulados.
- `publicaciones.estado` llega a `programado` y **se queda ahí para siempre**.
- No hay OAuth real, ni worker, ni scheduler, ni llamada a Meta Graph API.
- La tabla `integraciones_sociales` existe y tiene `token_cifrado`, pero solo se usa para
  mostrar "Conectado/Desconectado".

**Conclusión: el producto todavía no cumple su promesa principal.**

---

## 7. Bloqueos y limitaciones conocidas

> **Actualización 9-nov-2026:** el generador de imágenes se retiró del MVP (§4.6), así que
> **7.1 a 7.3 quedan como registro histórico** para cuando se reactive en la v2.

### 7.1 Cuota de imágenes (429) — histórico

- La generación de imágenes con la **API de Gemini no es gratis**: el free tier no tiene cuota
  utilizable de imagen. Un 429 con **1 sola imagen** lo confirma.
- Verificación: `aistudio.google.com/rate-limit` (si el modelo aparece en 0 o no aparece, es de pago).
- La solución de fondo es **activar facturación** (Tier 1) o cambiar de proveedor.

### 7.2 Imagen 4 está apagado — histórico

- Documentación oficial (17-sep-2026): *"Imagen models are shut down. Use Nano Banana"*.
- `imagen-4.0-fast-generate-001` devuelve **404**. La rama `:predict` de `ai-engine.ts`
  fue eliminada el 9-nov-2026 junto con todo el motor de imágenes.

### 7.3 Modelos de imagen válidos hoy — histórico

| Nombre | ID |
|---|---|
| Nano Banana 2.1 (default) | `gemini-nano-banana-2.1` |
| Nano Banana 2 | `gemini-3.1-flash-image` |
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` |
| Nano Banana Pro | `gemini-3-pro-image` |
| Nano Banana (legacy) | `gemini-2.5-flash-image` |

### 7.4 Seguridad

- `VITE_GEMINI_API_KEY` está **expuesta en el bundle público** del preview de Vercel.
- Cualquiera con la URL puede leerla y consumir la cuota → posible causa del 429.
- **Recomendado: rotar la key** y restringirla en Google Cloud a "Generative Language API".

### 7.5 Sin backend propio

- No hay server functions ni API routes todavía. Todo corre en el navegador.
- Esto bloquea: publicar con token seguro, cualquier proveedor alternativo y límites por usuario.

---

## 8. Próximos pasos recomendados (en orden)

### Paso 1 — Publicación real, Etapa 1 (sin App Review)

Objetivo: cerrar el ciclo con **tu propia página**, esta semana.

- Server function `publishPost` (proxy) que lea el token de `integraciones_sociales.token_cifrado`.
- Resolver `page_id` e `ig_user_id` con `/me/accounts` → **sin cambiar el esquema**.
- Botón **"Publicar ahora"** + worker que procese `estado = 'programado'` con `fecha_publicacion <= now()`.
- Estados: `programado → publicando → publicado | error`, con reintento y mensaje de Meta.
- Instagram: crear contenedor → consultar `status_code` hasta `FINISHED` → publicar.
- Facebook: `POST /{page-id}/photos`.
- Scheduler: **Supabase `pg_cron`** (gratis, cada minuto). El cron de Vercel en Hobby es diario → no sirve.

### Paso 2 — Publicación real, Etapa 2 (producción multi-cliente)

- OAuth real de Meta + tokens cifrados + refresh.
- App Review de `instagram_content_publish`, `pages_manage_posts`, `pages_read_engagement`.
- Regla pura de **25 publicaciones/24 h por cuenta de IG** en `src/lib/`.

### Paso 3 — Modo demo de imágenes (coste cero)

- Proveedor `mock` detrás de la misma interfaz: valida plan → preview → guardar → tags
  sin gastar cuota. Sirve para probar el pack semanal mientras se decide el proveedor real.

### Paso 4 — Resiliencia ante 429

- Backoff exponencial respetando `retryDelay` (2 s → 4 s → 8 s, máximo 3 intentos, solo 429).
- Mensaje real de Google en el toast (hoy el 429 muestra un texto fijo que dice siempre
  "límite por minuto", aunque sea cuota diaria).
- Botón "Reintentar pendientes" y pausa de ~3 s entre piezas.

### Paso 5 — Métricas reales

- Alcance/engagement desde Graph API, no solo el contador local.

---

## 9. Decisiones técnicas y trampas a tener en cuenta

1. **Instagram solo acepta JPEG.** Los activos aceptan PNG/WebP y las imágenes generadas son PNG.
   Hay que convertir antes de publicar o guardar JPEG para piezas de IG.
2. **La imagen debe ser URL pública.** El bucket `galeria` ya lo es; punto resuelto.
3. **`page_id`/`ig_user_id` no están en el esquema.** Se resuelven en runtime con `/me/accounts`;
   no hace falta migración (y `AGENTS.md` prohíbe tocarlo).
4. **`VITE_*` es build-time.** Con server functions, la key pasa a ser **runtime**: cambiarla
   no exige redesplegar.
5. **`imageSize` requiere K mayúscula** (`1K`, `2K`, `4K`, `512`). Si no se configura, no se envía.
6. **Generación secuencial** de imágenes: decisión deliberada para no reventar el RPM.
7. **Preview antes de guardar**: control de coste y de éxito parcial (si falla la pieza 3 de 5,
   se conservan las 2 anteriores).
8. **Pilares**: 40/30/30 es regla de negocio pura y testeada; no duplicar números en rutas.
9. **`integraciones_sociales`** es el nombre real de la tabla (no `integraciones`).
10. **El lint no es gate**: falla por issues preexistentes ajenos a los cambios.

---

## 10. Variables de entorno

| Variable | Obligatoria | Dónde | Nota |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Sí | `.env` + Vercel | |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Sí | `.env` + Vercel | |
| `VITE_GEMINI_API_KEY` | Sí (IA) | Vercel | **hoy ausente en `.env` local** |
| `VITE_GEMINI_MODEL` | Recomendada | Vercel | `gemini-3.8-flash` |
| `VITE_GEMINI_IMAGE_MODEL` | Recomendada | Vercel | `gemini-nano-banana-2.1` |
| `VITE_GEMINI_IMAGE_SIZE` | Opcional | Vercel | vacío = default del modelo |
| `VITE_AI_WEBHOOK_URL` | Opcional | Vercel | proveedor alternativo de texto |
| `GEMINI_API_KEY` (sin `VITE_`) | Futuro | Vercel runtime | para el proxy/server function |

**Estado actual:** el `.env` local solo tiene las dos de Supabase. El deployment de Vercel sí
tiene la key de Gemini (llega a Google y devuelve 429, no error de key).

---

## 11. Comandos

```bash
npm run dev        # desarrollo
npm run typecheck  # tsc --noEmit
npm test           # vitest run (76 tests)
npm run build      # build de producción
npm run check      # typecheck + test + build
npm run lint       # falla por issues preexistentes (no gate)
```

---

## 12. Marco legal (Colombia) — resumen operativo

> Orientación práctica, no asesoría jurídica.

- **Ley 1581 de 2012 + Decreto 1074 de 2015**: imágenes de personas y prompts que las describan
  son datos personales → autorización, aviso de privacidad, finalidad y canal de derechos.
- **Transferencia internacional (art. 26)**: prompts e imágenes viajan a servidores de Google en el
  exterior → autorización explícita o país con nivel adecuado declarado por la SIC.
- **Free tier**: el proveedor puede usar los datos para mejorar sus modelos → para datos de
  clientes, usar tier de pago.
- **Ley 1480 de 2011**: una imagen generada que no corresponda al producto real puede ser
  **publicidad engañosa**.
- **Derecho de imagen**: evitar rostros de personas reales o parecidos reconocibles.
- **Ley 23 de 1982 + Ley 1915 de 2018**: no generar logos, personajes o marcas de terceros.
- **RNBD**: obligatorio para empresas con activos > 100.000 UVT.
- **IA**: Colombia no tiene aún ley integral vigente; aplican las normas generales.

Checklist mínimo antes de producción: aviso de privacidad actualizado, autorización de tratamiento,
contrato de transmisión si hay clientes empresa, política de retención, key fuera del bundle,
tier de pago y trazabilidad por sucursal.

---

## 13. Archivos clave

| Archivo | Rol |
|---|---|
| `src/lib/ai-engine.ts` | Todo el motor: texto, visión, planes semanales, prompts visuales, errores |
| `src/lib/brand.ts` | Pilares, Brand Kit (`normalizeBrandKit`) y tags `brand_logo`/`brand_reference` |
| `src/lib/data.ts` | Validaciones, Storage, tags, fechas, métricas |
| `src/lib/store.ts` | Zustand de sucursales |
| `src/lib/supabase.ts` | Cliente Supabase |
| `src/routes/index.tsx` | Contenido: generación, edición, programación |
| `src/routes/activos.tsx` | Banco de activos + Generador Semanal de Prompts Visuales |
| `src/routes/settings.tsx` | Sucursales, Identidad Visual (Brand Kit) e integraciones |
| `src/routes/marca.tsx` | Brand Engine |
| `src/types/index.ts` | Tipos del esquema (`BrandKit`, `Sucursal.brand_kit`) |
| `src/test/*` | 76 tests |
| `vite.config.ts` | Config TanStack/Nitro |
| `.github/workflows/ci.yml` | CI de la rama |

---

## 14. Cómo retomar en un chat nuevo

1. Leer este documento completo.
2. Ejecutar `npm run check` para confirmar que la base está verde (76/76).
3. Confirmar el paso elegido en §8 (recomendado: **Paso 1 — Publicación Etapa 1**).
4. Antes de tocar código, verificar:
   - ¿Hay cuenta de Instagram Business vinculada a una página de Facebook?
   - ¿Existe una app de Meta con el producto Instagram Graph API?
   - ¿El bucket `galeria` sigue público?
5. Recordar: el generador de imágenes **no** es la ruta crítica; la publicación sí.
