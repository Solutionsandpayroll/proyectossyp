// server.js — S&P Gestión · Auth con JWT en Authorization header
// Sin cookies → compatible 100% con Cloudflare / Render
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const initDb = require('./db/init');
require('dotenv').config();

const EventEmitter = require('events');
const ticketEvents = new EventEmitter();
const { notifyNewTicket } = require('./utils/emailAgent');
ticketEvents.on('new_ticket', notifyNewTicket);

const app = express();
const PORT = process.env.PORT || 3000;

// ── JWT ────────────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'syp-jwt-fallback-secret-2025';
const JWT_EXPIRES = '8h';

// ── CORS ───────────────────────────────────────────────────────────────────────
const allowedOrigins = [
    'http://127.0.0.1:5500',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://localhost:3000',
    'https://proyectossyp.onrender.com',
];
app.use(cors({
    // null origin = archivo abierto desde file:// (desarrollo local sin servidor web)
    // Sin cookies ni credentials → JWT en Authorization header
    origin: function (origin, cb) {
        if (!origin || origin === 'null' || allowedOrigins.includes(origin)) {
            return cb(null, true);
        }
        cb(new Error('CORS bloqueado para: ' + origin));
    },
    credentials: false,
}));
app.use(express.json());

// ── Carpeta uploads ────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Multer ─────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Middleware JWT ─────────────────────────────────────────────────────────────
// Lee el token del header:  Authorization: Bearer <token>
function getToken(req) {
    const auth = req.headers['authorization'] || '';
    return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function requireAdmin(req, res, next) {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: 'Token requerido.' });
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload.role !== 'admin') return res.status(403).json({ error: 'Solo admin.' });
        req.user = payload;
        next();
    } catch {
        res.status(401).json({ error: 'Token inválido o expirado.' });
    }
}

// ── Arranque ───────────────────────────────────────────────────────────────────
initDb().then(async db => {

    // Crear tabla users si no existe
    await db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id         SERIAL PRIMARY KEY,
            username   VARCHAR(50)  NOT NULL UNIQUE,
            password   TEXT         NOT NULL,
            role       VARCHAR(20)  NOT NULL DEFAULT 'default',
            created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `);

    // ── Seed de usuarios: usa UPSERT para garantizar hash correcto siempre ──────
    // Si el usuario ya existe, actualiza el hash (evita problemas de deploys anteriores)
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Admin2025*';
    const adminHash = await bcrypt.hash(ADMIN_PASS, 10);
    const defaultHash = await bcrypt.hash('no-login-default', 10);

    await db.run(`
        INSERT INTO users (username, password, role)
        VALUES ('admin', $1, 'admin')
        ON CONFLICT (username) DO UPDATE SET password = $1, role = 'admin'
    `, [adminHash]);
    console.log('✅ Usuario admin listo (contraseña sincronizada)');

    await db.run(`
        INSERT INTO users (username, password, role)
        VALUES ('default', $1, 'default')
        ON CONFLICT (username) DO UPDATE SET password = $1, role = 'default'
    `, [defaultHash]);
    console.log('✅ Usuario default listo');

    // ═══════════════════════════════════════════════════════════════════════════
    //  AUTH
    // ═══════════════════════════════════════════════════════════════════════════

    // GET /api/auth/me  — el cliente envía su token; si no tiene → role default
    app.get('/api/auth/me', (req, res) => {
        const token = getToken(req);
        if (!token) return res.json({ role: 'default' });
        try {
            const payload = jwt.verify(token, JWT_SECRET);
            res.json({ role: payload.role, username: payload.username });
        } catch {
            res.json({ role: 'default' });
        }
    });

    // POST /api/auth/login  — devuelve un JWT
    app.post('/api/auth/login', async (req, res) => {
        try {
            const { username, password } = req.body || {};
            if (!username || !password)
                return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });

            const user = await db.getRow("SELECT * FROM users WHERE username=$1", [username]);
            if (!user) return res.status(401).json({ error: 'Credenciales incorrectas.' });

            const ok = await bcrypt.compare(password, user.password);
            if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas.' });

            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role },
                JWT_SECRET,
                { expiresIn: JWT_EXPIRES }
            );
            res.json({ token, role: user.role, username: user.username });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error en el servidor.' });
        }
    });

    // POST /api/auth/logout  — solo informativo; el cliente borra el token
    app.post('/api/auth/logout', (_req, res) => res.json({ ok: true }));

    // ═══════════════════════════════════════════════════════════════════════════
    //  PROYECTOS — solo admin
    // ═══════════════════════════════════════════════════════════════════════════

    app.get('/api/proyectos', requireAdmin, async (req, res) => {
        try {
            const rows = await db.getAll(`
                SELECT p.*, s.amount AS savings_amount, s.status AS savings_status
                FROM projects p LEFT JOIN savings s ON s.project_id = p.id
                ORDER BY p.created_at DESC`);
            res.json(rows);
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener proyectos' }); }
    });

    app.get('/api/proyectos/:id', requireAdmin, async (req, res) => {
        try {
            const row = await db.getRow('SELECT * FROM projects WHERE id=$1', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Proyecto no encontrado' });
            res.json(row);
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener proyecto' }); }
    });

    app.post('/api/proyectos', requireAdmin, async (req, res) => {
        try {
            const { area, encargado, leader, name, status = 'En Progreso', progress = 0 } = req.body;
            if (!area || !encargado || !leader || !name)
                return res.status(400).json({ error: 'area, encargado, leader y name son requeridos' });
            const id = await db.runAndSave(
                'INSERT INTO projects (area,encargado,leader,name,status,progress) VALUES ($1,$2,$3,$4,$5,$6)',
                [area, encargado, leader, name, status, progress]);
            res.status(201).json(await db.getRow('SELECT * FROM projects WHERE id=$1', [id]));
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al crear proyecto' }); }
    });

    app.put('/api/proyectos/:id', requireAdmin, async (req, res) => {
        try {
            const ex = await db.getRow('SELECT * FROM projects WHERE id=$1', [req.params.id]);
            if (!ex) return res.status(404).json({ error: 'Proyecto no encontrado' });
            const { area, encargado, leader, name, status, progress } = req.body;
            await db.run(
                'UPDATE projects SET area=$1,encargado=$2,leader=$3,name=$4,status=$5,progress=$6 WHERE id=$7',
                [area ?? ex.area, encargado ?? ex.encargado, leader ?? ex.leader, name ?? ex.name, status ?? ex.status, progress ?? ex.progress, req.params.id]);
            res.json(await db.getRow('SELECT * FROM projects WHERE id=$1', [req.params.id]));
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar proyecto' }); }
    });

    app.delete('/api/proyectos/:id', requireAdmin, async (req, res) => {
        try {
            if (!await db.getRow('SELECT id FROM projects WHERE id=$1', [req.params.id]))
                return res.status(404).json({ error: 'Proyecto no encontrado' });
            await db.run('DELETE FROM projects WHERE id=$1', [req.params.id]);
            res.json({ message: 'Proyecto eliminado' });
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar proyecto' }); }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    //  AVANCES — solo admin
    // ═══════════════════════════════════════════════════════════════════════════

    app.get('/api/proyectos/:id/avances', requireAdmin, async (req, res) => {
        try {
            if (!await db.getRow('SELECT id FROM projects WHERE id=$1', [req.params.id]))
                return res.status(404).json({ error: 'Proyecto no encontrado' });
            res.json(await db.getAll('SELECT * FROM advances WHERE project_id=$1 ORDER BY date DESC', [req.params.id]));
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener avances' }); }
    });

    app.post('/api/proyectos/:id/avances', requireAdmin, async (req, res) => {
        try {
            const { description, date, progress = 0 } = req.body;
            if (!description || !date) return res.status(400).json({ error: 'description y date requeridos' });
            if (!await db.getRow('SELECT id FROM projects WHERE id=$1', [req.params.id]))
                return res.status(404).json({ error: 'Proyecto no encontrado' });
            const pg = Math.min(Math.max(parseInt(progress, 10) || 0, 0), 100);
            const id = await db.runAndSave(
                'INSERT INTO advances (project_id,description,date,progress) VALUES ($1,$2,$3,$4)',
                [req.params.id, description, date, pg]);
            await db.run('UPDATE projects SET progress=$1 WHERE id=$2', [pg, req.params.id]);
            res.status(201).json(await db.getRow('SELECT * FROM advances WHERE id=$1', [id]));
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al crear avance' }); }
    });

    app.delete('/api/avances/:id', requireAdmin, async (req, res) => {
        try {
            const ex = await db.getRow('SELECT * FROM advances WHERE id=$1', [req.params.id]);
            if (!ex) return res.status(404).json({ error: 'Avance no encontrado' });
            await db.run('DELETE FROM advances WHERE id=$1', [req.params.id]);
            const latest = await db.getRow(
                'SELECT progress FROM advances WHERE project_id=$1 ORDER BY date DESC,id DESC LIMIT 1', [ex.project_id]);
            await db.run('UPDATE projects SET progress=$1 WHERE id=$2', [latest?.progress ?? 0, ex.project_id]);
            res.json({ message: 'Avance eliminado' });
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar avance' }); }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    //  TICKETS — crear: público | resto: admin
    // ═══════════════════════════════════════════════════════════════════════════

    app.get('/api/tickets', requireAdmin, async (req, res) => {
        try {
            res.json(await db.getAll('SELECT * FROM tickets ORDER BY created_at DESC'));
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener tickets' }); }
    });

    app.post('/api/tickets', upload.single('attachment'), async (req, res) => {
        try {
            const { date, subject, description, priority = 'Media' } = req.body;
            if (!date || !subject || !description)
                return res.status(400).json({ error: 'date, subject y description requeridos' });
            const attachment = req.file ? `uploads/${req.file.filename}` : null;
            const id = await db.runAndSave(
                'INSERT INTO tickets (date,subject,description,priority,attachment) VALUES ($1,$2,$3,$4,$5)',
                [date, subject, description, priority, attachment]);
            const ticket = await db.getRow('SELECT * FROM tickets WHERE id=$1', [id]);
            ticketEvents.emit('new_ticket', ticket);
            res.status(201).json(ticket);
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al crear ticket' }); }
    });

    app.put('/api/tickets/:id', requireAdmin, async (req, res) => {
        try {
            const ex = await db.getRow('SELECT * FROM tickets WHERE id=$1', [req.params.id]);
            if (!ex) return res.status(404).json({ error: 'Ticket no encontrado' });
            const { date, subject, description, priority, status } = req.body;
            await db.run(
                'UPDATE tickets SET date=$1,subject=$2,description=$3,priority=$4,status=$5 WHERE id=$6',
                [date ?? ex.date, subject ?? ex.subject, description ?? ex.description, priority ?? ex.priority, status ?? ex.status, req.params.id]);
            res.json(await db.getRow('SELECT * FROM tickets WHERE id=$1', [req.params.id]));
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar ticket' }); }
    });

    app.delete('/api/tickets/:id', requireAdmin, async (req, res) => {
        try {
            const ticket = await db.getRow('SELECT attachment FROM tickets WHERE id=$1', [req.params.id]);
            if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
            if (ticket.attachment) {
                const fp = path.join(__dirname, ticket.attachment);
                if (fs.existsSync(fp)) fs.unlinkSync(fp);
            }
            await db.run('DELETE FROM tickets WHERE id=$1', [req.params.id]);
            res.json({ message: 'Ticket eliminado' });
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar ticket' }); }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    //  AHORROS — solo admin
    // ═══════════════════════════════════════════════════════════════════════════

    app.get('/api/ahorros', requireAdmin, async (req, res) => {
        try {
            res.json(await db.getAll(`
                SELECT s.*, p.name AS project_name, p.area AS project_area, p.encargado AS project_encargado
                FROM savings s JOIN projects p ON p.id=s.project_id
                ORDER BY s.created_at DESC`));
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener ahorros' }); }
    });

    app.post('/api/ahorros', requireAdmin, async (req, res) => {
        try {
            const {
                project_id, amount, status = 'Proyectado', date,
                costo_mensual = 0, costo_hora = 0,
                tiempo_empleado_antes = 0, tiempo_empleado_actual = 0,
                tiempo_gestion_antes = 0, tiempo_gestion_antes_tipo = 'Mensual',
                tiempo_gestion_actual = 0, tiempo_gestion_actual_tipo = 'Mensual',
                total_antes = 0, total_actual = 0,
            } = req.body;
            if (!project_id || amount == null || !date)
                return res.status(400).json({ error: 'project_id, amount y date requeridos' });
            if (!await db.getRow('SELECT id FROM projects WHERE id=$1', [project_id]))
                return res.status(404).json({ error: 'Proyecto no encontrado' });
            const id = await db.runAndSave(
                `INSERT INTO savings (project_id,amount,status,date,costo_mensual,costo_hora,
                    tiempo_empleado_antes,tiempo_empleado_actual,tiempo_gestion_antes,tiempo_gestion_antes_tipo,
                    tiempo_gestion_actual,tiempo_gestion_actual_tipo,total_antes,total_actual)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
                [project_id, amount, status, date, costo_mensual, costo_hora,
                    tiempo_empleado_antes, tiempo_empleado_actual, tiempo_gestion_antes, tiempo_gestion_antes_tipo,
                    tiempo_gestion_actual, tiempo_gestion_actual_tipo, total_antes, total_actual]);
            res.status(201).json(await db.getRow('SELECT * FROM savings WHERE id=$1', [id]));
        } catch (err) {
            if (err.code === '23505') return res.status(409).json({ error: 'Proyecto ya tiene ahorro. Use PUT.' });
            console.error(err); res.status(500).json({ error: 'Error al crear ahorro' });
        }
    });

    app.put('/api/ahorros/:id', requireAdmin, async (req, res) => {
        try {
            const ex = await db.getRow('SELECT * FROM savings WHERE id=$1', [req.params.id]);
            if (!ex) return res.status(404).json({ error: 'Ahorro no encontrado' });
            const f = req.body;
            await db.run(
                `UPDATE savings SET amount=$1,status=$2,date=$3,costo_mensual=$4,costo_hora=$5,
                    tiempo_empleado_antes=$6,tiempo_empleado_actual=$7,tiempo_gestion_antes=$8,
                    tiempo_gestion_antes_tipo=$9,tiempo_gestion_actual=$10,tiempo_gestion_actual_tipo=$11,
                    total_antes=$12,total_actual=$13 WHERE id=$14`,
                [f.amount ?? ex.amount, f.status ?? ex.status, f.date ?? ex.date,
                f.costo_mensual ?? ex.costo_mensual, f.costo_hora ?? ex.costo_hora,
                f.tiempo_empleado_antes ?? ex.tiempo_empleado_antes, f.tiempo_empleado_actual ?? ex.tiempo_empleado_actual,
                f.tiempo_gestion_antes ?? ex.tiempo_gestion_antes, f.tiempo_gestion_antes_tipo ?? ex.tiempo_gestion_antes_tipo,
                f.tiempo_gestion_actual ?? ex.tiempo_gestion_actual, f.tiempo_gestion_actual_tipo ?? ex.tiempo_gestion_actual_tipo,
                f.total_antes ?? ex.total_antes, f.total_actual ?? ex.total_actual, req.params.id]);
            res.json(await db.getRow('SELECT * FROM savings WHERE id=$1', [req.params.id]));
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar ahorro' }); }
    });

    app.delete('/api/ahorros/:id', requireAdmin, async (req, res) => {
        try {
            if (!await db.getRow('SELECT id FROM savings WHERE id=$1', [req.params.id]))
                return res.status(404).json({ error: 'Ahorro no encontrado' });
            await db.run('DELETE FROM savings WHERE id=$1', [req.params.id]);
            res.json({ message: 'Ahorro eliminado' });
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar ahorro' }); }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    //  DASHBOARD — solo admin
    // ═══════════════════════════════════════════════════════════════════════════

    app.get('/api/dashboard', requireAdmin, async (req, res) => {
        try {
            const { c: totalProyectos } = await db.getRow('SELECT COUNT(*) as c FROM projects') || { c: 0 };
            const { c: ticketsAbiertos } = await db.getRow("SELECT COUNT(*) as c FROM tickets WHERE status='Abierto'") || { c: 0 };
            const { c: ticketsCriticos } = await db.getRow("SELECT COUNT(*) as c FROM tickets WHERE priority='Critica' AND status='Abierto'") || { c: 0 };
            const { t: totalAhorros } = await db.getRow('SELECT COALESCE(SUM(amount),0) as t FROM savings') || { t: 0 };
            const recentProjects = await db.getAll(`
                SELECT p.*, s.amount AS savings_amount FROM projects p
                LEFT JOIN savings s ON s.project_id=p.id ORDER BY p.created_at DESC LIMIT 5`);
            res.json({ totalProyectos, ticketsAbiertos, ticketsCriticos, totalAhorros, recentProjects });
        } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener dashboard' }); }
    });

    app.listen(PORT, () => console.log(`🚀 Servidor SyP en puerto ${PORT} — Auth: JWT (sin cookies)`));

}).catch(err => { console.error('❌ Error BD:', err); process.exit(1); });