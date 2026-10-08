# Instalación paso a paso

Todo es gratis. Tardarás unos 30 minutos. Necesitas:

- **GitHub** (ya lo tienes): guarda el código y ejecuta el robot cada 3 horas.
- **Supabase**: la base de datos con tu cuenta, tus búsquedas y el historial de precios.
- **Cloudflare Pages**: aloja la web para que la abras desde el móvil o el PC.
- **Telegram**: te llegan los avisos.

> 🔐 **Regla de oro:** hay dos claves de Supabase. La **publishable** (`sb_publishable_...`) es pública y va en la web.
> La **secret** (`sb_secret_...`) es secreta: solo se pega en los *secretos* de GitHub, nunca en el código ni en un chat.
> (Las antiguas *anon* y *service_role* también funcionan, pero Supabase las retira a finales de 2026.)

---

## 1. Base de datos (Supabase)

1. Entra en <https://supabase.com> → **Start your project** → regístrate con tu cuenta de GitHub.
2. **New project**:
   - Name: `buscador-vuelos`
   - Database password: genera una y guárdala (no la necesitarás a diario).
   - Region: **West EU (Paris)** o **Central EU (Frankfurt)**.
3. Cuando termine de crearse, ve a **SQL Editor** → **New query**.
4. Abre el archivo [`supabase/instalar.sql`](../supabase/instalar.sql) de este repositorio. Copia **todo** su contenido, pégalo y pulsa **Run**.
   Debe terminar con *Success*. Se puede volver a ejecutar sin problema; por ejemplo, tras una actualización.
5. Apunta estos tres datos:
   - **Project URL** (en **Project Settings → Data API**): algo como `https://abcdxyz.supabase.co`.
   - **Publishable key** (en **Project Settings → API Keys**): empieza por `sb_publishable_`. Es pública y va en la web.
   - **Secret key** (misma pantalla, pulsa el ojo para verla): empieza por `sb_secret_`. Es **secreta** y solo va en GitHub.

## 2. Conectar la web con tu base de datos

Edita [`web/js/config.js`](../web/js/config.js) y pon tu *Project URL* y tu clave **publishable**:

```js
export const SUPABASE_URL = "https://abcdxyz.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_...";
```

Desde GitHub: abre el archivo → icono del lápiz → cambia las dos líneas → **Commit changes**.
Si lo prefieres, pásame la URL y la clave **publishable** (la pública, nunca la secret) y lo hago yo.

## 3. Publicar la web (Cloudflare Pages)

1. Entra en <https://dash.cloudflare.com> y crea una cuenta gratuita.
2. **Workers y Pages** → **Crear** → pestaña **Pages** → **Conectar a Git**.
3. Autoriza GitHub. Puedes dar acceso **solo** al repositorio `BuscadorDeVuelos`.
4. Configuración de compilación:
   - Framework preset: **None**
   - Build command: *(vacío)*
   - Build output directory: **`web`**
5. **Guardar e implementar**. Te dará una dirección del tipo `https://buscadordevuelos.pages.dev`.
   Cada vez que cambie algo en GitHub, la web se actualiza sola.
6. Vuelve a Supabase → **Authentication → URL Configuration**:
   - **Site URL**: tu dirección de Cloudflare, p. ej. `https://buscadordevuelos.pages.dev`.
   - **Redirect URLs**: añade la misma dirección.

## 4. Crear tu cuenta

Abre tu web → **Crear cuenta** → confirma el correo que te llega → rellena el perfil (familia numerosa, residente).
Solo se puede crear **una** cuenta: después el registro se cierra solo.

## 5. Bot de Telegram

1. En Telegram, abre **@BotFather** (tiene el check azul) y envíale `/newbot`.
2. Elige un nombre (p. ej. *Mis Vuelos*) y un usuario que acabe en `bot` (p. ej. `mis_vuelos_2026_bot`).
3. BotFather te da un **token** (`123456789:AA...`). Es secreto: guárdalo en GitHub (paso 6), no lo compartas.
4. Abre el chat con tu bot nuevo (el enlace `t.me/...` que te da BotFather) y pulsa **Iniciar**.
5. En tu web, ve a **Perfil → Avisos por Telegram** y envía a tu bot el mensaje que aparece (`/start CÓDIGO`).
   El robot lo vinculará en su siguiente ronda y te contestará "✅ ¡Listo!".

## 6. Secretos del robot (GitHub)

En tu repositorio de GitHub ve a **Settings → Secrets and variables → Actions**.

En la pestaña **Secrets**, pulsa **New repository secret** tres veces:

| Nombre | Valor |
|---|---|
| `SUPABASE_URL` | La *Project URL* de Supabase |
| `SUPABASE_SERVICE_KEY` | La **Secret key** (`sb_secret_...`) |
| `TELEGRAM_BOT_TOKEN` | El token de BotFather |

En la pestaña **Variables**, pulsa **New repository variable**:

| Nombre | Valor |
|---|---|
| `URL_WEB` | La dirección de tu web, p. ej. `https://buscadordevuelos.pages.dev` |

> Esta variable es el **interruptor** del robot: mientras no exista, el robot no se ejecuta
> (así no gasta minutos ni te llegan correos de error antes de terminar la instalación).

Primera ronda de prueba:

1. Ve a **Actions**. Si te lo pide, pulsa **I understand… enable them**.
2. Elige **Robot de vuelos** → **Run workflow**.
3. Marca **forzar** y pulsa **Run workflow**.

A partir de ahí el robot se ejecuta solo cada 3 horas.

## 7. Comprobar que todo va bien

- En tu web, la pantalla **Robot** muestra la ronda y el estado de cada web consultada.
- En Telegram te ha llegado "✅ ¡Listo!", si enviaste el código.
- Crea una búsqueda: en la siguiente ronda (máximo 3 h) verás precios y, si toca, un aviso.

---

## Mantenimiento

- **Minutos de GitHub**: un repositorio privado tiene 2.000 minutos gratis al mes. Cada ronda gasta unos 2-6 minutos,
  y la pantalla **Robot** muestra el consumo. No son horas de web activa: la web no gasta minutos, solo el robot mientras busca.
  Si te acercas al límite, crea menos búsquedas simultáneas o pausa las lejanas.
- **Supabase en pausa**: el plan gratuito pausa los proyectos sin actividad durante 7 días. El robot la usa cada 3 horas,
  así que no debería pasar; si pasara, entra en supabase.com y pulsa **Restore**.
- **Si Google Flights deja de funcionar**: la librería `flights` (fli) se actualiza cuando Google cambia algo.
  Sube su versión en `worker/requirements.txt`.
- **Aerolíneas**: revisa y ajusta los precios de maletas en la pantalla **Aerolíneas** si al comprar ves que son otros.
- **Skyscanner**: está desactivada porque bloquea a los robots. Puedes activarla en **Robot** para reintentar; si bloquea,
  el robot la deja descansar sola.

## Probar el robot en tu PC (opcional)

```bash
python -m venv .venv
.venv\Scripts\pip install -r worker/requirements.txt
cd worker
..\.venv\Scripts\python -m buscador.cli SVQ ORY --ida 2026-11-15 --vuelta 2026-11-19 --adultos 2 --facturada 1
```

No necesita base de datos: imprime las mejores opciones, la decisión y cómo sería el mensaje de Telegram.
Ejecuta `python -m buscador.cli --help` para ver todas las opciones (chollo, franjas horarias, presupuesto, familia numerosa…).
