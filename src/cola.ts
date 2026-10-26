// Registros hechos sin conexión. Viven en IndexedDB hasta que se envían y se borran al cerrar sesión.
const BASE = 'seguiapp'
const ALMACEN = 'cola'

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(BASE, 1)
    peticion.onupgradeneeded = () => peticion.result.createObjectStore(ALMACEN, { keyPath: 'id_registro' })
    peticion.onsuccess = () => resolver(peticion.result)
    peticion.onerror = () => rechazar(peticion.error)
  })
}

async function usar<T>(modo: IDBTransactionMode, accion: (almacen: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const base = await abrir()
  return new Promise((resolver, rechazar) => {
    const peticion = accion(base.transaction(ALMACEN, modo).objectStore(ALMACEN))
    peticion.onsuccess = () => resolver(peticion.result)
    peticion.onerror = () => rechazar(peticion.error)
  })
}

export const encolar = <T extends { id_registro: string }>(registro: T) => usar('readwrite', a => a.put(registro))
export const pendientes = <T>() => usar<T[]>('readonly', a => a.getAll() as IDBRequest<T[]>)
export const quitar = (id: string) => usar('readwrite', a => a.delete(id))
export const vaciar = () => usar('readwrite', a => a.clear())
