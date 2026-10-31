# rogalba19.github.io
my page

## Avatar de conciencia digital

La Galaxia de Conocimiento (`index.html` + `js/galaxy.js`) incluye detrás del grafo
un rostro hecho de partículas, construido a partir de una foto y animado de forma
procedural (`js/avatar/`). La web pública **solo** carga dos archivos ya
preprocesados:

| Archivo | Qué es |
| --- | --- |
| `assets/avatar/malla.json` | 478 landmarks normalizados, UV, triangulación y regiones |
| `assets/avatar/rostro.webp` | recorte optimizado de la foto (≤ 300 KB), textura de color |

Si faltan, la Galaxia funciona igual, sin avatar. MediaPipe **nunca** se carga en
la web: solo lo usa la herramienta offline.

### Regenerar la malla (cuando cambies la foto)

1. Copia tu foto frontal, bien iluminada, como `assets/avatar/rostro.jpg`.
   Este archivo está en `.gitignore`: el original no se publica.
2. Arranca un servidor local en la raíz del repo:
   ```bash
   python3 -m http.server 8000
   ```
3. Abre en Chrome, Edge o Firefox <http://localhost:8000/tools/generar-malla.html>
   y pulsa **Procesar assets/avatar/rostro.jpg** (o elige otra foto con el
   selector). Revisa la vista previa: la malla debe calzar en el rostro, los
   párpados superiores van en verde y los inferiores en naranja.
4. Pulsa **Descargar** y guarda `malla.json` y `rostro.webp` en `assets/avatar/`,
   reemplazando los anteriores.
5. Recarga <http://localhost:8000/> (o `?debug` para ver el panel de ajustes).

Requiere conexión la primera vez (descarga MediaPipe Tasks Vision 0.10.14 y el
modelo `face_landmarker.task`).

### Panel de ajustes

Abre <http://localhost:8000/?debug> para ver el panel lil-gui (densidad,
inestabilidad, glitch, disolución, bloom, opacidad) y los FPS del avatar. Sin
`?debug` el panel no se carga.
