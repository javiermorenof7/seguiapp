// dev se publica en GitHub Pages bajo /seguiapp/; producción (Cloudflare) en la raíz.
export const DESARROLLO = 'desarrollo'

export const baseDe = (modo: string) => (modo === DESARROLLO ? '/seguiapp/' : '/')
