// ── db.js — Conexión compartida a MySQL Workbench ──────────
// Ajusta host, user y password según tu instalación de MySQL Workbench.
// Puerto por defecto de MySQL: 3306

const mysql = require('mysql2');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '1234', 
  database:           process.env.DB_NAME     || 'pido_db',
  waitForConnections: true,
  connectionLimit:    10,
  multipleStatements: true
});

// Verificar conexión al iniciar
pool.getConnection((err, conn) => {
  if (err) {
    console.error('❌ Error conectando a MySQL Workbench:', err.message);
    process.exit(1);
  }
  console.log('✅ Conectado a MySQL Workbench (pido_db) en puerto', process.env.DB_PORT || 3306);
  conn.release();
});

module.exports = pool.promise();
