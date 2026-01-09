# PINBRIDGE Coach Module

## 1. Arquitectura y Visión General

El módulo "COACH" es una herramienta de aprendizaje personal y adaptativa integrada en PINBRIDGE. Su objetivo es permitir a los usuarios dominar cualquier tema mediante un enfoque de "decision-first", remediación inteligente y seguimiento del progreso a largo plazo.

La arquitectura es modular y se integra con el sistema existente de PINBRIDGE sin dependencias externas.

### Archivos Principales
- **`coach.js`**: El punto de entrada del módulo. Inicializa los demás componentes y gestiona el estado principal de la aplicación y la navegación entre vistas.
- **`coachStore.js`**: La capa de datos. Encapsula toda la interacción con Firestore, manejando la lectura y escritura de `settings`, `skills`, `sessions`, `exams`, etc.
- **`coachEngine.js`**: El cerebro del aprendizaje. Contiene la lógica para generar roadmaps, gestionar las sesiones de estudio (2-Pass Mastery), seleccionar `concept_id` y `variant_id`, y manejar el "Spaced Repetition".
- **`examEngine.js`**: Gestiona todo el ciclo de vida de los exámenes, desde la selección de preguntas hasta la calificación y la generación de planes de remediación.
- **`uiRenderer.js`**: Se encarga de renderizar dinámicamente las diferentes vistas (Dashboard, Sesión, Examen) dentro del panel principal del coach.
- **`i18n.js`**: Gestiona la internacionalización (i18n) tanto para la UI como para el contenido de aprendizaje.
- **`coach.css`**: Contiene todos los estilos específicos del módulo COACH, siguiendo la guía de estilo de PINBRIDGE.

## 2. Flujo de Vistas y UX

El módulo se compone de varias vistas principales que se renderizan dinámicamente:

1.  **Dashboard (`coach_dashboard`)**: La pantalla de inicio. Muestra el objetivo actual, el progreso, el streak y un botón para comenzar la sesión del día.
2.  **Sesión (`coach_session`)**: El corazón del aprendizaje. Presenta un escenario y una decisión. El usuario debe responder y autoevaluar su confianza.
3.  **Feedback de Sesión**: Tras enviar una decisión, se muestra si fue correcta o no, una explicación concisa y la "trampa" común asociada a ese concepto.
4.  **Examen (`coach_exam`)**: Una serie de decisiones cronometradas para evaluar el dominio de un módulo.
5.  **Resultados del Examen**: Muestra la puntuación, los dominios débiles y un plan de remediación.
6.  **Configuración (`coach_settings`)**: Permite al usuario configurar sus preferencias, como el idioma de la UI y del contenido.

## 3. Modelo de Datos en Firestore

Toda la información del usuario se almacena en Firestore bajo la colección `users/{uid}/`, garantizando la privacidad de los datos.

- `coach_settings/main`: Configuraciones del usuario (idioma, etc.).
- `coach_skills/{skillId}`: Los temas generales que el usuario quiere aprender.
- `coach_modules/{moduleId}`: Módulos dentro de una `skill`.
- `coach_sessions/{sessionId}`: Registros de cada sesión de estudio.
- `coach_attempts/{attemptId}`: Cada una de las respuestas del usuario a una pregunta/decisión.
- `coach_error_memory/{conceptOrErrorId}`: Agrega los errores por `concept_id` para el "Spaced Repetition".
- ... y otras colecciones para exámenes, quizzes, etc.

Cada entidad almacena metadatos como `createdAt`, `updatedAt`, `content_version` y `source_metadata`.

## 4. Internacionalización (i18n)

El sistema de i18n es un pilar del módulo:

- **`ui_language`**: Controla el idioma de la interfaz (botones, etiquetas, etc.). Se guarda en `coach_settings`.
- **`content_language`**: Controla el idioma del contenido de aprendizaje (escenarios, preguntas, explicaciones). Se guarda en `coach_settings`.

El usuario puede cambiar el `content_language` en cualquier momento, y la vista se re-renderiza inmediatamente con el nuevo idioma sin perder el progreso. Todo el contenido de aprendizaje se almacena en un único documento de Firestore con campos `_i18n`, por ejemplo: `title_i18n: { en: "Title", es: "Título" }`.

## 5. Exam Engine Universal

El motor de exámenes (`examEngine.js`) está diseñado para ser extensible.

- **MVP**: Soporta `exam_type="scenario_mcq"` (escenario con opción múltiple).
- **Flujo**:
    1. `startExam()`: Crea un `attempt` en Firestore y comienza un temporizador.
    2. `submitAnswer()`: Guarda la respuesta, la confianza y la justificación del usuario.
    3. `finishExam()`: Calcula la puntuación, identifica dominios débiles y genera un plan de remediación y un "transfer check".
- **Extensibilidad**: Para añadir un nuevo tipo de examen (ej. `code_challenge`), se debe:
    1. Añadir una nueva función de renderizado en `uiRenderer.js`.
    2. Añadir una nueva lógica de validación en `examEngine.js`.
    3. Asegurarse que el modelo de datos para la pregunta soporta el nuevo formato.

## 6. Estrategia de Estudio

El módulo implementa una estrategia de aprendizaje combinada:

- **2-Pass Mastery**: Un primer intento "a ciegas" y un segundo intento asistido si se falla.
- **Interleaving**: Mezcla conceptos de diferentes módulos para forzar una recuperación más profunda.
- **Teach-back**: Pide al usuario que explique un concepto con sus propias palabras.
- **Spaced Repetition**: Reintroduce conceptos donde el usuario ha fallado en intervalos crecientes (+1, +3, +7 días).

## 7. Cómo Añadir una Nueva Skill

Para añadir una nueva `skill` con su contenido:

1.  **Definir la Skill**: Crea un nuevo documento en `coach_skills` con el `skillId` y la metadata.
2.  **Generar el Contenido**: El `coachEngine.js` contiene un generador de roadmaps. Para el MVP, se pueden añadir nuevos generadores hardcodeados. En el futuro, esto será reemplazado por una API.
3.  **Crear las Preguntas**: Añade documentos a `coach_quizzes` (o una colección similar de "conceptos") con `concept_id`, `variant_id`, y el contenido `_i18n`.
