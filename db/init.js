// db/init.js — Inicializador con PostgreSQL (Neon)
const { Pool } = require('pg');
require('dotenv').config();

let dbInstance = null;

async function initDb() {
  if (dbInstance) return dbInstance;

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // requerido por Neon
  });

  // Crear tablas si no existen
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id          SERIAL PRIMARY KEY,
      area        TEXT NOT NULL,
      encargado   TEXT NOT NULL DEFAULT '',
      leader      TEXT NOT NULL,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'En Progreso',
      progress    INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS advances (
      id          SERIAL PRIMARY KEY,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      date        DATE NOT NULL,
      progress    INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id          SERIAL PRIMARY KEY,
      date        DATE NOT NULL,
      subject     TEXT NOT NULL,
      description TEXT NOT NULL,
      priority    TEXT NOT NULL DEFAULT 'Media',
      attachment  TEXT,
      status      TEXT NOT NULL DEFAULT 'Abierto',
      created_at  TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS savings (
      id                          SERIAL PRIMARY KEY,
      project_id                  INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      amount                      REAL NOT NULL,
      status                      TEXT NOT NULL DEFAULT 'Proyectado',
      date                        DATE NOT NULL,
      costo_mensual               REAL NOT NULL DEFAULT 0,
      costo_hora                  REAL NOT NULL DEFAULT 0,
      tiempo_empleado_antes       REAL NOT NULL DEFAULT 0,
      tiempo_empleado_actual      REAL NOT NULL DEFAULT 0,
      tiempo_gestion_antes        REAL NOT NULL DEFAULT 0,
      tiempo_gestion_antes_tipo   TEXT NOT NULL DEFAULT 'Mensual',
      tiempo_gestion_actual       REAL NOT NULL DEFAULT 0,
      tiempo_gestion_actual_tipo  TEXT NOT NULL DEFAULT 'Mensual',
      total_antes                 REAL NOT NULL DEFAULT 0,
      total_actual                REAL NOT NULL DEFAULT 0,
      created_at                  TIMESTAMP DEFAULT NOW()
    );
  `);

  // ── Helpers que imitan la API anterior ──────────────────────────────────────

  const db = {
    // Ejecutar sin retorno
    run: (sql, params = []) => pool.query(sql, params),

    // Obtener una sola fila
    getRow: async (sql, params = []) => {
      const result = await pool.query(sql, params);
      return result.rows[0] || null;
    },

    // Obtener múltiples filas
    getAll: async (sql, params = []) => {
      const result = await pool.query(sql, params);
      return result.rows;
    },

    // Insertar y devolver el id
    runAndSave: async (sql, params = []) => {
      // Agrega RETURNING id automáticamente si no lo tiene
      const returning = sql.trimEnd().toUpperCase().includes('RETURNING')
        ? sql
        : sql.trimEnd() + ' RETURNING id';
      const result = await pool.query(returning, params);
      return result.rows[0].id;
    },

    // save() ya no hace falta (Postgres persiste solo), pero lo dejamos por si acaso
    save: () => Promise.resolve()
  };

  dbInstance = db;
  console.log('✅ Conectado a PostgreSQL (Neon)');
  return db;
}

module.exports = initDb;