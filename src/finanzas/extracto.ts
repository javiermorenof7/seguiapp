import { categoriaDe, normalizar, type Categoria } from './parseo'

// Montos en centavos con signo: positivo entra a la cuenta, negativo sale.
export interface MovimientoBanco {
  fecha: string
  descripcion: string
  valor: number
  saldo: number
  /** fecha + valor + saldo: distingue dos movimientos iguales del mismo día */
  huella: string
  /** no sigue el saldo de la fila anterior: hay que revisar el monto */
  dudoso?: boolean
}

export interface ExtractoLeido {
  ultimos4: string | null
  desde: string
  hasta: string
  saldoInicial: number
  saldoFinal: number
  movimientos: MovimientoBanco[]
}

/** Qué es cada monto de una fila, contando desde 0. Con `valor`, el signo sale del saldo. */
export type Formato = { saldo: number } & ({ credito: number; debito: number } | { valor: number })

export type Lectura =
  // sin formato cuando el extracto no tiene columnas que elegir (signo aparte, sin saldo por fila)
  | { ok: true; extracto: ExtractoLeido; formato?: Formato }
  | { ok: false; motivo: 'sin_movimientos' }
  | { ok: false; motivo: 'columnas'; ejemplo: { descripcion: string; montos: number[] } }

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const FECHA = /^(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?|(\d{1,2})\s+(?:de\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\.?(?:\s+(?:de\s+)?(\d{4}))?)(?=\s|$)/i
// Un monto lleva decimales o separador de miles; un número largo corrido (una referencia) no lo es.
const MONTO = /(?<![\d.,])[-(]?\$?\s?(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{2})\)?-?(?![\d.,]*\d)/g

const dos = (n: number | string) => String(n).padStart(2, '0')

function leerFecha(linea: string, ano: number): { fecha: string; resto: string } | null {
  const m = FECHA.exec(linea)
  if (!m) return null
  let a: number, mes: number, dia: number
  if (m[1]) [a, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else if (m[4]) {
    dia = Number(m[4]); mes = Number(m[5])
    a = m[6] ? (m[6].length === 2 ? 2000 + Number(m[6]) : Number(m[6])) : ano
  } else { dia = Number(m[7]); mes = MESES.indexOf(m[8].toLowerCase()) + 1; a = m[9] ? Number(m[9]) : ano }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  return { fecha: `${a}-${dos(mes)}-${dos(dia)}`, resto: linea.slice(m[0].length) }
}

/** "1.234,56", "1,234.56", "$ 25.000", "(1.000,00)" o "1.000,00-" a centavos. */
export function leerCentavos(texto: string): number {
  const negativo = /^[-(]|-$/.test(texto.trim())
  const limpio = texto.replace(/[^\d.,]/g, '')
  const decimales = /[.,](\d{1,2})$/.exec(limpio)
  const entero = Number((decimales ? limpio.slice(0, decimales.index) : limpio).replace(/[.,]/g, ''))
  const centavos = entero * 100 + (decimales ? Number(decimales[1].padEnd(2, '0')) : 0)
  return negativo ? -centavos : centavos
}

interface Fila { fecha: string; textos: string[]; montos: number[] }

// el año que más se repite en el extracto: las filas suelen traer solo día y mes
function anoDe(lineas: string[]): number {
  const anos = lineas.join(' ').match(/\b20\d{2}\b/g) ?? []
  return Number(anos.sort((a, b) => anos.filter(x => x === b).length - anos.filter(x => x === a).length)[0] ?? new Date().getFullYear())
}

function filas(lineas: string[], antes: number[]): Fila[] {
  const ano = anoDe(lineas)
  const salida: Fila[] = []
  // la fila que trae su descripción en el renglón de la fecha ya está completa: lo que sigue es pie de página
  let completa = false
  for (const cruda of lineas) {
    let linea = cruda.trim()
    const f = leerFecha(linea, ano)
    if (f) { salida.push({ fecha: f.fecha, textos: [], montos: [] }); linea = f.resto.trim(); completa = false }
    const montos = linea.match(MONTO) ?? []
    const fila = salida[salida.length - 1]
    if (!fila) { antes.push(...montos.map(leerCentavos)); continue }
    fila.montos.push(...montos.map(leerCentavos))
    // una segunda fecha en la fila (fecha valor) no es parte de la descripción
    // el "$" que queda suelto cuando el signo va entre él y el número ("$-25.900,00", Nequi)
    const texto = linea.replace(MONTO, ' ').replace(/^\s*\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\s+/, '').replace(/(?<!\S)\$(?!\S)/g, ' ').replace(/\s+/g, ' ').trim()
    if (texto && /[a-záéíóúñ]/i.test(texto) && !completa && fila.textos.length < 2 && texto.length <= 80) fila.textos.push(texto)
    if (f && fila.textos.length) completa = true
  }
  return salida
}

const moda = (numeros: number[]) => {
  const veces = new Map<number, number>()
  for (const n of numeros) veces.set(n, (veces.get(n) ?? 0) + 1)
  return [...veces].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
}

function armar(base: Fila[], formato: Formato, antes: number[]): { movimientos: MovimientoBanco[]; saltos: number; saldoInicial: number } {
  const movimientos: MovimientoBanco[] = []
  let saltos = 0
  let saldoInicial = 0
  const conSigno = 'valor' in formato && base.some(f => f.montos[formato.valor] < 0)
  base.forEach((f, i) => {
    const saldo = f.montos[formato.saldo]
    const anterior = i ? movimientos[i - 1].saldo : null
    let valor: number
    if ('valor' in formato) {
      const bruto = f.montos[formato.valor]
      // si la columna trae los débitos con menos, lo que no lo lleva es un crédito
      if (conSigno) valor = bruto
      else if (bruto < 0 || anterior === null) {
        // primera fila sin signo: lo da el saldo anterior si aparece antes de la tabla
        valor = bruto < 0 ? bruto : antes.includes(saldo - bruto) ? bruto : -bruto
      } else valor = saldo >= anterior ? Math.abs(bruto) : -Math.abs(bruto)
    } else valor = Math.abs(f.montos[formato.credito]) - Math.abs(f.montos[formato.debito])
    const dudoso = anterior !== null && anterior + valor !== saldo
    if (dudoso) saltos++
    if (!i) saldoInicial = saldo - valor
    movimientos.push({ fecha: f.fecha, descripcion: f.textos.join(' '), valor, saldo, huella: `${f.fecha}|${valor}|${saldo}`, ...(dudoso ? { dudoso } : {}) })
  })
  return { movimientos, saltos, saldoInicial }
}

function candidatos(k: number): Formato[] {
  if (k === 2) return [{ valor: 0, saldo: 1 }, { valor: 1, saldo: 0 }]
  if (k === 3) return [{ credito: 0, debito: 1, saldo: 2 }, { debito: 0, credito: 1, saldo: 2 }, { valor: 1, saldo: 2 }, { valor: 0, saldo: 2 }]
  if (k >= 4) return [{ credito: k - 3, debito: k - 2, saldo: k - 1 }, { debito: k - 3, credito: k - 2, saldo: k - 1 }, { valor: k - 2, saldo: k - 1 }]
  return []
}

/** Los últimos 4 dígitos de la cuenta, si el extracto los nombra. */
function ultimos4De(lineas: string[]): string | null {
  for (const [i, l] of lineas.entries()) {
    const m = /(?:cuenta|producto)[^\d*]{0,40}[*xX\d -]*?(\d{4})(?!\d)/i.exec(l)
    if (m) return m[1]
    // el número puede venir solo, unos renglones debajo del título "Número de cuenta"
    if (/cuenta|producto/i.test(l)) {
      const abajo = lineas.slice(i + 1, i + 5).map(x => /^[*xX\d -]*?(\d{4})$/.exec(x.trim())).find(Boolean)
      if (abajo) return abajo[1]
    }
  }
  return null
}

// Fila con el signo aparte y sin saldo (Davivienda): "15 10 $ 1,234.56 - 1234 Compra NOVAVENTA"
const CON_SIGNO = /^(\d{1,2}) (\d{1,2}) \$\s?([\d.,]+) ([+-]) \d+\s*(.*)$/

// el monto que sigue a un título del resumen, en su mismo renglón o en el siguiente
function montoDe(lineas: string[], titulo: RegExp): number | null {
  const i = lineas.findIndex(l => titulo.test(l.trim()))
  if (i < 0) return null
  const monto = (lineas[i].trim().replace(titulo, '') || lineas[i + 1] || '').match(MONTO)
  return monto ? leerCentavos(monto[0]) : null
}

/**
 * Extractos que no traen el saldo en cada fila: el saldo se arma desde el saldo anterior del resumen
 * y tiene que llegar al nuevo saldo; si no llega, no se carga nada. null si el extracto no tiene esa forma.
 */
function leerConSigno(lineas: string[]): Lectura | null {
  const ano = anoDe(lineas)
  const crudas = lineas.map(l => CON_SIGNO.exec(l.trim())).filter(m => m !== null)
  if (crudas.length < 3) return null
  const inicial = montoDe(lineas, /^saldo anterior\s*/i)
  const final = montoDe(lineas, /^nuevo saldo\s*/i)
  const ejemplo = { descripcion: crudas[0][5], montos: [leerCentavos(crudas[0][3])] }
  if (inicial === null || final === null) return { ok: false, motivo: 'columnas', ejemplo }
  let saldo = inicial
  const movimientos: MovimientoBanco[] = []
  for (const [, dia, mes, monto, signo, descripcion] of crudas) {
    const valor = (signo === '-' ? -1 : 1) * leerCentavos(monto)
    saldo += valor
    const fecha = `${ano}-${dos(mes)}-${dos(dia)}`
    movimientos.push({ fecha, descripcion: descripcion.trim(), valor, saldo, huella: `${fecha}|${valor}|${saldo}` })
  }
  if (saldo !== final) return { ok: false, motivo: 'columnas', ejemplo }
  const fechas = movimientos.map(m => m.fecha).sort()
  return {
    ok: true,
    extracto: { ultimos4: ultimos4De(lineas), desde: fechas[0], hasta: fechas[fechas.length - 1], saldoInicial: inicial, saldoFinal: final, movimientos },
  }
}

/**
 * Lee las líneas de texto de un extracto y devuelve sus movimientos.
 * Reconoce las filas por su forma (fecha, texto, montos) y elige las columnas que hacen que el saldo de cada fila siga del anterior.
 */
export function leerExtracto(lineas: string[], formato?: Formato): Lectura {
  const conSigno = leerConSigno(lineas)
  if (conSigno) return conSigno
  const antes: number[] = []
  const todas = filas(lineas, antes).filter(f => f.montos.length)
  const k = moda(todas.map(f => f.montos.length))
  // las filas con menos montos de los normales (encabezados, totales) no son movimientos
  const base = todas.filter(f => f.montos.length >= k)
  if (k < 2 || base.length === 0) {
    return base.length && k === 1
      ? { ok: false, motivo: 'columnas', ejemplo: { descripcion: base[0].textos.join(' '), montos: base[0].montos } }
      : { ok: false, motivo: 'sin_movimientos' }
  }
  let mejor: (ReturnType<typeof armar> & { formato: Formato }) | null = null
  for (const orden of [base, [...base].reverse()]) {
    for (const f of formato ? [formato] : candidatos(k)) {
      const r = armar(orden, f, antes)
      if (!mejor || r.saltos < mejor.saltos) mejor = { ...r, formato: f }
    }
  }
  // shortcut: hasta 1 de cada 10 filas puede no seguir el saldo (lectura dudosa de una imagen); con más, las columnas no son esas
  if (!mejor || mejor.saltos > Math.max(1, base.length / 10)) {
    return { ok: false, motivo: 'columnas', ejemplo: { descripcion: base[0].textos.join(' '), montos: base[0].montos.slice(0, k) } }
  }
  const { movimientos, saldoInicial } = mejor
  const fechas = movimientos.map(m => m.fecha).sort()
  return {
    ok: true,
    formato: mejor.formato,
    extracto: {
      ultimos4: ultimos4De(lineas), desde: fechas[0], hasta: fechas[fechas.length - 1],
      saldoInicial, saldoFinal: movimientos[movimientos.length - 1].saldo, movimientos,
    },
  }
}

/**
 * Deja las líneas leídas de una imagen como las de un PDF con texto:
 * quita las rayas de la tabla y la basura que queda antes de la fecha de cada fila.
 */
export function limpiarOcr(lineas: string[]): string[] {
  return lineas.map(l => {
    const limpia = l.replace(/[|[\]{}_—]+/g, ' ').replace(/\s+/g, ' ').trim()
    const fila = /^.{0,5}?(?<![\d/])(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)(?=\s)(.*)$/.exec(limpia)
    // search y no test: MONTO es global y test recordaría dónde quedó
    return fila && fila[2].search(MONTO) >= 0 ? fila[1] + fila[2] : limpia
  })
}

// Lo que ya está en la app, con el mismo signo que el banco.
export interface Anotado { id_registro: string; fecha: string; valor: number; id_cuenta: string | null; nota: string | null }

export interface Cuadre {
  cuadran: { banco: MovimientoBanco; app: Anotado }[]
  montoDistinto: { banco: MovimientoBanco; app: Anotado }[]
  faltan: MovimientoBanco[]
  /** anotados en esta cuenta que el banco no trae */
  soloApp: Anotado[]
  /** anotados sin cuenta en esas fechas que el banco no trae: no cuentan en el cuadre */
  sinCuenta: Anotado[]
}

// lo anotado va en pesos enteros; el banco trae centavos
export const enPesos = (centavos: number) => Math.round(centavos / 100) * 100
const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
const palabras = (texto: string | null) => new Set(normalizar(texto ?? '').split(/[^a-z0-9]+/).filter(p => p.length >= 4))

/** Lo que la persona decidió a mano: parejas que unió (huella → registro) y parejas que dijo que son distintas ("huella|registro"). */
export interface Manual { unidos: Map<string, string>; separados: Set<string> }

/** Si el monto anotado se parece al del banco: hasta 1 % de diferencia, mismo signo. */
const parecido = (anotado: number, banco: number) => Math.sign(anotado) === Math.sign(banco) && Math.abs(anotado - banco) <= Math.abs(banco) / 100

/** Los movimientos del banco que pueden ser este anotado (mismo signo), por fecha: los de 15 días o menos aparte, para verlos primero. */
export function posibles(a: Anotado, faltan: MovimientoBanco[]): { cerca: MovimientoBanco[]; otros: MovimientoBanco[] } {
  const suyos = faltan.filter(m => Math.sign(m.valor) === Math.sign(a.valor)).sort((x, y) => x.fecha.localeCompare(y.fecha))
  return { cerca: suyos.filter(m => dias(a.fecha, m.fecha) <= 15), otros: suyos.filter(m => dias(a.fecha, m.fecha) > 15) }
}

// El banco del extracto por su nombre en el texto ("BFCO" en el archivo no cuenta: se lee el contenido).
export function bancoDe(lineas: string[]): string | null {
  const texto = normalizar(lineas.slice(0, 60).join(' '))
  if (texto.includes('falabella')) return 'Banco Falabella'
  if (texto.includes('davivienda') || texto.includes('daviplata')) return 'Davivienda'
  if (texto.includes('nequi')) return 'Nequi'
  if (texto.includes('bancolombia')) return 'Bancolombia'
  return null
}

// Un extracto de tarjeta de crédito: se avisa en vez de decir que no hay movimientos.
export const pareceTarjeta = (lineas: string[]) => /tarjeta de credito|pago minimo|cupo (total|disponible)/.test(normalizar(lineas.join(' ')))

/**
 * La pareja más probable de cada anotado sin pareja: mismo sentido, a 15 días o menos y monto a no más de un 25 %.
 * Se reparten de la mejor a la peor, así dos anotados nunca se quedan con el mismo del banco.
 */
export function sugeridas(anotados: Anotado[], faltan: MovimientoBanco[]): Map<string, MovimientoBanco> {
  const candidatas = anotados.flatMap(a => faltan
    .filter(m => Math.sign(m.valor) === Math.sign(a.valor) && dias(a.fecha, m.fecha) <= 15 && Math.abs(m.valor - a.valor) <= Math.abs(a.valor) * 0.25)
    .map(m => ({ a, m, puntaje: Math.abs(m.valor - a.valor) / Math.abs(a.valor) + dias(a.fecha, m.fecha) / 100 })))
    .sort((x, y) => x.puntaje - y.puntaje)
  const elegidas = new Map<string, MovimientoBanco>()
  const usados = new Set<string>()
  for (const { a, m } of candidatas) {
    if (elegidas.has(a.id_registro) || usados.has(m.huella)) continue
    elegidas.set(a.id_registro, m); usados.add(m.huella)
  }
  return elegidas
}

/** Lo que falta, agrupado por a dónde va; primero lo que no tiene categoría o trae un monto dudoso. */
export function porDestino<T extends MovimientoBanco>(faltan: T[], destino: (m: T) => string): { destino: string; movimientos: T[] }[] {
  const grupos = new Map<string, T[]>()
  for (const m of faltan) grupos.set(destino(m), [...(grupos.get(destino(m)) ?? []), m])
  const revisar = (d: string, ms: T[]) => (d.length === 2 || ms.some(m => m.dudoso) ? 0 : 1)
  return [...grupos].map(([d, movimientos]) => ({ destino: d, movimientos }))
    .sort((x, y) => revisar(x.destino, x.movimientos) - revisar(y.destino, y.movimientos) || y.movimientos.length - x.movimientos.length)
}

/**
 * Empareja uno a uno lo del banco con lo anotado: mismo valor y hasta 3 días de diferencia.
 * `cargados` son las huellas que ya se guardaron de un extracto, con su registro.
 */
export function conciliar(extracto: ExtractoLeido, anotados: Anotado[], idCuenta: string | null, cargados = new Map<string, string>(), manual: Manual = { unidos: new Map(), separados: new Set() }): Cuadre {
  const libres = new Map(anotados.filter(a => a.id_cuenta === null || a.id_cuenta === idCuenta).map(a => [a.id_registro, a]))
  const cuadre: Cuadre = { cuadran: [], montoDistinto: [], faltan: [], soloApp: [], sinCuenta: [] }
  const tomar = (banco: MovimientoBanco, sirve: (a: Anotado) => boolean) => {
    const app = [...libres.values()].filter(sirve).sort((a, b) => dias(a.fecha, banco.fecha) - dias(b.fecha, banco.fecha))[0]
    if (app) libres.delete(app.id_registro)
    return app
  }
  let pendientes = extracto.movimientos.filter(banco => {
    const app = libres.get(cargados.get(banco.huella) ?? '')
    if (app) { libres.delete(app.id_registro); cuadre.cuadran.push({ banco, app }) }
    return !app
  })
  // las que unió la persona: si el monto es igual cuadran, si no, se pregunta cuál queda
  pendientes = pendientes.filter(banco => {
    const app = libres.get(manual.unidos.get(banco.huella) ?? '')
    if (!app) return true
    libres.delete(app.id_registro)
    if (app.valor === enPesos(banco.valor)) cuadre.cuadran.push({ banco, app })
    else cuadre.montoDistinto.push({ banco, app })
    return false
  })
  pendientes = pendientes.filter(banco => {
    const app = tomar(banco, a => !manual.separados.has(`${banco.huella}|${a.id_registro}`) && a.valor === enPesos(banco.valor) && dias(a.fecha, banco.fecha) <= 3)
    if (app) cuadre.cuadran.push({ banco, app })
    return !app
  })
  for (const banco of pendientes) {
    const suyas = palabras(banco.descripcion)
    const pesos = enPesos(banco.valor)
    // parejas probables, que la persona confirma: monto parecido a 3 días, el mismo ingreso a 15 días (los gastos iguales se repiten)
    // o palabras en común el mismo día
    const app = tomar(banco, a => !manual.separados.has(`${banco.huella}|${a.id_registro}`) && Math.sign(a.valor) === Math.sign(banco.valor) && (
      (parecido(a.valor, pesos) && dias(a.fecha, banco.fecha) <= 3)
      || (pesos > 0 && a.valor === pesos && dias(a.fecha, banco.fecha) <= 15)
      || (dias(a.fecha, banco.fecha) <= 1 && [...palabras(a.nota)].some(p => suyas.has(p)))))
    if (app) cuadre.montoDistinto.push({ banco, app })
    else cuadre.faltan.push(banco)
  }
  for (const a of libres.values()) {
    if (a.fecha < extracto.desde || a.fecha > extracto.hasta) continue
    if (a.id_cuenta === idCuenta && idCuenta !== null) cuadre.soloApp.push(a)
    else cuadre.sinCuenta.push(a)
  }
  return cuadre
}

/** Cuánto falta para que la app diga lo mismo que el banco; 0 es que cuadra. */
export const diferencia = (c: Cuadre) =>
  c.faltan.reduce((t, m) => t + m.valor, 0) + c.montoDistinto.reduce((t, p) => t + p.banco.valor - p.app.valor, 0) - c.soloApp.reduce((t, a) => t + a.valor, 0)

// Palabras del banco que no dicen en qué se gastó.
const RUIDO = new Set(['compra', 'compras', 'nal', 'nacional', 'internacional', 'intl', 'boton', 'pse', 'pago', 'pagos', 'transf', 'transferencia', 'transferencias',
  'transferen', 'abono', 'debito', 'credito', 'a', 'de', 'del', 'desde', 'en', 'la', 'el', 'por', 'cta', 'cuenta', 'ahorros', 'ahorro', 'corriente', 'suc', 'sucursal', 'virtual'])

/** Lo que escribe el banco sin su ruido ni sus números: "COMPRA NAL.UBER 123" queda en "uber". */
export function comercio(descripcion: string): string {
  return normalizar(descripcion).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter(p => p && !/\d/.test(p) && !RUIDO.has(p)).join(' ')
}

/**
 * La categoría (o fuente) para un movimiento del banco: lo aprendido y las palabras clave, con el texto tal cual y limpio;
 * si no, la categoría donde más veces se anotó ese comercio. `historia` trae las notas ya pasadas por `comercio`.
 */
export function categoriaDeBanco(
  descripcion: string, aprendido: Map<string, string>, categorias: Categoria[], historia: { texto: string; id_etiqueta: string }[],
): Categoria | null {
  const limpio = comercio(descripcion)
  const directa = categoriaDe(descripcion, aprendido, categorias) ?? (limpio ? categoriaDe(limpio, aprendido, categorias) : null)
  if (directa || !limpio) return directa
  // el nombre de la categoría dentro del texto: "mercado central" va a Mercado
  const porNombre = categorias.find(c => ` ${limpio} `.includes(` ${normalizar(c.nombre)} `))
  if (porNombre) return porNombre
  const suyas = limpio.split(' ').filter(p => p.length >= 4)
  const votos = new Map<string, number>()
  for (const h of historia) {
    if (suyas.some(p => ` ${h.texto} `.includes(` ${p} `))) votos.set(h.id_etiqueta, (votos.get(h.id_etiqueta) ?? 0) + 1)
  }
  const elegibles = [...votos].filter(([id]) => categorias.some(c => c.id_etiqueta === id)).sort((a, b) => b[1] - a[1])
  const total = elegibles.reduce((s, [, n]) => s + n, 0)
  // solo si se anotó al menos dos veces y casi siempre en la misma: una coincidencia suelta no alcanza
  return elegibles.length && elegibles[0][1] >= 2 && elegibles[0][1] >= total * 0.6 ? categorias.find(c => c.id_etiqueta === elegibles[0][0])! : null
}

/** El saldo de hoy de una cuenta: el del último extracto más lo anotado después de su fecha. Montos con signo. */
export function saldoEstimado(saldoFinal: number, hasta: string, anotados: { fecha: string; valor: number }[]) {
  const despues = anotados.filter(a => a.fecha > hasta)
  return { saldo: saldoFinal + despues.reduce((t, a) => t + a.valor, 0), cuantos: despues.length }
}
