// Política de tratamiento de datos (Ley 1581 de 2012, Colombia).
export default function Privacidad({ alVolver }: { alVolver: () => void }) {
  return (
    <article className="contenedor politica">
      <button className="volver" onClick={alVolver}>← Volver</button>
      <h1>Privacidad</h1>
      <p className="tenue">Política de tratamiento de datos personales · vigente desde el 25 de octubre de 2026 · actualizada el 28 de octubre de 2026</p>

      <h2>Quién es el responsable</h2>
      <p>Francisco García, creador de seguiapp, es el responsable del tratamiento de tus datos.</p>

      <h2>Qué datos se guardan</h2>
      <ul>
        <li>Tu nombre y tu correo, tal como los entrega Google al entrar. No se pide nada más de tu cuenta de Google.</li>
        <li>Lo que tú registras: tus seguimientos, sus metas, los valores que anotas y tus notas.</li>
        <li>Los mensajes que envías desde «Contacto» y sus respuestas.</li>
      </ul>
      <p>No hay analítica, rastreadores, publicidad ni scripts de terceros.</p>

      <h2>Para qué se usan</h2>
      <p>Solo para mostrarte tu seguimiento, sus gráficos y los avisos en tu celular o computador que tú elijas, sin montos en el texto. No se venden, no se comparten y no se usan para nada más.</p>

      <h2>Dónde se guardan</h2>
      <ul>
        <li>La base de datos está en Supabase, con servidores en São Paulo (Brasil).</li>
        <li>La web se publica en Cloudflare y el inicio de sesión lo hace Google.</li>
        <li>Tu sesión queda en tu navegador para que no tengas que entrar cada vez. Al tocar «Salir» se borra de ese equipo.</li>
      </ul>

      <h2>Quién puede verlos</h2>
      <p>Solo tú: la base de datos no le muestra a nadie los datos de otra persona. Como administrador, Francisco García tiene acceso técnico a la base y se compromete a no consultar tus datos, salvo que tú se lo pidas para ayudarte. Los mensajes que envías desde «Contacto» los lee él para responderte.</p>

      <h2>Tus derechos</h2>
      <p>Puedes conocer, actualizar, corregir y borrar tus datos, pedir prueba de tu autorización, revocarla y presentar quejas ante la Superintendencia de Industria y Comercio.</p>

      <h2>Cómo ejercerlos</h2>
      <p>En la pantalla «Mis datos» (al pie de la app) puedes descargar tus datos en CSV, escribirle a Francisco García desde «Contacto» y borrar tu cuenta. Las consultas se responden en máximo 10 días hábiles y los reclamos en máximo 15.</p>

      <h2>Cuánto tiempo se guardan</h2>
      <p>Mientras tengas tu cuenta. Si la borras desde «Mis datos», se eliminan al instante todos tus datos y tu acceso. Si el administrador te quita el acceso, también se borran al instante tu cuenta y todos tus datos; puedes descargarlos cuando quieras en «Mis datos».</p>

      <h2>Cambios</h2>
      <p>Si esta política cambia, se avisará en la app antes de aplicar el cambio.</p>
    </article>
  )
}
