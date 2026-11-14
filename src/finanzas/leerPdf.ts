import * as pdfjs from 'pdfjs-dist'
import urlTrabajador from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = urlTrabajador

export class PdfConClave extends Error {
  constructor(public equivocada: boolean) { super('clave') }
}

/**
 * Las líneas de texto de un PDF, de arriba abajo. El archivo se lee en el equipo: no sale a ningún lado.
 * Lanza PdfConClave si pide clave o la que se dio no es.
 */
async function abrir(archivo: File, clave: string | undefined) {
  const tarea = pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()), password: clave })
  try {
    return { tarea, documento: await tarea.promise }
  } catch (e) {
    if ((e as Error).name === 'PasswordException') throw new PdfConClave(clave !== undefined)
    throw e
  }
}

export async function lineasDePdf(archivo: File, clave: string | undefined, alAvanzar: (pagina: number, total: number) => void): Promise<string[]> {
  const { tarea, documento } = await abrir(archivo, clave)
  const lineas: string[] = []
  try {
    for (let n = 1; n <= documento.numPages; n++) {
      alAvanzar(n, documento.numPages)
      const { items } = await (await documento.getPage(n)).getTextContent()
      // los textos de un mismo renglón comparten altura; se juntan de izquierda a derecha
      const renglones = new Map<number, { x: number; texto: string }[]>()
      for (const item of items) {
        if (!('str' in item) || !item.str.trim()) continue
        const y = Math.round(item.transform[5] / 3)
        renglones.set(y, [...(renglones.get(y) ?? []), { x: item.transform[4], texto: item.str }])
      }
      for (const [, partes] of [...renglones].sort((a, b) => b[0] - a[0]))
        lineas.push(partes.sort((a, b) => a.x - b.x).map(p => p.texto).join(' ').replace(/\s+/g, ' ').trim())
    }
  } finally {
    await tarea.destroy()
  }
  return lineas
}

/**
 * Lo mismo cuando el PDF trae los movimientos como imagen: dibuja cada página y la lee con OCR, también en el equipo.
 * El lector, su núcleo y el idioma son archivos de la propia app y solo se descargan aquí.
 */
export async function lineasPorOcr(archivo: File, clave: string | undefined, alAvanzar: (pagina: number, total: number) => void): Promise<string[]> {
  const [{ createWorker }, trabajador, nucleo] = await Promise.all([
    import('tesseract.js'),
    import('tesseract.js/dist/worker.min.js?url'),
    // shortcut: solo el núcleo con SIMD (navegadores desde 2023); sumar el de respaldo si alguien no puede leer
    import('tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url'),
  ])
  // el lector corre en otro hilo y resuelve las rutas desde su propio archivo: se le dan completas
  const completa = (ruta: string) => new URL(ruta, location.href).href
  const { tarea, documento } = await abrir(archivo, clave)
  // el idioma se copia a public/ocr al arrancar y al construir (ver package.json): el lector lo pide por su nombre
  const lector = await createWorker('spa', 1, {
    workerPath: completa(trabajador.default), corePath: completa(nucleo.default), langPath: completa(`${import.meta.env.BASE_URL}ocr`),
    workerBlobURL: false, cacheMethod: 'none',
  })
  const lineas: string[] = []
  try {
    for (let n = 1; n <= documento.numPages; n++) {
      alAvanzar(n, documento.numPages)
      const pagina = await documento.getPage(n)
      const vista = pagina.getViewport({ scale: 2.5 })
      const lienzo = document.createElement('canvas')
      lienzo.width = vista.width; lienzo.height = vista.height
      await pagina.render({ canvas: lienzo, viewport: vista }).promise
      const { data } = await lector.recognize(lienzo)
      lineas.push(...data.text.split('\n').map(l => l.trim()).filter(Boolean))
    }
  } finally {
    await lector.terminate()
    await tarea.destroy()
  }
  return lineas
}
