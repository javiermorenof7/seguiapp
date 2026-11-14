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
export async function lineasDePdf(archivo: File, clave: string | undefined, alAvanzar: (pagina: number, total: number) => void): Promise<string[]> {
  const tarea = pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()), password: clave })
  let documento: Awaited<typeof tarea.promise>
  try {
    documento = await tarea.promise
  } catch (e) {
    if ((e as Error).name === 'PasswordException') throw new PdfConClave(clave !== undefined)
    throw e
  }
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
