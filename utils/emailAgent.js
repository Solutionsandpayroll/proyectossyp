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
    try {
        const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev'; // Resend allows onboarding@resend.dev for testing
        const toEmail = process.env.EMAIL_TO || 'automatizacion3@solutionsandpayroll.com'; // Change this to a verified email if testing with Resend free tier

        if (!ticket) {
            console.error('Alerta de correo cancelada: El ticket proporcionado es nulo.');
            return;
        }

        if (!resend) {
            console.log(`[SIMULACIÓN EMAIL] 🚨 Alerta de ticket #${ticket.id} (${ticket.subject})`);
            return;
        }

        await resend.emails.send({
            from: fromEmail,
            to: toEmail,
            subject: `🚨 Nuevo Ticket Creado: #${ticket.id} - ${ticket.subject}`,
            html: `
        <div style="font-family: Arial, sans-serif; color: #333;">
            <h2 style="color: #105788;">Se ha registrado un nuevo ticket en el sistema</h2>
            <p><strong>ID del Ticket:</strong> #${ticket.id}</p>
            <p><strong>Asunto:</strong> ${ticket.subject}</p>
            <p><strong>Descripción:</strong> ${ticket.description}</p>
            <p><strong>Prioridad:</strong> ${ticket.priority}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 0.9em; color: #666;">Por favor, revisa el dashboard para gestionarlo lo antes posible.</p>
        </div>
      `
        });
        console.log(`Alerta de ticket #${ticket.id} enviada con éxito a ${toEmail}.`);
    } catch (error) {
        console.error('Error enviando correo de alerta:', error);
    }
}

module.exports = { notifyNewTicket };
