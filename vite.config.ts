import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { CABECERAS, CSP } from './src/csp'
import { DESARROLLO, baseDe } from './src/entorno'

export default defineConfig(({ mode }) => ({
  base: baseDe(mode),
  plugins: [
    react(),
    {
      // Solo en la publicación: el servidor de desarrollo necesita código en línea.
      name: 'csp',
      apply: 'build',
      transformIndexHtml: () => [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head' },
      ],
      // GitHub Pages ignora `_headers`; solo lo lleva la build de producción.
      generateBundle() {
        if (mode !== DESARROLLO) this.emitFile({ type: 'asset', fileName: '_headers', source: CABECERAS })
      },
    },
  ],
}))
