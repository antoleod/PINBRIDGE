# COACH (PINBRIDGE)

Módulo nativo (HTML/CSS/JS puro) para aprender cualquier tema con estrategia **decision-first** y persistencia por usuario en **Firestore**.

## 1) Arquitectura

Código: `src/modules/coach/`

- `src/modules/coach/coach.js`: orquestación del módulo (navegación interna, estado runtime de sesión/examen, render).
- `src/modules/coach/coachStore.js`: capa de datos Firestore (settings, skills, modules, sessions, quizzes, attempts, maintenance, error_memory).
- `src/modules/coach/coachEngine.js`: generación local de roadmap (MVP), selección de sesión, **2-pass mastery**, `concept_id`/`variant_id`, error_memory, detección de carga cognitiva.
- `src/modules/coach/examEngine.js`: **Exam Engine universal** (MVP `exam_type="scenario_mcq"`), attempt persistente con timer y remediación.
- `src/modules/coach/i18n.js`: i18n propio del módulo (UI vs contenido).
- `src/modules/coach/uiRenderer.js`: renderer de vistas (templates HTML + binding de eventos).
- `src/modules/coach/views/*.html`: vistas `dashboard`, `session`, `feedback`, `module`, `exam`, `exam-results`, `roadmap`, `login-required`.
- `src/modules/coach/coach.css`: estilos del módulo siguiendo el look&feel del repo.

## 2) Vistas y flujo UX

- **Dashboard**: tema activo, streak, “acción de hoy” y CTA “Start session”.
- **Coach-only mode**: al entrar a COACH se oculta la UI de notas (sidebar/list/editor) para evitar distracciones.
- **Session**: escenario + decisión (Pass 1 / Pass 2). Campos obligatorios:
  - `confidence_1to5`
  - `why_i_thought_this`
- **Feedback**: correcto/incorrecto + explicación corta + trampa común.
  - Recursos solo si falla / baja confianza / errores repetidos (máx 1YT + 1web + 1micro + 1habit).
  - Incluye calibración de confianza (over/underconfidence) y acciones (practice + mini-reto) sin teoría larga.
  - `teach_back` obligatorio cuando aplica (MVP: al acertar en Pass 2).
- **Modules**: lista corta con progreso (sin saturación).
- **Exam / Drill**: `scenario_mcq` con timer persistente (Exam 15 min/5Q, Drill 5 min/3Q).
- **Settings**: selector de idioma UI/Contenido (ver i18n).

## 3) Firestore: colecciones por `uid`

Todo vive bajo `users/{uid}/...` y solo el propietario puede acceder.

### Requeridas (MVP implementado)

- `users/{uid}/coach_settings/main`
  - `ui_language`: `"en" | "fr" | "es"`
  - `content_language`: `"en" | "fr" | "es"` (por defecto igual a `ui_language`)
  - `allow_multilang_toggle`: boolean
  - (extras MVP): `active_skill_id`, `spaced_repetition_intervals`, `content_version`
- `users/{uid}/coach_skills/{skillId}`
  - `skill_type`: `certification|technical|language|habit|cognitive`
  - `title_i18n`, `description_i18n`
  - `start_date`, `duration_days`
  - `content_version`, `createdAt`, `updatedAt`
- `users/{uid}/coach_modules/{moduleId}`
  - `skill_id`, `order`
  - `title_i18n`, `summary_i18n`
  - `concept_ids[]`
  - `content_version`, `createdAt`, `updatedAt`
- `users/{uid}/coach_sessions/{sessionId}`
  - `skill_id`, `module_id`, `day`, `planned_for` (YYYY-MM-DD)
  - `concept_id` (**regla de oro #1**)
  - runtime: `status`, `current_pass`, `active_variant_id`, `active_quiz_id`, `teach_back`
  - `content_version`, `createdAt`, `updatedAt`
- `users/{uid}/coach_quizzes/{quizId}`
  - `exam_type="scenario_mcq"`
  - `concept_id` (**regla de oro #1**)
  - `variant_id` (**regla de oro #2**)
  - `scenario_i18n`, `decision_prompt_i18n`, `options_i18n[]`, `explain_i18n`, `trap_i18n`, `hint_i18n`
  - `correct_index`, `difficulty_1to5`, `tags[]`
  - `resources` (YT/WEB/MICRO/HABIT) + `source_metadata`
  - `content_version`, `createdAt`, `updatedAt`
- `users/{uid}/coach_attempts/{attemptId}`
  - `attempt_type`: `session|exam|teach_back|real_world_feedback_form|...`
  - Para `session/exam`: `answer_index`, `confidence_1to5`, `why_i_thought_this`, `language_used`, `is_correct`
  - Para exam: `question_order[]`, `answers[]`, `duration_sec`, `started_at_ms`, `ends_at_ms`
  - `content_version`, `createdAt`, `updatedAt`
- `users/{uid}/coach_error_memory/{conceptId}`
  - `concept_id`, `count`, `lastFailureAt`, `repetitionCount`, `nextRepetitionDate`, `lastVariantId`
- `users/{uid}/coach_maintenance/main`
  - `streak_days`, `last_completed_date`, `consecutive_wrong`

### Reservadas para v2 (esqueleto)

- `users/{uid}/coach_exams/{examId}`
- `users/{uid}/coach_feedback_real/{feedbackId}`

## 4) i18n (OBLIGATORIO)

Firestore:

- `users/{uid}/coach_settings/main`
  - `ui_language`: idioma de la UI de COACH (labels/botones).
  - `content_language`: idioma del contenido (escenarios/opciones/explicaciones).
  - `allow_multilang_toggle`: si es `false`, `content_language` sigue a `ui_language`.

Reglas:

1. La UI de COACH usa siempre `ui_language` (strings en `src/modules/coach/i18n.js`).
2. El contenido usa siempre `content_language` seleccionando dinámicamente `*_i18n[content_language]` con fallback seguro **en → fr → es**.
3. Cambiar `content_language` re-renderiza sesión/examen inmediatamente y **no reinicia** el progreso.
4. El contenido se guarda en un solo documento (no duplicar docs por idioma).

## 5) Reglas de oro: `concept_id` + `variant_id` + i18n

1. **`concept_id`** agrupa la habilidad/concepto y es estable (reutilizable en sesiones/quizzes/exámenes).
2. **`variant_id`** cambia el escenario para reintentos inteligentes:
   - si el usuario falla, se reintenta el mismo `concept_id` con otro `variant_id`.
   - implementación: `coachEngine.getAlternativeVariant(conceptId, excludeVariantId)`.
3. Todo contenido de aprendizaje incluye i18n (`*_i18n` con `en/fr/es`).

## 6) Estrategia de estudio (MVP)

- **2-PASS MASTERY**:
  - Pass 1: sin recursos (blind).
  - Si falla o confianza ≤2: Pass 2 asistido (nuevo `variant_id` + hint).
- **Interleaving**: sesiones generadas en round-robin por módulos (evita bloques largos).
- **Teach-back**: obligatorio al acertar en Pass 2 (MVP).
- **Spaced repetition**: errores programan reintroducción (+1/+3/+7 por defecto) en `coach_error_memory`.
- **Cognitive load**: si `consecutive_wrong>=3`, la selección favorece variantes de menor dificultad (MVP).

## 7) Exam Engine universal (MVP `scenario_mcq`)

Archivo: `src/modules/coach/examEngine.js`

- `startExam(...)`:
  - selecciona preguntas priorizando conceptos fallados
  - crea attempt persistente en `coach_attempts/{attemptId}` con timer (`started_at_ms`, `ends_at_ms`)
- `submitAnswer(...)`:
  - guarda `answer_index`, `confidence_1to5`, `why_i_thought_this`, `language_used`
  - si falla: actualiza `coach_error_memory/{conceptId}` y evita repetir `variant_id`
- `finishExam(...)`:
  - calcula score + pass/fail
  - `weak_domains` por tags
  - genera:
    - `remediation_plan_i18n` (3 días)
    - `transfer_check` (MVP)
    - formulario de feedback real (MVP)

## 8) Cómo extender (v2)

- Generador remoto:
  - reemplazar `coachEngine.generateBlueprint()` por una llamada a API y guardar exactamente el mismo contrato (misma estructura y i18n).
- Nuevos `exam_type`:
  - añadir renderer en `uiRenderer.js` + lógica en `examEngine.js` (registry por `exam_type`).
- Mejorar SR:
  - convertir `coach_error_memory` en scheduler completo (due queries, colas por día) sin duplicar contenido.

## 9) Cómo probar (dev)

1. Abrir `index.html` con un servidor estático (por CSP + ES modules).
2. Autenticar/desbloquear la app.
3. Ir a **COACH** en el menú.
4. Dashboard → “Change topic” → crear roadmap (ej.: `AWS Storage` o `French`).
5. “Start session” → responder + escribir `why` + elegir `confidence`.
6. Forzar fallo/baja confianza para ver Pass 2 y recursos contextuales.
7. “Start exam” y completar 5 preguntas.
8. Settings → cambiar `content_language` y verificar re-render sin perder progreso.
