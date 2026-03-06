/**
 * auth-guard.js — Autenticación JWT via localStorage para S&P Gestión
 *
 * USO en cada página:
 *   <script src="auth-guard.js" data-page="NOMBRE"></script>
 *
 * Páginas válidas:
 *   "index"    → todos acceden, KPIs solo admin
 *   "tickets"  → todos acceden, funciones limitadas para invitado
 *   "procesos" → solo admin (redirige si no)
 *   "ahorros"  → solo admin (redirige si no)
 *
 * Cómo funciona el token:
 *   - Al hacer login, el servidor devuelve { token, role }
 *   - El cliente guarda el token en localStorage con clave 'syp_token'
 *   - Cada request protegido envía: Authorization: Bearer <token>
 *   - Al cerrar sesión se borra localStorage.removeItem('syp_token')
 */
(async function () {

    const API = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
        ? 'http://localhost:3000/api'
        : 'https://portal.solutionsandpayroll.com/api';

    const PAGE = (document.currentScript?.dataset?.page) || 'index';
    const TOKEN_KEY = 'syp_token';

    // ── Leer token guardado ───────────────────────────────────────────────────
    const token = localStorage.getItem(TOKEN_KEY);

    // ── Verificar token con el servidor ──────────────────────────────────────
    let role = 'default';
    let username = null;
    let email = null;
    let userId = null;
    let serverResponded = false;
    try {
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetch(`${API}/auth/me`, { headers });
        const data = await res.json();
        role = data.role || 'default';
        username = data.username || null;
        email = data.email || null;
        userId = data.id || null;
        serverResponded = true;
    } catch (e) {
        console.warn('[auth-guard] No se pudo verificar el token, asumiendo default.');
    }

    // Solo limpiar el token si el servidor respondió pero no reconoció al usuario
    // (token expirado o inválido). Si el servidor no respondió, conservar el token.
    if (token && !username && serverResponded) {
        localStorage.removeItem(TOKEN_KEY);
    }

    // ── Exponer globalmente ────────────────────────────────────────
    window.SYP_ROLE = role;
    window.SYP_IS_ADMIN = role === 'admin';
    window.SYP_IS_AUTHENTICATED = !!username;   // true si hay sesión válida (admin o default)
    window.SYP_TOKEN = token;
    window.SYP_USERNAME = username;
    window.SYP_EMAIL = email;
    window.SYP_USER_ID = userId;

    // ── Helper: fetch autenticado (agrega el header automáticamente) ──────────
    // Las páginas pueden usar: authFetch(url, options)
    window.authFetch = function (url, options = {}) {
        const tk = localStorage.getItem(TOKEN_KEY);
        if (tk) {
            options.headers = Object.assign({}, options.headers || {}, { 'Authorization': `Bearer ${tk}` });
        }
        return fetch(url, options);
    };

    // ── Proteger páginas de solo-admin ────────────────────────────────────────
    if (['procesos', 'ahorros'].includes(PAGE) && role !== 'admin') {
        // Si está autenticado como default → no tiene acceso → volver al inicio
        // Si no está autenticado → pedir login (podría ser un admin)
        if (username) {
            window.location.replace('index.html');
        } else {
            window.location.replace('login.html?from=' + encodeURIComponent(window.location.pathname));
        }
        return;
    }

    // ── Adaptar sidebar ───────────────────────────────────────────────────────
    function adaptSidebar() {
        // Ocultar links de admin
        if (role !== 'admin') {
            document.querySelectorAll('[data-admin-only]').forEach(el => el.style.display = 'none');
        }
        // Ocultar botón de registro si ya hay sesión activa
        if (username) {
            document.querySelectorAll('[data-guest-only]').forEach(el => el.style.display = 'none');
        }

        // Badge de rol
        const badge = document.getElementById('role-badge');
        if (badge) {
            if (role === 'admin') {
                badge.textContent = 'Admin';
                badge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full bg-accent text-white';
            } else if (window.SYP_IS_AUTHENTICATED) {
                // Usuario default autenticado: mostrar email acortado
                const label = (email || username || 'Usuario').split('@')[0];
                badge.textContent = label.length > 12 ? label.slice(0, 12) + '…' : label;
                badge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-500/80 text-white';
                badge.title = email || username || '';
            } else {
                badge.textContent = 'Invitado';
                badge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full bg-white/10 text-white/60';
            }
        }

        // Botón login / logout
        const btn = document.getElementById('btn-configuracion');
        if (btn) {
            if (role === 'admin') {
                btn.innerHTML = `
                    <span class="material-symbols-outlined text-xl">logout</span>
                    <span class="text-sm font-medium">Cerrar Sesión</span>`;
                btn.onclick = async (e) => {
                    e.preventDefault();
                    try {
                        const tk = localStorage.getItem(TOKEN_KEY);
                        await fetch(`${API}/auth/logout`, {
                            method: 'POST',
                            headers: tk ? { 'Authorization': `Bearer ${tk}` } : {},
                        });
                    } catch { /* silenciar errores de red */ }
                    localStorage.removeItem(TOKEN_KEY);
                    window.location.href = 'index.html';
                };
            } else if (window.SYP_IS_AUTHENTICATED) {
                // Usuario default autenticado: también puede cerrar sesión
                btn.innerHTML = `
                    <span class="material-symbols-outlined text-xl">logout</span>
                    <span class="text-sm font-medium">Cerrar Sesión</span>`;
                btn.onclick = async (e) => {
                    e.preventDefault();
                    try {
                        const tk = localStorage.getItem(TOKEN_KEY);
                        await fetch(`${API}/auth/logout`, {
                            method: 'POST',
                            headers: tk ? { 'Authorization': `Bearer ${tk}` } : {},
                        });
                    } catch { /* silenciar errores de red */ }
                    localStorage.removeItem(TOKEN_KEY);
                    window.location.href = 'tickets.html';
                };
            } else {
                btn.innerHTML = `
                    <span class="material-symbols-outlined text-xl">manage_accounts</span>
                    <span class="text-sm font-medium">Iniciar Sesión</span>`;
                btn.onclick = (e) => {
                    e.preventDefault();
                    window.location.href = 'login.html?from=' + encodeURIComponent(window.location.pathname);
                };
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', adaptSidebar);
    } else {
        adaptSidebar();
    }

    // ── Disparar evento para que cada página reaccione al rol ─────────────────
    window.dispatchEvent(new CustomEvent('syp:auth', { detail: { role, token } }));

})();