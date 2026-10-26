# seguiapp

Seguimiento personal: lo que no se mide no se controla. Una web para medir finanzas, gym, cuerpo, hábitos, tareas o cualquier otra cosa, y ver en gráficos cómo va cada una frente a su meta.

Web: https://javiermorenof7.github.io/seguiapp/ (acceso solo por invitación).

## Tecnología

- React + Vite + TypeScript, instalable en el celular (PWA).
- Fuente Bricolage Grotesque servida desde la propia web.
- Pruebas con Vitest.
- Publicación en GitHub Pages con GitHub Actions.

## Estructura

- `src/`: la aplicación.
  - `csp.ts`: política de seguridad de contenido; se agrega a la página publicada.
- `supabase/migrations/`: esquema de la base (PostgreSQL en Supabase): tablas del motor de seguimiento y de las plantillas, con seguridad por fila (cada persona ve solo sus datos y solo mientras esté invitada).
- `public/`: manifiesto, ícono y service worker (guarda solo los archivos de la web, nunca datos).
- `.github/workflows/publicar.yml`: en cada push a `main` instala, revisa vulnerabilidades (`npm audit`), corre las pruebas, construye y publica.
- `.github/dependabot.yml`: actualizaciones semanales de dependencias y de Actions.

## Seguridad

- La página publicada lleva una política de contenido que solo permite la propia web, el proyecto de Supabase y las fotos de perfil de Google; sin código en línea ni scripts de terceros.
- Acceso solo por invitación: inicio de sesión con Google y una lista de correos permitidos que la base revisa antes de crear cada cuenta.
- No se indexa en buscadores.
- Las dependencias y las Actions van con versión exacta.

## Desarrollo

```
npm ci
npm run dev
npm test
npm run build
```
