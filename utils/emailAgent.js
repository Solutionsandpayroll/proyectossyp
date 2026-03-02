const { Resend } = require('resend');

// If API key is not set or it is a dummy, we don't want to crash but we might want to warn
const apiKey = process.env.RESEND_API_KEY;
let resend;
if (apiKey && apiKey !== 're_123456789_dummy_key_please_replace') {
    resend = new Resend(apiKey);
} else {
    console.warn('⚠️  RESEND_API_KEY no configurada o es de prueba. Los correos se simularán en la consola.');
}

async function notifyNewTicket(ticket) {
    if (!ticket) {
        console.error('Alerta de correo cancelada: el ticket es nulo.');
        return;
    }
    if (!resend) {
        console.log(`[SIMULACIÓN EMAIL] 🚨 Ticket #${ticket.id} - ${ticket.subject}`);
        return;
    }

    const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';
    const rawTo = process.env.EMAIL_TO || 'automatizacion3@solutionsandpayroll.com';
    const toList = rawTo.split(',').map(e => e.trim()).filter(Boolean);

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

    // Envío individual a cada destinatario (compatible con plan gratuito de Resend)
    const results = await Promise.allSettled(
        toList.map(to =>
            resend.emails.send({
                from: fromEmail,
                to,
                subject: `🚨 Nuevo Ticket #${ticket.id} - ${ticket.subject}`,
                html,
            })
        )
    );

    results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            console.log(`✅ Correo enviado a ${toList[i]}`);
        } else {
            console.error(`❌ Fallo al enviar a ${toList[i]}:`, r.reason?.message || r.reason);
        }
    });
}

module.exports = { notifyNewTicket };
