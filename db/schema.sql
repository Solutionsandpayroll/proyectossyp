-- Solutions & Payroll — Esquema de base de datos

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(50) NOT NULL UNIQUE,
  email      TEXT        UNIQUE,
  password   TEXT        NOT NULL,
  role       VARCHAR(20) NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  area        TEXT NOT NULL,
  leader      TEXT NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'En Progreso',
  progress    INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS advances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  date        DATE NOT NULL,
  progress    INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        DATE NOT NULL,
  subject     TEXT NOT NULL,
  description TEXT NOT NULL,
  priority    TEXT NOT NULL DEFAULT 'Media' CHECK(priority IN ('Baja','Media','Alta','Critica')),
  attachment  TEXT,
  status      TEXT NOT NULL DEFAULT 'Abierto' CHECK(status IN ('Abierto','En Revisión','Cerrado')),
  email       TEXT,
  user_id     INTEGER REFERENCES users(id),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS savings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  amount      REAL NOT NULL CHECK(amount >= 0),
  status      TEXT NOT NULL DEFAULT 'Proyectado' CHECK(status IN ('Proyectado','Pendiente','Realizado')),
  date        DATE NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
