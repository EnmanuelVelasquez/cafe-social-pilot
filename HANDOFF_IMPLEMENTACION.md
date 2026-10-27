# Handoff de Implementación — AutoSocial AI (`connect_real_llm_vision`)

> **Fecha de actualización:** 26 de octubre de 2026  
> **Rama activa:** `connect_real_llm_vision`  
> **Directorio de trabajo:** `C:\Users\emanu\.gemini\antigravity\worktrees\cafe-social-pilot\connect_real_llm_vision`  
> **Estado de verificación:** `52/52` tests en Vitest pasando (`npm test`) y `0` errores en TypeScript (`npm run typecheck`).

---

## 1. Contexto General y Reglas del Proyecto (`AGENTS.md`)

- **Propósito de la plataforma:** **AutoSocial AI** es una plataforma multi-sucursal y **100% agnóstica al giro de negocio** (funciona para clínicas, consultoras, restaurantes, tiendas, cafeterías, etc.) que gestiona bancos de activos visuales y genera publicaciones para redes sociales (`Instagram` y `Facebook`) con Inteligencia Artificial.
- **Reglas obligatorias (`AGENTS.md`):**
  1. **Lógica de negocio en funciones puras:** Umbrales, proporciones, validaciones y cálculos viven como funciones puras en `src/lib/` con pruebas unitarias colocadas en `src/test/` — nunca inline dentro de archivos de rutas (`src/routes/`).
  2. **Tokens semánticos de color:** Nunca usar colores hexadecimales crudos en componentes; usar únicamente tokens de `src/styles.css` y variantes de componentes.
  3. **Sincronización con Lovable / Git:** No reescribir historial publicado (`--force`, `rebase` o `amend` de commits ya subidos).
  4. **Esquema de Base de Datos intacto:** Respetar estrictamente las tablas de Supabase (`perfiles`, `sucursales`, `activos`, `publicaciones`, `integraciones`).
  5. **TypeScript estricto:** El proyecto usa `strict: true` y `exactOptionalPropertyTypes: true` (las propiedades opcionales deben declararse explícitamente con `| undefined` cuando reciben valores opcionales).

---

## 2. Resumen de Todo lo Implementado hasta Ahora

### A. Fase A — Conexión Real con Google Gemini (`REQ-2.2`, `REQ-3.1`) y Optimización de Latencia
- **Archivos principales:**
  - [`src/lib/ai-engine.ts`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/ai-engine.ts)
  - [`src/lib/brand.ts`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/brand.ts)
  - [`src/test/ai-engine.test.ts`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/test/ai-engine.test.ts)
- **Qué se hizo:**
  1. **Modelo actualizado a `gemini-3.8-flash`:** Se configuró `GEMINI_DEFAULT_MODEL = "gemini-3.8-flash"` y la función [`resolveGeminiModel`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/ai-engine.ts#L22-L30) que actualiza automáticamente nombres de modelos retirados (`gemini-1.5-flash`, `gemini-2.0-flash`, `gemini-2.5-flash`) a `gemini-3.8-flash`.
  2. **Prompts 100% agnósticos al giro de negocio y sin plantillas falsas locales:**
     - Se eliminó por completo el generador local de plantillas de cafetería (`buildContextualDraft`). Si no hay proveedor IA configurado (`VITE_GEMINI_API_KEY` o `VITE_AI_WEBHOOK_URL`), el motor lanza un error explícito en lugar de inventar textos locales.
     - [`buildBrandSystemPrompt`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/brand.ts#L45-L64) y [`buildPostGenerationUserPrompt`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/ai-engine.ts#L636-L657) redactan publicaciones adaptadas exclusivamente al nombre, tono, reglas negativas (`REQ-1.2`) y etiquetas disponibles de la sucursal activa.
  3. **Optimización crítica de velocidad (~2 minutos → ~2–4 segundos):**
     - **Control de razonamiento (`thinkingConfig`):** En modelos `gemini-3.x`, [`buildGeminiThinkingConfig`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/ai-engine.ts#L113-L119) inyecta `thinkingConfig: { thinkingLevel: "LOW" }` para evitar que el modelo gaste 30–45 segundos en cadenas de pensamiento profundo antes de redactar un post corto.
     - **Contrato JSON forzado a nivel de API (`responseSchema`):** Se añadieron [`AI_POST_RESPONSE_SCHEMA`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/ai-engine.ts#L51-L75) y [`VISION_TAGS_RESPONSE_SCHEMA`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/ai-engine.ts#L77-L86) en `generationConfig.responseSchema` para garantizar que Gemini devuelva las llaves exactas en el **primer intento** sin consumir los 2 reintentos de [`generateWithRetry`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/ai-engine.ts#L563-L582).
     - **Filtro de bloques de pensamiento (`thought: true`):** [`extractGeminiResponseText`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/ai-engine.ts#L96-L111) filtra cualquier parte interna de razonamiento (`part.thought === true`) y toma únicamente el JSON final.

---

### B. CRUD Completo de Sucursales y Pipeline CI
- **Archivos principales:**
  - [`src/lib/store.ts`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/store.ts)
  - [`src/routes/settings.tsx`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/routes/settings.tsx)
  - [`src/test/branch-store.test.ts`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/test/branch-store.test.ts)
  - [`.github/workflows/ci.yml`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/.github/workflows/ci.yml)
- **Qué se hizo:**
  - Se agregó la acción [`removeSucursal`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/store.ts#L45-L65) en el store de Zustand (`useBranchStore`) que elimina la sucursal y selecciona automáticamente la primera sucursal restante (o `null` si no quedan más).
  - En [`src/routes/settings.tsx`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/routes/settings.tsx) se implementó el botón **"Eliminar sucursal"** con doble confirmación mediante `AlertDialog` (`"¿Estás seguro de eliminar esta sucursal?"`), verificación de borrado efectivo en Supabase (`hasAffectedRows`) y manejo de clave foránea (`23503`).
  - Se registró la rama `connect_real_llm_vision` en [`.github/workflows/ci.yml`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/.github/workflows/ci.yml) para ejecutar `typecheck`, `test` y `build` en cada `push`.

---

### C. Fase B — Edición/Reprogramación de Publicaciones, Métricas Reales, Estado de Integraciones y Visión Bajo Demanda
- **Archivos principales:**
  - [`src/lib/data.ts`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/data.ts)
  - [`src/routes/index.tsx`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/routes/index.tsx)
  - [`src/routes/activos.tsx`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/routes/activos.tsx)
  - [`src/routes/settings.tsx`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/routes/settings.tsx)
- **Qué se hizo:**
  1. **Modal completo de edición y reprogramación (`Fase B`) en [`src/routes/index.tsx`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/routes/index.tsx#L801-L891):**
     - Permite editar en una sola ventana:
       - **Red social destino:** selector interactivo `Instagram` / `Facebook` (`red_social`).
       - **Fecha y hora programada:** `<input type="datetime-local" />` sincronizado con `publicaciones.fecha_publicacion` mediante [`toDatetimeLocalInputValue`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/data.ts#L278-L299) y [`parseDatetimeLocalToIso`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/data.ts#L305-L311).
       - **Imagen / Activo vinculado:** selector visual de miniaturas de la galería de la sucursal (`activo_id`), actualizando automáticamente el `contador_uso` cuando se cambia el activo.
       - **Texto del copy (`texto_copy`):** con contador de caracteres hasta `MAX_POST_COPY_LENGTH` (`2200`) validado por [`validatePostEditPayload`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/data.ts#L337-L382).
  2. **Contador real en `"Publicados este mes"`:**
     - Reemplazado el valor estático `24` en el Dashboard por [`countPublishedThisMonth(posts)`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/data.ts#L388-L409), que cuenta las publicaciones con estado `publicado` / `publicada` en el mes y año actual, mostrando `0` cuando no hay ninguna.
  3. **Aviso transparente en Integraciones (Meta Graph API):**
     - En [`src/routes/settings.tsx`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/routes/settings.tsx#L194-L246), al pulsar el botón de conexión con Instagram/Facebook se muestra un `toast.info` explicando que la integración OAuth real con Meta Graph API está pendiente de la fase final, y se limpian tokens simulados (`token_...`) para no mostrar una conexión falsa.
  4. **AI Vision bajo demanda al gestionar activos:**
     - En [`src/routes/activos.tsx`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/routes/activos.tsx#L121-L219), la subida de imágenes asigna etiquetas iniciales instantáneas con [`inferTagsFromFilename`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/data.ts#L246-L258) (`0` espera de red IA durante el upload), mientras que el análisis visual con Gemini Vision (`gemini-3.8-flash`) se ejecuta bajo demanda cuando el usuario pulsa **"Sugerir con IA Vision"** dentro del diálogo **Editar etiquetas**.

---

### D. Fase C — Validación de Dimensiones y Relación de Aspecto para Meta API (`REQ-2.1`)
- **Archivos principales:**
  - [`src/lib/data.ts`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/data.ts#L64-L204)
  - [`src/routes/activos.tsx`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/routes/activos.tsx#L138-L157)
  - [`src/test/asset-stock-alert.test.ts`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/test/asset-stock-alert.test.ts#L192-L239)
- **Qué se hizo:**
  - Función pura [`validateImageDimensions(width, height)`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/data.ts#L126-L173) que verifica:
    - Resolución mínima de `320×320 px` (`MIN_ASSET_DIMENSION_PX`).
    - Proporción **Feed** entre `4:5` (`0.8`) y `1.91:1` (`1.91`), incluyendo `1:1` cuadrado, con `5%` de tolerancia (`META_ASPECT_RATIO_TOLERANCE`).
    - Proporción **Stories / Reels** `9:16` (`0.5625`), con `5%` de tolerancia.
  - Helper [`readImageDimensions(file)`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/lib/data.ts#L179-L204) que inspecciona `naturalWidth` y `naturalHeight` en el navegador antes de subir a Supabase Storage, bloqueando imágenes incompatibles con un mensaje detallado.

---

## 3. Próximos Pasos Pendientes (Para Continuar en el Nuevo Chat)

### Paso 1 (Siguiente): Generación Semanal de Imágenes con IA (Gemini / Imagen API)
El usuario solicitó implementar la **generación semanal de imágenes con IA** enlazada con su cuenta Pro de Gemini API, utilizando el siguiente **Prompt Maestro** ya acordado:

```markdown
Actúa como un Arquitecto de Software Senior. Vamos a implementar el "Generador Semanal de Imágenes con IA" en AutoSocial AI usando la API de Google Gemini / Imagen (`VITE_GEMINI_API_KEY`).

Debes respetar estrictamente todas las reglas de `AGENTS.md` y la arquitectura actual del proyecto:
1. Agnóstico al giro de negocio: El prompt visual que se envía al modelo generador de imágenes NUNCA debe asumir que la marca es una cafetería. Debe construirse dinámicamente a partir de la sucursal activa (`sucursalActiva.nombre`, `sucursalActiva.tono`, `sucursalActiva.reglas_negativas`), el pilar de contenido seleccionado (`Venta / Producto`, `Educativo`, `Estilo de vida / Comunidad`) y un tema o contexto opcional ingresado por el usuario.
2. Reglas de negocio en funciones puras (`src/lib/` + tests en `src/test/`):
   - En `src/lib/ai-engine.ts`, crea funciones puras y tipadas para:
     a) `buildWeeklyImagePrompt(params)`: Construye el prompt fotográfico/visual profesional para cada pieza del lote semanal, inyectando identidad de marca, pilar temático, estilo visual acorde al tono (`Cercano`, `Profesional`, `divertido`, `moderno`, etc.) y exclusión estricta de `reglas_negativas` (además de prohibir texto deformado o marcas de agua).
     b) `generateImageWithGemini(params)`: Conecta con el endpoint de generación de imágenes de Google Gemini / Imagen API usando `VITE_GEMINI_API_KEY`, soportando relaciones de aspecto compatibles con Meta API (`1:1`, `4:5`, `9:16`), y devuelve la imagen en base64 / `Blob` junto con sus etiquetas sugeridas (`#ia_generada` + tags del pilar).
     c) `calculateWeeklyBatchPlan(params)`: Función pura que planifica el lote semanal (por ejemplo, de 1 a 5 imágenes distribuidas según la regla de pilares 40% Venta, 30% Educativo, 30% Estilo de vida).
3. Persistencia real en Supabase (`activos` + bucket `galeria`):
   - En `src/routes/activos.tsx`, añade un modal o panel interactivo "Generar Pack Semanal con IA" donde el usuario pueda:
     - Elegir cuántas imágenes generar para la semana (ej. 1, 3 o 5 imágenes) y la proporción (`1:1` Feed cuadrado, `4:5` Feed vertical o `9:16` Stories).
     - Escribir una indicación o campaña semanal opcional (ej. "Lanzamiento de nuevo servicio", "Promoción de fin de mes").
     - Previsualizar o subir automáticamente cada imagen generada al bucket `galeria` de Supabase Storage (`${sucursalActiva.id}/ai-${Date.now()}-${index}.png`) e insertarla en la tabla `activos` con `contador_uso: 0` y sus etiquetas automáticas.
4. Estilos y Calidad:
   - Usa exclusivamente tokens semánticos de `src/styles.css` (cero colores hexadecimales crudos).
   - Mantén compatibilidad total con `exactOptionalPropertyTypes: true` en TypeScript.
   - Añade pruebas unitarias completas en `src/test/ai-engine.test.ts` (mockeando `fetch`) y verifica que `npm test` y `npm run typecheck` pasen sin errores.
```

### Paso 2 (Fase Final): Integración OAuth Real con Meta Graph API y Publicación Automática
- Conectar el flujo OAuth real de Meta Graph API en [`src/routes/settings.tsx`](file:///C:/Users/emanu/.gemini/antigravity/worktrees/cafe-social-pilot/connect_real_llm_vision/src/routes/settings.tsx) para almacenar tokens cifrados reales en la tabla `integraciones`.
- Implementar el worker / Edge Function que publique automáticamente en Instagram/Facebook cuando llegue la `fecha_publicacion` de los posts en estado `programado` y los pase a `publicado`.
