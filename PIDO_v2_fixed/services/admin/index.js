// ============================================================
//  MICROSERVICIO — ADMIN  (puerto 3005)
//  GET    /admin/usuarios
//  POST   /admin/usuario/:id/status   { status }
//  DELETE /admin/usuario/:id
//  GET    /admin/movimientos
//  POST   /admin/tasa                 { from, to, tasa }
//  GET    /admin/configuracion
//  POST   /admin/configuracion        { clave, valor }
// ============================================================

const express = require('express');
const cors    = require('cors');
const db      = require('../db');

const app  = express();
const PORT = process.env.ADMIN_PORT || 3005;

app.use(cors());
app.use(express.json());

// ── Middleware: solo admins ──────────────────────────────
async function soloAdmin(req, res, next) {
  const adminId = req.headers['x-admin-id'];
  if (!adminId) return res.status(401).json({ error: 'No autorizado.' });

  try {
    const [rows] = await db.query(
      `SELECT 1 FROM usuarios u
       JOIN roles r ON u.id_rol = r.id_rol
       WHERE u.id_usuario = ? AND r.nombre = 'admin'`,
      [adminId]
    );
    if (!rows.length) return res.status(403).json({ error: 'Acceso solo para administradores.' });
    next();
  } catch {
    res.status(500).json({ error: 'Error de autenticación.' });
  }
}

// ── TODOS LOS USUARIOS ───────────────────────────────────
app.get('/admin/usuarios', soloAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.id_usuario, u.nombre, u.cc, u.celular, u.status, u.fecha_registro,
             m.codigo, c.saldo
      FROM usuarios u
      JOIN roles r ON u.id_rol = r.id_rol
      JOIN cuentas c ON u.id_usuario = c.id_usuario
      JOIN monedas m ON c.id_moneda  = m.id_moneda
      WHERE r.nombre = 'usuario'
      ORDER BY u.id_usuario
    `);

    const map = {};
    rows.forEach(r => {
      if (!map[r.id_usuario]) {
        map[r.id_usuario] = {
          id: r.id_usuario, nombre: r.nombre, cc: r.cc,
          celular: r.celular, status: r.status,
          fecha_registro: r.fecha_registro, saldo: {}
        };
      }
      map[r.id_usuario].saldo[r.codigo] = parseFloat(r.saldo);
    });

    res.json(Object.values(map));
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios.' });
  }
});

// ── CAMBIAR STATUS ───────────────────────────────────────
app.post('/admin/usuario/:id/status', soloAdmin, async (req, res) => {
  const { id }     = req.params;
  const { status } = req.body;

  if (!['activo','suspendido'].includes(status))
    return res.status(400).json({ error: 'Status inválido.' });

  try {
    await db.query('UPDATE usuarios SET status = ? WHERE id_usuario = ?', [status, id]);
    res.json({ mensaje: `Usuario ${status}` });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar status.' });
  }
});

// ── ELIMINAR USUARIO ─────────────────────────────────────
app.delete('/admin/usuario/:id', soloAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM usuarios WHERE id_usuario = ?', [id]);
    res.json({ mensaje: 'Usuario eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar usuario.' });
  }
});

// ── TODOS LOS MOVIMIENTOS ────────────────────────────────
app.get('/admin/movimientos', soloAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT mv.tipo, mv.monto, mv.descripcion, mv.fecha,
             u.nombre, u.id_usuario, m.codigo
      FROM movimientos mv
      JOIN cuentas c  ON mv.id_cuenta = c.id_cuenta
      JOIN usuarios u ON c.id_usuario = u.id_usuario
      JOIN monedas m  ON c.id_moneda  = m.id_moneda
      ORDER BY mv.fecha DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener movimientos.' });
  }
});

// ── ACTUALIZAR TASA (registra quién lo hizo) ─────────────
app.post('/admin/tasa', soloAdmin, async (req, res) => {
  const { from, to, tasa } = req.body;
  const adminId = req.headers['x-admin-id'];

  if (!from || !to || tasa === undefined || tasa === null || tasa === '')
    return res.status(400).json({ error: 'Datos incompletos.' });

  const tasaNum = parseFloat(tasa);
  if (isNaN(tasaNum) || tasaNum < 0)
    return res.status(400).json({ error: 'Tasa inválida.' });

  try {
    await db.query(`
      INSERT INTO tasas_cambio (moneda_origen, moneda_destino, tasa, fuente, actualizado_por)
      VALUES (
        (SELECT id_moneda FROM monedas WHERE codigo = ?),
        (SELECT id_moneda FROM monedas WHERE codigo = ?),
        ?, 'manual', ?
      )
    `, [from, to, tasaNum, adminId]);
    res.json({ mensaje: 'Tasa actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar tasa.' });
  }
});

// ── LEER CONFIGURACIÓN ───────────────────────────────────
app.get('/admin/configuracion', soloAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT clave, valor, descripcion FROM configuracion');
    const cfg = {};
    rows.forEach(r => { cfg[r.clave] = { valor: r.valor, descripcion: r.descripcion }; });
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener configuración.' });
  }
});

// ── GUARDAR CONFIGURACIÓN ────────────────────────────────
app.post('/admin/configuracion', soloAdmin, async (req, res) => {
  const { clave, valor } = req.body;

  if (!clave || valor === undefined || valor === null)
    return res.status(400).json({ error: 'Clave y valor son obligatorios.' });

  // Solo permite claves conocidas (seguridad)
  const CLAVES_PERMITIDAS = ['saldo_inicial_COP', 'saldo_inicial_USD', 'saldo_inicial_EUR'];
  if (!CLAVES_PERMITIDAS.includes(clave))
    return res.status(400).json({ error: 'Clave de configuración no permitida.' });

  const val = parseFloat(valor);
  if (isNaN(val) || val < 0)
    return res.status(400).json({ error: 'Valor inválido. Debe ser un número >= 0.' });

  try {
    await db.query(
      'INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = ?',
      [clave, val.toString(), val.toString()]
    );
    res.json({ mensaje: 'Configuración guardada', clave, valor: val });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar configuración.' });
  }
});

app.listen(PORT, () =>
  console.log(`🛡️  Admin Service activo en http://localhost:${PORT}`)
);
