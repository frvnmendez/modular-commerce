# Montar la plataforma en un VPS (Hitos 1 y 2)

Guía para poner la plataforma en un servidor propio, abrir la primera tienda y después dejar que otros comerciantes creen la suya. **No hay nada contratado ni desplegado**: esto es lo que habrá que hacer cuando el propietario dé el OK al servidor.

## Qué hace falta

| Pieza | Para qué | Notas |
|---|---|---|
| Un VPS Linux (Ubuntu 24.04), 2 vCPU, 4 GB de RAM, 40 GB de disco | Ejecutar la base de datos, la API y el panel | Un hosting compartido no sirve: hacen falta Node 22 y PostgreSQL 16+ funcionando todo el tiempo |
| Un dominio (p. ej. `tuplataforma.com`) apuntando a la IP del VPS | La dirección pública | Registros `A` de `@` **y de `*`** (comodín) a la IP del servidor: cada tienda vive en `<tienda>.tuplataforma.com` |
| Cuenta de Stripe en **modo prueba**, con Connect activado | Que cada comerciante cobre en su propia cuenta | Claves `sk_test_…`. Las claves reales (`sk_live_…`) no arrancan sin `ALLOW_LIVE_PAYMENTS=1`, que solo se activa con el OK del propietario |
| Un servicio de email con SMTP | Verificación de cuentas y avisos de pedidos | Vale el correo del propio hosting, Brevo, Amazon SES… Hace falta configurar SPF y DKIM del dominio para no acabar en spam |

Sin `PLATFORM_DOMAIN`, las tiendas quedan en `https://tuplataforma.com/tienda/<tienda>` (modo Hito 1). Sin `STRIPE_CONNECT=1`, todos los cobros van a la cuenta de la plataforma (solo sirve para la tienda propia). Sin `SMTP_URL`, los emails solo aparecen en el registro.

## Cómo queda montado

```
Internet ──► Caddy (HTTPS, puerto 443; certificado propio para cada tienda, bajo demanda)
               ├── /webhooks/stripe*  ──► API (127.0.0.1:4000)
               └── todo lo demás ─────► panel + tiendas (127.0.0.1:3000) ──► API (127.0.0.1:4000)
                    tuplataforma.com        → panel de los comerciantes
                    <tienda>.tuplataforma.com → escaparate de esa tienda
                                                                              └─► PostgreSQL (local)
```

Solo Caddy escucha hacia fuera. La API y el panel escuchan en `127.0.0.1`.

## Pasos

### 1. Sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y postgresql caddy git ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs
sudo corepack enable
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
sudo adduser --system --group --home /srv/mc mc
```

### 2. Código y dependencias

```bash
sudo -u mc git clone https://github.com/frvnmendez/modular-commerce.git /srv/mc/app
cd /srv/mc/app && sudo -u mc pnpm install --frozen-lockfile
```

### 3. Configuración (`/srv/mc/app/.env`, permisos 600, dueño `mc`)

Parte de `.env.example` y cambia **todas** las contraseñas por valores largos y aleatorios (`openssl rand -base64 32`):

```ini
NODE_ENV=production
DATABASE_ADMIN_URL=postgres://postgres:<contraseña-admin>@127.0.0.1:5432/postgres
DATABASE_MIGRATOR_PASSWORD=<aleatoria>
DATABASE_APP_PASSWORD=<aleatoria>
DATABASE_AUTH_PASSWORD=<aleatoria>
DATABASE_OPS_PASSWORD=<aleatoria>
DATABASE_STOREFRONT_PASSWORD=<aleatoria>
DATABASE_PAYMENTS_PASSWORD=<aleatoria>
AUTH_SECRET=<aleatoria de 32+ caracteres>
AUTH_BASE_URL=https://tuplataforma.com
ALLOWED_ORIGINS=https://tuplataforma.com
TRUST_PROXY=127.0.0.1
PANEL_TRUST_PROXY=127.0.0.1
PAYMENTS_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT=1
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
PLATFORM_FEE_BP=0
PLATFORM_DOMAIN=tuplataforma.com
SMTP_URL=smtp://usuario:contraseña@smtp.proveedor.com:587
MAIL_FROM=Tu Plataforma <no-responder@tuplataforma.com>
UPLOAD_DIR=/srv/mc/uploads
```

`PLATFORM_FEE_BP` es la comisión de la plataforma en puntos básicos (250 = 2,5 % de cada venta, que se queda la plataforma). Con 0 no se cobra comisión. **Decidir la comisión es del propietario.**

`PANEL_TRUST_PROXY=127.0.0.1` porque Caddy está en la misma máquina y añade la IP real del visitante (ver `DEPLOYMENT.md` §Cadena de confianza).

### 4. Base de datos

```bash
sudo -u postgres psql -c "ALTER USER postgres PASSWORD '<contraseña-admin>'"
cd /srv/mc/app && set -a && . ./.env && set +a
pnpm db:bootstrap && pnpm db:migrate
sudo -u mc mkdir -p /srv/mc/uploads
```

### 5. Compilar el panel

```bash
cd /srv/mc/app && sudo -u mc pnpm --filter @mc/merchant-admin build
```

### 6. Servicios (systemd)

`/etc/systemd/system/mc-api.service`:

```ini
[Unit]
Description=modular-commerce API
After=postgresql.service
[Service]
User=mc
WorkingDirectory=/srv/mc/app
EnvironmentFile=/srv/mc/app/.env
Environment=PORT=4000 HOST=127.0.0.1
ExecStart=/usr/bin/node apps/commerce-api/src/server.ts
Restart=always
[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/mc-panel.service`:

```ini
[Unit]
Description=modular-commerce panel y tiendas
After=mc-api.service
[Service]
User=mc
WorkingDirectory=/srv/mc/app/apps/merchant-admin
EnvironmentFile=/srv/mc/app/.env
Environment=PORT=3000 HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node server.mjs
Restart=always
[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now mc-api mc-panel
```

### 7. HTTPS con Caddy (`/etc/caddy/Caddyfile`)

```
{
  # Certificados bajo demanda para los subdominios de tienda: Caddy pregunta antes a la API si el nombre
  # es el dominio de la plataforma o una tienda publicada. Así nadie puede hacerle pedir certificados al azar.
  on_demand_tls {
    ask http://127.0.0.1:4000/internal/tls-check
  }
}

tuplataforma.com, *.tuplataforma.com {
  tls {
    on_demand
  }
  encode gzip
  handle /webhooks/stripe* {
    request_body {
      max_size 1MB
    }
    reverse_proxy 127.0.0.1:4000
  }
  handle {
    request_body {
      max_size 6MB
    }
    reverse_proxy 127.0.0.1:3000
  }
}
```

```bash
sudo systemctl reload caddy
```

Caddy pide y renueva los certificados HTTPS solo: el del dominio principal y uno por tienda la primera vez que alguien la visita. (Alternativa: un certificado comodín `*.tuplataforma.com`, que exige que Caddy pueda crear registros DNS en el proveedor del dominio.)

### 8. Stripe (modo prueba) y Stripe Connect

1. En el panel de Stripe, con «Modo de prueba» activado, copia la clave secreta `sk_test_…`.
2. Activa **Connect** (menú *Connect*) y completa el perfil de la plataforma. Tipo de cuenta de los comerciantes: **Express**. Cargos: **con destino** («destination charges»), que es lo que usa la plataforma.
3. En *Desarrolladores → Webhooks*, añade dos endpoints:
   - `https://tuplataforma.com/webhooks/stripe` («tu cuenta») con `checkout.session.completed`, `checkout.session.async_payment_succeeded` y `checkout.session.expired`. Su secreto va en `STRIPE_WEBHOOK_SECRET`.
   - `https://tuplataforma.com/webhooks/stripe/connect` («cuentas conectadas») con `account.updated`. Su secreto va en `STRIPE_CONNECT_WEBHOOK_SECRET`.
4. Reinicia la API: `sudo systemctl restart mc-api`.
5. Cada comerciante va a *Ajustes → Cobros → Conectar con Stripe*, rellena el alta de Stripe y vuelve al panel. Hasta que Stripe active su cuenta, su tienda se ve pero no acepta pedidos.
6. Para comprar usa la tarjeta de prueba `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC. En el alta de prueba de Stripe se pueden usar los datos de prueba que ofrece el propio formulario.

### 9. Primera tienda

1. Entra en `https://tuplataforma.com`, regístrate y verifica el email (llega por SMTP; sin `SMTP_URL`, el enlace aparece en `sudo journalctl -u mc-api | grep verify-email | tail -1`).
2. Crea la tienda, añade productos con fotos y, en *Ajustes*: marca «Tienda publicada», la tarifa de envío y el email de avisos; conecta Stripe en *Cobros*; y elige logo, color y portada en *Diseño de la tienda*.
3. Abre `https://<tu-tienda>.tuplataforma.com`, compra con la tarjeta de prueba y comprueba el pedido en *Pedidos* y los emails.

## Copias de seguridad

Hay que guardar **dos cosas**: la base de datos y la carpeta de fotos.

```bash
# /etc/cron.daily/mc-backup
#!/bin/sh
set -e
d=/srv/mc/backups/$(date +%F)
mkdir -p "$d"
sudo -u postgres pg_dump -Fc modular_commerce > "$d/db.dump"
tar -czf "$d/uploads.tgz" -C /srv/mc uploads
find /srv/mc/backups -maxdepth 1 -mtime +14 -exec rm -rf {} +
```

Una copia en el mismo servidor no protege si el servidor se pierde: conviene copiarla también fuera (el almacenamiento de copias del proveedor o un bucket). Restaurar: `pg_restore -d modular_commerce --clean db.dump` y descomprimir `uploads.tgz` en `/srv/mc`.

## Actualizar a una versión nueva

```bash
cd /srv/mc/app && sudo -u mc git pull && sudo -u mc pnpm install --frozen-lockfile
set -a && . ./.env && set +a && pnpm db:migrate
sudo -u mc pnpm --filter @mc/merchant-admin build
sudo systemctl restart mc-api mc-panel
```

## Qué está probado y qué no

- **Probado en local y en CI:** todo el recorrido en navegador (crear tienda, producto con foto, publicar, diseño, comprar en el subdominio de la tienda, pago simulado, emails, marcar como enviado); Stripe y Stripe Connect contra un Stripe simulado (alta Express, estado de la cuenta, cargos con destino y comisión, avisos firmados, reembolsos que recuperan la transferencia); el envío de emails con un transporte de prueba; y el aislamiento entre tiendas.
- **Pendiente del servidor real:** Caddy (incluidos los certificados bajo demanda), systemd y las copias no se han ejecutado en ningún servidor; Stripe y Connect no se han probado contra Stripe de verdad (falta la cuenta); el SMTP real no se ha probado (falta el proveedor).
