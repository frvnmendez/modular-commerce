/**
 * Envío de emails (Hito 2). Con SMTP_URL se envían de verdad por SMTP (sirve cualquier proveedor: el correo del
 * hosting, Brevo, Amazon SES, Gmail…). Sin él, solo se escriben en el registro, como en el Hito 1.
 *
 * Un fallo al enviar nunca rompe la operación que lo provoca (un pago confirmado sigue confirmado): se registra.
 */
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export type Mail = {
  kind: 'verify-email' | 'reset-password' | 'order-confirmation' | 'new-order' | 'order-shipped';
  to: string;
  subject: string;
  url: string;
  /** Detalle en texto (líneas del pedido…). */
  text?: string;
  /** Nombre con el que firma el email (la tienda o la plataforma). */
  fromName?: string;
};

const INTRO: Record<Mail['kind'], { lead: string; button: string }> = {
  'verify-email': { lead: 'Confirma tu email para activar tu cuenta.', button: 'Verificar mi email' },
  'reset-password': { lead: 'Has pedido cambiar tu contraseña. Si no fuiste tú, ignora este email.', button: 'Elegir nueva contraseña' },
  'order-confirmation': { lead: '¡Gracias por tu compra! Hemos recibido el pago de tu pedido.', button: 'Ver mi pedido' },
  'new-order': { lead: 'Tienes un pedido nuevo pagado. Prepáralo y márcalo como enviado cuando salga.', button: 'Abrir el pedido' },
  'order-shipped': { lead: 'Tu pedido ya está en camino.', button: 'Ver mi pedido' },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Cuerpo del email en texto y HTML sencillo (se ve bien en cualquier cliente de correo). */
export function renderMail(m: Mail) {
  const intro = INTRO[m.kind];
  const text = [intro.lead, m.text ?? '', `${intro.button}: ${m.url}`].filter(Boolean).join('\n\n');
  const detail = m.text ? `<pre style="font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;white-space:pre-wrap;margin:16px 0;color:#333">${esc(m.text)}</pre>` : '';
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f4f5;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">
<p style="margin:0 0 4px;font-weight:600">${esc(m.fromName ?? 'modular')}</p>
<h1 style="font-size:20px;margin:0 0 12px">${esc(m.subject)}</h1>
<p style="margin:0">${esc(intro.lead)}</p>${detail}
<p style="margin:24px 0"><a href="${esc(m.url)}" style="display:inline-block;background:#4338ca;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">${esc(intro.button)}</a></p>
<p style="margin:0;font-size:12px;color:#71717a">Si el botón no funciona, copia este enlace en el navegador:<br>${esc(m.url)}</p>
</div></body></html>`;
  return { text, html };
}

export type MailerOptions = {
  smtpUrl?: string;
  /** Remitente, p. ej. «Tu Plataforma <no-responder@tuplataforma.com>». Obligatorio con SMTP. */
  from?: string;
  log: (m: Mail) => void;
  onError: (err: unknown, m: Mail) => void;
  /** Para pruebas: un transporte de nodemailer ya creado. */
  transport?: Transporter;
};

export function createMailer(opts: MailerOptions) {
  const transport = opts.transport ?? (opts.smtpUrl ? nodemailer.createTransport(opts.smtpUrl) : null);
  if (transport && !opts.from) throw new Error('MAIL_FROM es obligatorio cuando hay SMTP_URL');
  const fromAddress = opts.from ? /<([^>]+)>/.exec(opts.from)?.[1] ?? opts.from : '';
  return {
    enabled: transport !== null,
    async send(m: Mail) {
      opts.log(m);
      if (!transport) return;
      const { text, html } = renderMail(m);
      // Los emails de una tienda salen con el nombre de la tienda, pero siempre desde la dirección de la plataforma.
      const from = m.fromName ? { name: m.fromName.replace(/[\r\n"<>]/g, ' ').slice(0, 80), address: fromAddress } : opts.from!;
      try {
        await transport.sendMail({ from, to: m.to, subject: m.subject, text, html });
      } catch (err) {
        opts.onError(err, m);
      }
    },
  };
}
