# Montar la plataforma en un VPS (Hito 1)

Guía para poner la plataforma en un servidor propio y abrir la primera tienda de prueba. **No hay nada contratado ni desplegado**: esto es lo que habrá que hacer cuando el propietario dé el OK al servidor.

## Qué hace falta

| Pieza | Para qué | Notas |
|---|---|---|
| Un VPS Linux (Ubuntu 24.04), 2 vCPU, 4 GB de RAM, 40 GB de disco | Ejecutar la base de datos, la API y el panel | Un hosting compartido no sirve: hacen falta Node 22 y PostgreSQL 16+ funcionando todo el tiempo |
| Un dominio (p. ej. `tuplataforma.com`) apuntando a la IP del VPS | La dirección pública | Registro `A` de `@` (y `www` si se quiere) a la IP del servidor |
| Cuenta de Stripe en **modo prueba** | Cobrar con tarjetas de prueba | Claves `sk_test_…`. Las claves reales (`sk_live_…`) no arrancan sin `ALLOW_LIVE_PAYMENTS=1`, que solo se activa con el OK del propietario |

Las tiendas quedan en `https://tuplataforma.com/tienda/<nombre-de-la-tienda>`. Los subdominios por tienda (`<tienda>.tuplataforma.com`) llegan en el Hito 2.

## Cómo queda montado

```
Internet ──► Caddy (HTTPS, puerto 443)
               ├── /webhooks/stripe ──► API (127.0.0.1:4000)
               └── todo lo demás ─────► panel + tiendas (127.0.0.1:3000) ──► API (127.0.0.1:4000)
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
UPLOAD_DIR=/srv/mc/uploads
```

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
tuplataforma.com {
  encode gzip
  request_body /webhooks/stripe {
    max_size 1MB
  }
  handle /webhooks/stripe {
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

Caddy pide y renueva el certificado HTTPS solo.

### 8. Stripe (modo prueba)

1. En el panel de Stripe, con «Modo de prueba» activado, copia la clave secreta `sk_test_…`.
2. En *Desarrolladores → Webhooks*, añade el endpoint `https://tuplataforma.com/webhooks/stripe` con los eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded` y `checkout.session.expired`. Copia su secreto `whsec_…`.
3. Pon las dos claves en `.env` y reinicia la API: `sudo systemctl restart mc-api`.
4. Para comprar usa la tarjeta de prueba `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC.

### 9. Primera tienda

1. Entra en `https://tuplataforma.com`, regístrate y verifica el email.
   **En el Hito 1 todavía no se envían emails reales**: el enlace de verificación aparece en el registro de la API. Para verlo: `sudo journalctl -u mc-api | grep verify-email | tail -1`. Los emails reales llegan en el Hito 2.
2. Crea la tienda, añade productos con fotos y, en *Ajustes → Venta online*, marca «Tienda publicada», la tarifa de envío y el email de avisos.
3. Abre `https://tuplataforma.com/tienda/<tu-tienda>`, compra con la tarjeta de prueba y comprueba el pedido en *Pedidos*.

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

- **Probado en local y en CI:** todo el recorrido (crear tienda, producto con foto, publicar, comprar, pago simulado, pedido en el panel, marcar como enviado), el pago con Stripe contra un Stripe simulado (firma de los avisos, importes, pagos tardíos, reembolsos) y el aislamiento entre tiendas.
- **Pendiente del servidor real:** la configuración de Caddy, systemd y las copias no se ha ejecutado en ningún servidor; el pago con Stripe en modo prueba no se ha hecho contra Stripe de verdad (falta la cuenta); no hay envío real de emails.
