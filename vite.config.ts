import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { CABECERAS, CSP } from './src/csp'

export default defineConfig({
  plugins: [
    react(),
    {
      // Solo en la publicación: el servidor de desarrollo necesita código en línea.
      name: 'csp',
      apply: 'build',
      transformIndexHtml: () => [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head' },
      ],
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: '_headers', source: CABECERAS })
      },
    },
  ],
})
