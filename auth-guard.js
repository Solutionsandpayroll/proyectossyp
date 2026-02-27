/**
 * auth-guard.js — Script de autenticación compartido para S&P Gestión
 * 
 * USO en cada página:
 *   <script src="auth-guard.js" data-page="NOMBRE_PAGINA"></script>
 *
 * Valores de data-page:
 *   "index"     → accesible a todos, KPIs solo admin
 *   "tickets"   → accesible a todos, funciones limitadas para default
 *   "procesos"  → solo admin
 *   "ahorros"   → solo admin
 */
(async function () {
    const API = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
        ? 'http://localhost:3000/api'
        : 'https://proyectossyp.onrender.com/api';
    const currentScript = document.currentScript;
    const PAGE = currentScript ? currentScript.dataset.page : 'index';

    // ── Obtener rol del servidor ──────────────────────────────────────────────
    let role = 'default';
    try {
        const res = await fetch(`${API}/auth/me`, { credentials: 'include' });
        const data = await res.json();
        role = data.role || 'default';
    } catch (e) {
        console.warn('No se pudo verificar sesión, asumiendo default.');
    }

    // Exponer rol globalmente
    window.SYP_ROLE = role;
    window.SYP_IS_ADMIN = role === 'admin';

    // ── Proteger páginas de solo-admin ────────────────────────────────────────
    const adminOnlyPages = ['procesos', 'ahorros'];
    if (adminOnlyPages.includes(PAGE) && role !== 'admin') {
        window.location.replace('index.html');
        return;
    }

    // ── Adaptar sidebar según rol ─────────────────────────────────────────────
    // Esperar a que el DOM esté listo
    function adaptSidebar() {
        // Ocultar links de admin para usuarios default
        if (role !== 'admin') {
            const adminLinks = document.querySelectorAll('[data-admin-only]');
            adminLinks.forEach(el => el.style.display = 'none');
        }

        // Botón configuración → login o logout
        const btnConfig = document.getElementById('btn-configuracion');
        if (btnConfig) {
            if (role === 'admin') {
                btnConfig.innerHTML = `
                    <span class="material-symbols-outlined text-xl">logout</span>
                    <span class="text-sm font-medium">Cerrar Sesión</span>
                `;
                btnConfig.onclick = async (e) => {
                    e.preventDefault();
                    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
                    window.location.reload();
                };
            } else {
                btnConfig.innerHTML = `
                    <span class="material-symbols-outlined text-xl">manage_accounts</span>
                    <span class="text-sm font-medium">Iniciar Sesión</span>
                `;
                btnConfig.onclick = (e) => {
                    e.preventDefault();
                    window.location.href = 'login.html?from=' + encodeURIComponent(window.location.pathname);
                };
            }
        }

        // Badge de rol en sidebar
        const roleBadge = document.getElementById('role-badge');
        if (roleBadge) {
            if (role === 'admin') {
                roleBadge.textContent = 'Admin';
                roleBadge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full bg-accent text-white';
            } else {
                roleBadge.textContent = 'Invitado';
                roleBadge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full bg-white/10 text-white/60';
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', adaptSidebar);
    } else {
        adaptSidebar();
    }

    // ── Disparar evento para que cada página reaccione al rol ─────────────────
    window.dispatchEvent(new CustomEvent('syp:auth', { detail: { role } }));

})();