// ============================================================
//  MICROSERVICIO — AUTH  (puerto 3001)
//  POST /register   → registrar usuario normal
//  POST /login      → login (usuario normal y admin)
// ============================================================

const express = require('express');
const cors    = require('cors');
const db      = require('../db');

const app  = express();
const PORT = process.env.AUTH_PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Helper: leer saldos iniciales desde configuracion ────
async function getSaldosIniciales() {
  const [rows] = await db.query(
    "SELECT clave, valor FROM configuracion WHERE clave LIKE 'saldo_inicial_%'"
  );
  const cfg = {};
  rows.forEach(r => { cfg[r.clave] = parseFloat(r.valor) || 0; });
  return {
    COP: cfg['saldo_inicial_COP'] ?? 0,
    USD: cfg['saldo_inicial_USD'] ?? 0,
    EUR: cfg['saldo_inicial_EUR'] ?? 0
  };
}

// ── REGISTRO ─────────────────────────────────────────────
app.post('/register', async (req, res) => {
  const { nombre, cc, celular, password } = req.body;

  if (!nombre || !cc || !celular || !password)
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });

  try {
    const [result] = await db.query(
      `INSERT INTO usuarios (nombre, cc, celular, password, id_rol)
       VALUES (?, ?, ?, ?, (SELECT id_rol FROM roles WHERE nombre='usuario'))`,
      [nombre, cc, celular, password]
    );

    const idUsuario = result.insertId;

    // Leer saldos iniciales configurables desde la BD
    const saldos = await getSaldosIniciales();

    // Crear las 3 cuentas con saldo inicial configurable
    await db.query(`
      INSERT INTO cuentas (id_usuario, id_moneda, saldo) VALUES
        (?, (SELECT id_moneda FROM monedas WHERE codigo='COP'), ?),
        (?, (SELECT id_moneda FROM monedas WHERE codigo='USD'), ?),
        (?, (SELECT id_moneda FROM monedas WHERE codigo='EUR'), ?)
    `, [idUsuario, saldos.COP, idUsuario, saldos.USD, idUsuario, saldos.EUR]);

    res.json({ mensaje: 'Usuario y cuentas creadas con éxito' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'El usuario, celular o cédula ya existen.' });
  }
});

// ── LOGIN ────────────────────────────────────────────────
app.post('/login', async (req, res) => {
  const { celular, password } = req.body;

  if (!celular || !password)
    return res.status(400).json({ error: 'Celular y contraseña son obligatorios.' });

  try {
    const [rows] = await db.query(`
      SELECT u.id_usuario, u.nombre, u.cc, u.celular, u.status,
             r.nombre AS rol,
             m.codigo, c.saldo
      FROM usuarios u
      JOIN roles   r ON u.id_rol     = r.id_rol
      LEFT JOIN cuentas c ON u.id_usuario = c.id_usuario
      LEFT JOIN monedas m ON c.id_moneda  = m.id_moneda
      WHERE u.celular = ? AND u.password = ?
    `, [celular, password]);

    if (!rows.length)
      return res.status(401).json({ error: 'Credenciales inválidas.' });

    if (rows[0].status === 'suspendido')
      return res.status(403).json({ error: 'Cuenta suspendida. Contacta soporte.' });

    const user = {
      id:      rows[0].id_usuario,
      nombre:  rows[0].nombre,
      cc:      rows[0].cc,
      celular: rows[0].celular,
      status:  rows[0].status,
      rol:     rows[0].rol,
      saldo:   {}
    };

    rows.forEach(r => {
      if (r.codigo) user.saldo[r.codigo] = parseFloat(r.saldo);
    });

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.listen(PORT, () =>
  console.log(`🔐 Auth Service activo en http://localhost:${PORT}`)
);
