// emailAgent.js — usa Mailjet (API HTTPS, funciona en Render, soporta múltiples destinatarios)

const MAILJET_API_KEY    = process.env.MAILJET_API_KEY;
const MAILJET_SECRET_KEY = process.env.MAILJET_SECRET_KEY;
const FROM_EMAIL         = process.env.EMAIL_FROM;
const fromName           = process.env.EMAIL_FROM_NAME || 'S&P Gestión';

const MAILJET_URL = 'https://api.mailjet.com/v3.1/send';

/**
 * Envía un email a través de la API HTTP de Mailjet.
 * @param {object} opts - { to: string | string[], subject: string, html: string }
 */
async function sendViaMailjet({ to, subject, html }) {
    const toList = (Array.isArray(to) ? to : [to])
        .map(e => e.trim()).filter(Boolean)
        .map(email => ({ Email: email }));

    if (!toList.length) {
        console.warn('[MAILJET] No hay destinatarios, correo omitido.');
        return;
    }

    const credentials = Buffer.from(`${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`).toString('base64');

    const payload = {
        Messages: [{
            From: { Email: FROM_EMAIL, Name: fromName },
            To: toList,
            Subject: subject,
            HTMLPart: html,
        }]
    };

    const res = await fetch(MAILJET_URL, {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Basic ${credentials}`,
        },
        body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(`Mailjet ${res.status}: ${JSON.stringify(data)}`);
    }

    // Mailjet puede devolver 200 pero con errores por mensaje
    const messages = data?.Messages || [];
    messages.forEach((msg, i) => {
        if (msg.Status !== 'success') {
            console.error(`[MAILJET] Mensaje ${i} falló — Status: ${msg.Status}`, JSON.stringify(msg.Errors || msg));
        } else {
            console.log(`[MAILJET] Mensaje ${i} OK — MessageID: ${msg.To?.[0]?.MessageID}`);
        }
    });

    return data;
}

// ── Comprobación de configuración ────────────────────────────────────────────
if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY || !FROM_EMAIL) {
    console.warn('⚠️  MAILJET_API_KEY, MAILJET_SECRET_KEY o EMAIL_FROM no configurados. Los correos se simularán en la consola.');
}

// ── notifyNewTicket ───────────────────────────────────────────────────────────
async function notifyNewTicket(ticket) {
    if (!ticket) {
        console.error('Alerta de correo cancelada: el ticket es nulo.');
        return;
    }

    const rawTo = process.env.EMAIL_TO || '';
    const toList = rawTo.split(',').map(e => e.trim()).filter(Boolean);
    if (!toList.length) { console.warn('EMAIL_TO no configurado.'); return; }

    if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY || !FROM_EMAIL) {
        console.log(`[SIMULACIÓN EMAIL] 🚨 Ticket #${ticket.id} - ${ticket.subject} → ${toList.join(', ')}`);
        return;
    }

    const contactRow = ticket.email
        ? `<p><strong>Email de contacto:</strong> <a href="mailto:${ticket.email}" style="color:#e51148;">${ticket.email}</a></p>`
        : `<p><strong>Email de contacto:</strong> <span style="color:#999;">No proporcionado</span></p>`;

    const html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
            <div style="background:#102a47; padding:20px 24px; border-radius:8px 8px 0 0;">
                <h2 style="color:#fff; margin:0; font-size:18px;">🚨 Nuevo Ticket Registrado</h2>
            </div>
            <div style="border:1px solid #e2e8f0; border-top:none; padding:24px; border-radius:0 0 8px 8px;">
                <p><strong>ID del Ticket:</strong> #${ticket.id}</p>
                <p><strong>Fecha:</strong> ${ticket.date || '—'}</p>
                <p><strong>Asunto:</strong> ${ticket.subject}</p>
                <p><strong>Descripción:</strong> ${ticket.description}</p>
                <p><strong>Prioridad:</strong>
                    <span style="color:${ticket.priority === 'Critica' ? '#dc2626' : ticket.priority === 'Alta' ? '#d97706' : '#3b82f6'}">
                        ${ticket.priority}
                    </span>
                </p>
                ${contactRow}
                <hr style="border:none; border-top:1px solid #eee; margin:20px 0;">
                <p style="font-size:0.85em; color:#666;">Por favor, revisa el dashboard para gestionarlo lo antes posible.</p>
            </div>
        </div>`;

    try {
        await sendViaMailjet({
            to: toList,
            subject: `🚨 Nuevo Ticket #${ticket.id} - ${ticket.subject}`,
            html,
        });
        console.log(`✅ Alerta enviada a: ${toList.join(', ')}`);
    } catch (err) {
        console.error('❌ Fallo al enviar alerta:', err?.message || err);
    }
}

// ── notifyTicketConfirmation ──────────────────────────────────────────────────
async function notifyTicketConfirmation(ticket) {
    console.log(`[EMAIL CONFIRMACION] ticket.email recibido: "${ticket?.email}"`);
    if (!ticket || !ticket.email) {
        console.log('[EMAIL CONFIRMACION] Ticket sin email de usuario, se omite confirmación.');
        return;
    }

    if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY || !FROM_EMAIL) {
        console.log(`[SIMULACIÓN EMAIL CONFIRMACIÓN] ✅ Ticket #${ticket.id} confirmado a ${ticket.email}`);
        return;
    }

    const html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
            <div style="background:#102a47; padding:20px 24px; border-radius:8px 8px 0 0;">
                <h2 style="color:#fff; margin:0; font-size:18px;">✅ Tu ticket ha sido registrado</h2>
            </div>
            <div style="border:1px solid #e2e8f0; border-top:none; padding:24px; border-radius:0 0 8px 8px;">
                <p>Hola, gracias por contactarnos. Tu solicitud ha sido recibida correctamente y nuestro equipo la atenderá a la brevedad.</p>
                <hr style="border:none; border-top:1px solid #eee; margin:20px 0;">
                <p><strong>ID del Ticket:</strong> #${ticket.id}</p>
                <p><strong>Fecha:</strong> ${ticket.date || '—'}</p>
                <p><strong>Asunto:</strong> ${ticket.subject}</p>
                <p><strong>Descripción:</strong> ${ticket.description}</p>
                <p><strong>Prioridad:</strong>
                    <span style="color:${ticket.priority === 'Critica' ? '#dc2626' : ticket.priority === 'Alta' ? '#d97706' : '#3b82f6'}">
                        ${ticket.priority}
                    </span>
                </p>
                <hr style="border:none; border-top:1px solid #eee; margin:20px 0;">
                <p style="font-size:0.85em; color:#666;">Si tienes alguna duda, puedes responder a este correo o comunicarte con nosotros directamente.</p>
                <p style="font-size:0.85em; color:#666;">— Equipo de Solutions &amp; Payroll</p>
            </div>
        </div>`;

    console.log(`[EMAIL CONFIRMACION] Enviando a: ${ticket.email} desde: ${FROM_EMAIL}`);
    try {
        await sendViaMailjet({
            to: ticket.email,
            subject: `✅ Confirmación de ticket #${ticket.id} - ${ticket.subject}`,
            html,
        });
        console.log(`✅ Confirmación enviada a ${ticket.email}`);
    } catch (err) {
        console.error(`❌ Fallo al enviar confirmación a ${ticket.email}:`, err?.message || err);
    }
}

module.exports = { notifyNewTicket, notifyTicketConfirmation };
