// server.js — Servidor Express para el Sistema SyP (PostgreSQL/Neon)
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const initDb = require('./db/init');
require('dotenv').config();

const EventEmitter = require('events');
const ticketEvents = new EventEmitter();
const { notifyNewTicket } = require('./utils/emailAgent');

ticketEvents.on('new_ticket', notifyNewTicket);

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Contraseña admin (hash de "Admin2025*") ──────────────────────────────────
// Para cambiarla: node -e "const b=require('bcryptjs'); b.hash('TuNuevaPass',10).then(h=>console.log(h))"
const ADMIN_PASSWORD_HASH = bcrypt.hashSync('admin123*', 10);
const ADMIN_USERNAME = 'admin';

// ─── Carpeta de adjuntos ───────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// ─── Middleware ────────────────────────────────────────────────────────────────
const allowedOrigins = [
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'https://proyectossyp.onrender.com'
];
app.use(cors({
    origin: function(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(express.json());

// ─── Sesiones ─────────────────────────────────────────────────────────────────
app.use(session({
    secret: process.env.SESSION_SECRET || 'syp-secret-key-2025',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // HTTPS en Render
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000, // 8 horas
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    }
}));

app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        cb(null, `${unique}-${file.originalname}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Middlewares de autenticación ─────────────────────────────────────────────
function requireAdmin(req, res, next) {
    if (req.session && req.session.role === 'admin') return next();
    res.status(401).json({ error: 'No autorizado. Se requiere rol admin.' });
}

// ─── Arranque asíncrono ────────────────────────────────────────────────────────
initDb().then(db => {

    // ═══════════════════════════════════════════════════════════════════════════
    //  AUTH
    // ═══════════════════════════════════════════════════════════════════════════

    // Verificar sesión actual
    app.get('/api/auth/me', (req, res) => {
        if (req.session && req.session.role === 'admin') {
            return res.json({ role: 'admin', username: ADMIN_USERNAME });
        }
        res.json({ role: 'default' });
    });

    // Login
    app.post('/api/auth/login', async (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) {
                return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });
            }
            if (username !== ADMIN_USERNAME) {
                return res.status(401).json({ error: 'Credenciales incorrectas.' });
            }
            const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
            if (!valid) {
                return res.status(401).json({ error: 'Credenciales incorrectas.' });
            }
            req.session.role = 'admin';
            req.session.username = ADMIN_USERNAME;
            res.json({ role: 'admin', username: ADMIN_USERNAME });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error en el servidor.' });
        }
    });

    // Logout
    app.post('/api/auth/logout', (req, res) => {
        req.session.destroy(() => {
            res.json({ ok: true });
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    //  PROYECTOS — solo admin
    // ═══════════════════════════════════════════════════════════════════════════

    app.get('/api/proyectos', requireAdmin, async (req, res) => {
        try {
            const rows = await db.getAll(`
                SELECT p.*, s.amount AS savings_amount, s.status AS savings_status
                FROM projects p
                LEFT JOIN savings s ON s.project_id = p.id
                ORDER BY p.created_at DESC
            `);
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al obtener proyectos' });
        }
    });

    app.get('/api/proyectos/:id', requireAdmin, async (req, res) => {
        try {
            const row = await db.getRow('SELECT * FROM projects WHERE id = $1', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Proyecto no encontrado' });
            res.json(row);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al obtener proyecto' });
        }
    });

    app.post('/api/proyectos', requireAdmin, async (req, res) => {
        try {
            const { area, encargado, leader, name, status = 'En Progreso', progress = 0 } = req.body;
            if (!area || !encargado || !leader || !name) {
                return res.status(400).json({ error: 'area, encargado, leader y name son requeridos' });
            }
            const id = await db.runAndSave(
                'INSERT INTO projects (area, encargado, leader, name, status, progress) VALUES ($1, $2, $3, $4, $5, $6)',
                [area, encargado, leader, name, status, progress]
            );
            const created = await db.getRow('SELECT * FROM projects WHERE id = $1', [id]);
            res.status(201).json(created);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al crear proyecto' });
        }
    });

    app.put('/api/proyectos/:id', requireAdmin, async (req, res) => {
        try {
            const existing = await db.getRow('SELECT * FROM projects WHERE id = $1', [req.params.id]);
            if (!existing) return res.status(404).json({ error: 'Proyecto no encontrado' });
            const { area, encargado, leader, name, status, progress } = req.body;
            await db.run(
                'UPDATE projects SET area=$1, encargado=$2, leader=$3, name=$4, status=$5, progress=$6 WHERE id=$7',
                [
                    area ?? existing.area,
                    encargado ?? existing.encargado,
                    leader ?? existing.leader,
                    name ?? existing.name,
                    status ?? existing.status,
                    progress ?? existing.progress,
                    req.params.id
                ]
            );
            const updated = await db.getRow('SELECT * FROM projects WHERE id = $1', [req.params.id]);
            res.json(updated);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al actualizar proyecto' });
        }
    });

    app.delete('/api/proyectos/:id', requireAdmin, async (req, res) => {
        try {
            const existing = await db.getRow('SELECT id FROM projects WHERE id = $1', [req.params.id]);
            if (!existing) return res.status(404).json({ error: 'Proyecto no encontrado' });
            await db.run('DELETE FROM projects WHERE id = $1', [req.params.id]);
            res.json({ message: 'Proyecto eliminado' });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al eliminar proyecto' });
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    //  AVANCES — solo admin
    // ═══════════════════════════════════════════════════════════════════════════

    app.get('/api/proyectos/:id/avances', requireAdmin, async (req, res) => {
        try {
            const project = await db.getRow('SELECT id FROM projects WHERE id = $1', [req.params.id]);
            if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
            const rows = await db.getAll(
                'SELECT * FROM advances WHERE project_id = $1 ORDER BY date DESC',
                [req.params.id]
            );
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al obtener avances' });
        }
    });

    app.post('/api/proyectos/:id/avances', requireAdmin, async (req, res) => {
        try {
            const { description, date, progress = 0 } = req.body;
            if (!description || !date) {
                return res.status(400).json({ error: 'description y date son requeridos' });
            }
            const project = await db.getRow('SELECT id FROM projects WHERE id = $1', [req.params.id]);
            if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

            let pg = parseInt(progress, 10);
            if (isNaN(pg)) pg = 0;
            if (pg < 0) pg = 0;
            if (pg > 100) pg = 100;

            const id = await db.runAndSave(
                'INSERT INTO advances (project_id, description, date, progress) VALUES ($1, $2, $3, $4)',
                [req.params.id, description, date, pg]
            );
            await db.run('UPDATE projects SET progress = $1 WHERE id = $2', [pg, req.params.id]);

            const created = await db.getRow('SELECT * FROM advances WHERE id = $1', [id]);
            res.status(201).json(created);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al crear avance' });
        }
    });

    app.delete('/api/avances/:id', requireAdmin, async (req, res) => {
        try {
            const existing = await db.getRow('SELECT * FROM advances WHERE id = $1', [req.params.id]);
            if (!existing) return res.status(404).json({ error: 'Avance no encontrado' });

            const projectId = existing.project_id;
            await db.run('DELETE FROM advances WHERE id = $1', [req.params.id]);

            const latestAdvance = await db.getRow(
                'SELECT progress FROM advances WHERE project_id = $1 ORDER BY date DESC, id DESC LIMIT 1',
                [projectId]
            );
            const newProgress = latestAdvance ? latestAdvance.progress : 0;
            await db.run('UPDATE projects SET progress = $1 WHERE id = $2', [newProgress, projectId]);

            res.json({ message: 'Avance eliminado' });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al eliminar avance' });
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    //  TICKETS — crear: público | listar/editar/eliminar: admin
    // ═══════════════════════════════════════════════════════════════════════════

    // GET todos los tickets → solo admin
    app.get('/api/tickets', requireAdmin, async (req, res) => {
        try {
            const rows = await db.getAll('SELECT * FROM tickets ORDER BY created_at DESC');
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al obtener tickets' });
        }
    });

    // POST crear ticket → público (default + admin)
    app.post('/api/tickets', upload.single('attachment'), async (req, res) => {
        try {
            const { date, subject, description, priority = 'Media' } = req.body;
            if (!date || !subject || !description) {
                return res.status(400).json({ error: 'date, subject y description son requeridos' });
            }
            const attachmentPath = req.file ? `uploads/${req.file.filename}` : null;
            const id = await db.runAndSave(
                'INSERT INTO tickets (date, subject, description, priority, attachment) VALUES ($1, $2, $3, $4, $5)',
                [date, subject, description, priority, attachmentPath]
            );
            const newTicket = await db.getRow('SELECT * FROM tickets WHERE id = $1', [id]);
            ticketEvents.emit('new_ticket', newTicket);
            res.status(201).json(newTicket);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al crear ticket' });
        }
    });

    app.put('/api/tickets/:id', requireAdmin, async (req, res) => {
        try {
            const existing = await db.getRow('SELECT * FROM tickets WHERE id = $1', [req.params.id]);
            if (!existing) return res.status(404).json({ error: 'Ticket no encontrado' });
            const { date, subject, description, priority, status } = req.body;
            await db.run(
                'UPDATE tickets SET date=$1, subject=$2, description=$3, priority=$4, status=$5 WHERE id=$6',
                [
                    date ?? existing.date,
                    subject ?? existing.subject,
                    description ?? existing.description,
                    priority ?? existing.priority,
                    status ?? existing.status,
                    req.params.id
                ]
            );
            const updated = await db.getRow('SELECT * FROM tickets WHERE id = $1', [req.params.id]);
            res.json(updated);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al actualizar ticket' });
        }
    });

    app.delete('/api/tickets/:id', requireAdmin, async (req, res) => {
        try {
            const ticket = await db.getRow('SELECT attachment FROM tickets WHERE id = $1', [req.params.id]);
            if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
            if (ticket.attachment) {
                const filePath = path.join(__dirname, ticket.attachment);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
            await db.run('DELETE FROM tickets WHERE id = $1', [req.params.id]);
            res.json({ message: 'Ticket eliminado' });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al eliminar ticket' });
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    //  AHORROS — solo admin
    // ═══════════════════════════════════════════════════════════════════════════

    app.get('/api/ahorros', requireAdmin, async (req, res) => {
        try {
            const rows = await db.getAll(`
                SELECT s.*, p.name AS project_name, p.area AS project_area, p.encargado AS project_encargado
                FROM savings s
                JOIN projects p ON p.id = s.project_id
                ORDER BY s.created_at DESC
            `);
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al obtener ahorros' });
        }
    });

    app.post('/api/ahorros', requireAdmin, async (req, res) => {
        try {
            const {
                project_id, amount, status = 'Proyectado', date,
                costo_mensual = 0, costo_hora = 0,
                tiempo_empleado_antes = 0, tiempo_empleado_actual = 0,
                tiempo_gestion_antes = 0, tiempo_gestion_antes_tipo = 'Mensual',
                tiempo_gestion_actual = 0, tiempo_gestion_actual_tipo = 'Mensual',
                total_antes = 0, total_actual = 0
            } = req.body;

            if (!project_id || amount == null || !date) {
                return res.status(400).json({ error: 'project_id, amount y date son requeridos' });
            }
            const project = await db.getRow('SELECT id FROM projects WHERE id = $1', [project_id]);
            if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

            const id = await db.runAndSave(
                `INSERT INTO savings (
                    project_id, amount, status, date,
                    costo_mensual, costo_hora,
                    tiempo_empleado_antes, tiempo_empleado_actual,
                    tiempo_gestion_antes, tiempo_gestion_antes_tipo,
                    tiempo_gestion_actual, tiempo_gestion_actual_tipo,
                    total_antes, total_actual
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
                [
                    project_id, amount, status, date,
                    costo_mensual, costo_hora,
                    tiempo_empleado_antes, tiempo_empleado_actual,
                    tiempo_gestion_antes, tiempo_gestion_antes_tipo,
                    tiempo_gestion_actual, tiempo_gestion_actual_tipo,
                    total_antes, total_actual
                ]
            );
            const created = await db.getRow('SELECT * FROM savings WHERE id = $1', [id]);
            res.status(201).json(created);
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Este proyecto ya tiene un ahorro. Use PUT para actualizarlo.' });
            }
            console.error(err);
            res.status(500).json({ error: 'Error al crear ahorro' });
        }
    });

    app.put('/api/ahorros/:id', requireAdmin, async (req, res) => {
        try {
            const existing = await db.getRow('SELECT * FROM savings WHERE id = $1', [req.params.id]);
            if (!existing) return res.status(404).json({ error: 'Ahorro no encontrado' });
            const {
                amount, status, date,
                costo_mensual, costo_hora,
                tiempo_empleado_antes, tiempo_empleado_actual,
                tiempo_gestion_antes, tiempo_gestion_antes_tipo,
                tiempo_gestion_actual, tiempo_gestion_actual_tipo,
                total_antes, total_actual
            } = req.body;
            await db.run(
                `UPDATE savings SET
                    amount=$1, status=$2, date=$3,
                    costo_mensual=$4, costo_hora=$5,
                    tiempo_empleado_antes=$6, tiempo_empleado_actual=$7,
                    tiempo_gestion_antes=$8, tiempo_gestion_antes_tipo=$9,
                    tiempo_gestion_actual=$10, tiempo_gestion_actual_tipo=$11,
                    total_antes=$12, total_actual=$13
                WHERE id=$14`,
                [
                    amount ?? existing.amount,
                    status ?? existing.status,
                    date ?? existing.date,
                    costo_mensual ?? existing.costo_mensual,
                    costo_hora ?? existing.costo_hora,
                    tiempo_empleado_antes ?? existing.tiempo_empleado_antes,
                    tiempo_empleado_actual ?? existing.tiempo_empleado_actual,
                    tiempo_gestion_antes ?? existing.tiempo_gestion_antes,
                    tiempo_gestion_antes_tipo ?? existing.tiempo_gestion_antes_tipo,
                    tiempo_gestion_actual ?? existing.tiempo_gestion_actual,
                    tiempo_gestion_actual_tipo ?? existing.tiempo_gestion_actual_tipo,
                    total_antes ?? existing.total_antes,
                    total_actual ?? existing.total_actual,
                    req.params.id
                ]
            );
            const updated = await db.getRow('SELECT * FROM savings WHERE id = $1', [req.params.id]);
            res.json(updated);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al actualizar ahorro' });
        }
    });

    app.delete('/api/ahorros/:id', requireAdmin, async (req, res) => {
        try {
            const existing = await db.getRow('SELECT id FROM savings WHERE id = $1', [req.params.id]);
            if (!existing) return res.status(404).json({ error: 'Ahorro no encontrado' });
            await db.run('DELETE FROM savings WHERE id = $1', [req.params.id]);
            res.json({ message: 'Ahorro eliminado' });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al eliminar ahorro' });
        }
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
                SELECT p.*, s.amount AS savings_amount
                FROM projects p LEFT JOIN savings s ON s.project_id = p.id
                ORDER BY p.created_at DESC LIMIT 5
            `);
            res.json({ totalProyectos, ticketsAbiertos, ticketsCriticos, totalAhorros, recentProjects });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al obtener dashboard' });
        }
    });

    // ─── Inicio ────────────────────────────────────────────────────────────────
    app.listen(PORT, () => {
        console.log(`\n🚀 Servidor SyP corriendo en puerto ${PORT}`);
    });

}).catch(err => {
    console.error('❌ Error al inicializar la base de datos:', err);
    process.exit(1);
});