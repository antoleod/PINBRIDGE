# PINBRIDGE - Project Vision & Roadmap

## 1. El dolor real (The Pain)
Trabajas en entornos corporativos (Amgen, Teva, Parlamento Europeo, etc.) donde:
- Compartir/pegar información entre apps y cuentas es un infierno.
- Muchas apps requieren login corporativo, SSO, whitelists, políticas… rompiendo el “flujo”.
- Repites comentarios (ServiceNow, etc.) y debes escribirlos dos veces o copiar a mano.

## 2. La idea núcleo (The Core)
Un “vault” / “bridge” de texto para:
- Guardar frases/notas/plantillas (p. ej. comentarios de tickets).
- Recuperarlas instantáneamente en móvil o PC.
- Fricción mínima: PIN / código simple.
- Usable incluso si el entorno corporativo bloquea medio internet.
- **Principio clave**: Privacidad + Libertad + Open Source.

## 3. Funcionalidades Detalladas

### A) Login / Acceso
- [x] PIN personalizado (acceso rápido).
- [x] Session persistence (no logout on refresh).
- [ ] Contraseña opcional.
- [ ] Sign-in Google/GitHub (Opcional).

### B) Recuperación
- [x] Recovery Key (Appears once).
- [ ] Email/Teléfono opcional.
- [ ] Pregunta secreta.
- [ ] Archivo de recuperación descargable.

### C) Notas y Productividad
- [x] Notas rápidas.
- [x] Categorías / Carpetas.
- [x] Etiquetas (Tags, hashtag parsing).
- [ ] Etiquetas por color.
- [x] Búsqueda avanzada.
- [x] **Plantillas de notas recurrentes.** ✅ DONE
- [x] **Modo "solo lectura".** ✅ DONE
- [x] Papelera / borrados.
- [x] Historial de versiones (Git-like).
- [x] **Dashboard.** ✅ DONE

### D) Experiencia Móvil
- [x] PWA Instalable.
- [x] Modo offline robusto.
- [ ] Widgets.
- [ ] Recordatorios.

### E) Exportación / Respaldo
- [ ] Exportar (TXT/JSON/CSV/PDF). (NEXT PRIORITY)
- [ ] Backup cifrado (archivo).
- [x] Sincronización multi-dispositivo (SyncManager).

### F) Colaboración
- [ ] Compartir enlace seguro.
- [ ] Espacios compartidos.

## 4. Hosting & Deployment strategy
- Portfolio: AppLeo, AppLéna, PINBRIDGE.
- Stores: Play Store / Apple Store (Future).

## 5. Latest Implementation Notes

### Templates System (✅ Completed)
- Separate view for templates in sidebar
- Auto-mark notes as templates when created in Templates view
- Insert template content into current note
- Templates excluded from normal note views

### Read-Only Mode (✅ Completed)
- Lock button (🔒) in editor toolbar
- Prevents accidental edits
- Visual feedback when active
- All input fields become read-only

### Dashboard (✅ Completed)
- Stats cards: Total Notes, Favorites, Folders, Tags
- Recent Notes (last 5, clickable)
- Popular Tags (top 10 by frequency, clickable for search)
- Quick Actions: New Note, New Template, View Favorites, View Trash
- Responsive grid layout
