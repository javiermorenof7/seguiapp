# seguiapp

Seguimiento personal: lo que no se mide no se controla. Una web para medir finanzas, gym, cuerpo, hábitos, tareas o cualquier otra cosa, y ver en gráficos cómo va cada una frente a su meta.

Web: https://seguiapp.pages.dev/ (acceso solo por invitación).

Versión de desarrollo: https://javiermorenof7.github.io/seguiapp/ (franja "Desarrollo" arriba; usa la misma base).

## Tecnología

- React + Vite + TypeScript, instalable en el celular (PWA).
- Fuente Bricolage Grotesque servida desde la propia web.
- Pruebas con Vitest.
- Supabase (PostgreSQL y autenticación con Google) y Chart.js.
- Publicación con GitHub Actions: producción en Cloudflare Pages y desarrollo en GitHub Pages.

## Estructura

- `src/`: la aplicación.
  - `App.tsx`: pantallas: entrar con Google, "Mi seguimiento" (una tarjeta por seguimiento con su gráfico y su estado frente a la meta, primero lo que va fuera), detalle con registro y gráfico, y creación de seguimientos.
  - `indicadores.ts`: cálculos de cada seguimiento: período, total o promedio, estado frente a la meta y serie del gráfico.
  - `datos.ts`: única capa de acceso a Supabase.
  - `cola.ts`: registros hechos sin conexión, guardados en el navegador (IndexedDB) hasta poder enviarlos; se borran al cerrar sesión.
  - `Privacidad.tsx`: política de tratamiento de datos personales (Ley 1581 de 2012).
  - `Grafico.tsx`: gráfico de línea (Chart.js) con la meta punteada.
  - `csp.ts`: política de seguridad de contenido (se agrega a la página publicada) y cabeceras de producción (`_headers`).
  - `entorno.ts`: ruta base de cada versión: `/seguiapp/` en desarrollo y la raíz en producción.
- `supabase/migrations/`: esquema de la base (PostgreSQL en Supabase): tablas del motor de seguimiento y de las plantillas, con seguridad por fila (cada persona ve solo sus datos y solo mientras esté invitada).
- `public/`: manifiesto, ícono y service worker (guarda solo los archivos de la web, nunca datos).
- `.github/workflows/publicar.yml`: instala, revisa vulnerabilidades (`npm audit`), corre las pruebas y construye; un push a `dev` publica en GitHub Pages y uno a `main` en Cloudflare Pages. Los pull requests solo construyen.
- `.github/workflows/latido.yml`: cada lunes hace una consulta mínima (`latido()`, no lee datos) para que el proyecto gratuito de Supabase no se pause por inactividad.
- `.github/dependabot.yml`: actualizaciones semanales de dependencias y de Actions, hacia `dev`.

## Ramas

- `dev`: desarrollo, publicado en GitHub Pages.
- `main`: producción, publicada en Cloudflare Pages. Solo recibe cambios por pull request desde `dev`.
- Ninguna de las dos se puede borrar ni recibir push forzado.

## Seguridad

- La página publicada lleva una política de contenido que solo permite la propia web, el proyecto de Supabase y las fotos de perfil de Google; sin código en línea ni scripts de terceros.
- En producción, además, cabeceras que impiden mostrarla dentro de otra página, fuerzan HTTPS y no envían la dirección de origen.
- El token de Cloudflare solo existe para la rama `main` y el job que publica no instala dependencias.
- Acceso solo por invitación: inicio de sesión con Google y una lista de correos permitidos que la base revisa antes de crear cada cuenta.
- No se indexa en buscadores.
- Las dependencias y las Actions van con versión exacta.

## Desarrollo

```
npm ci
npm run dev
npm test
npm run build       # producción
npm run build:dev   # desarrollo
```
