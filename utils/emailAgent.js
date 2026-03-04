const nodemailer = require('nodemailer');

const gmailUser = process.env.GMAIL_USER;
const gmailPass = process.env.GMAIL_APP_PASSWORD;
const fromName = process.env.EMAIL_FROM_NAME || 'S&P Gestión';

let transporter;
if (gmailUser && gmailPass) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });
} else {
    console.warn('⚠️  GMAIL_USER o GMAIL_APP_PASSWORD no configurados. Los correos se simularán en la consola.');
}

async function notifyNewTicket(ticket) {
    if (!ticket) {
        console.error('Alerta de correo cancelada: el ticket es nulo.');
        return;
    }
    if (!transporter) {
        console.log(`[SIMULACIÓN EMAIL] 🚨 Ticket #${ticket.id} - ${ticket.subject}`);
        return;
    }

    const fromEmail = `${fromName} <${gmailUser}>`;
    const rawTo = process.env.EMAIL_TO || '';
    const toList = rawTo.split(',').map(e => e.trim()).filter(Boolean);
    if (!toList.length) { console.warn('EMAIL_TO no configurado.'); return; }

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
        await transporter.sendMail({
            from: fromEmail,
            to: toList.join(', '),
            subject: `🚨 Nuevo Ticket #${ticket.id} - ${ticket.subject}`,
            html,
        });
        console.log(`✅ Alerta enviada a: ${toList.join(', ')}`);
    } catch (err) {
        console.error('❌ Fallo al enviar alerta:', err?.message || err);
    }
}

async function notifyTicketConfirmation(ticket) {
    console.log(`[EMAIL CONFIRMACION] ticket.email recibido: "${ticket?.email}"`);
    if (!ticket || !ticket.email) {
        console.log('[EMAIL CONFIRMACION] Ticket sin email de usuario, se omite confirmación.');
        return;
    }
    if (!transporter) {
        console.log(`[SIMULACIÓN EMAIL CONFIRMACIÓN] ✅ Ticket #${ticket.id} confirmado a ${ticket.email}`);
        return;
    }

    const fromEmail = `${fromName} <${gmailUser}>`;

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

    console.log(`[EMAIL CONFIRMACION] Intentando enviar a: ${ticket.email} desde: ${gmailUser}`);
    try {
        const result = await transporter.sendMail({
            from: fromEmail,
            to: ticket.email,
            subject: `✅ Confirmación de ticket #${ticket.id} - ${ticket.subject}`,
            html,
        });
        console.log(`✅ Confirmación enviada a ${ticket.email}. MessageId: ${result.messageId}`);
    } catch (err) {
        console.error(`❌ Fallo al enviar confirmación a ${ticket.email}:`, err?.message || err);
    }
}

module.exports = { notifyNewTicket, notifyTicketConfirmation };
