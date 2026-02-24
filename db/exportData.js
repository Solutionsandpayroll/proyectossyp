// exportData.js — Exporta datos existentes como sentencias INSERT
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'syp.db');
const OUTPUT_PATH = path.join(__dirname, 'export.sql');

async function main() {
  const SQL = await initSqlJs();
  if (!fs.existsSync(DB_PATH)) {
    console.error('No se encontró la base de datos syp.db');
    return;
  }
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);

  const tables = ['projects', 'advances', 'tickets', 'savings'];
  let output = '';

  for (const table of tables) {
    const res = db.exec(`SELECT * FROM ${table}`);
    if (!res.length) continue;
    const columns = res[0].columns;
    for (const row of res[0].values) {
      const values = row.map(v =>
        v === null ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`
      );
      output += `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`;
    }
  }

  fs.writeFileSync(OUTPUT_PATH, output);
  console.log('Exportación completada. Revisa export.sql');
}

main();
