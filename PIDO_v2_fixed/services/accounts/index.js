// ============================================================
//  MICROSERVICIO — ACCOUNTS  (puerto 3002)
//  GET  /saldos/:idUsuario
//  POST /recargar        { idUsuario, moneda, monto }
//  GET  /movimientos/:idUsuario
// ============================================================

const express = require('express');
const cors    = require('cors');
const db      = require('../db');

const app  = express();
const PORT = process.env.ACCOUNTS_PORT || 3002;

app.use(cors());
app.use(express.json());

// ── SALDOS ───────────────────────────────────────────────
app.get('/saldos/:idUsuario', async (req, res) => {
  const { idUsuario } = req.params;
  try {
    const [rows] = await db.query(`
      SELECT m.codigo, c.saldo
      FROM cuentas c
      JOIN monedas m ON c.id_moneda = m.id_moneda
      WHERE c.id_usuario = ?
    `, [idUsuario]);

    const saldo = {};
    rows.forEach(r => saldo[r.codigo] = parseFloat(r.saldo));
    res.json(saldo);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener saldos.' });
  }
});

// ── RECARGA ──────────────────────────────────────────────
app.post('/recargar', async (req, res) => {
  const { idUsuario, moneda, monto } = req.body;

  if (!idUsuario || !moneda || !monto || monto <= 0)
    return res.status(400).json({ error: 'Datos inválidos.' });

  try {
    const [rows] = await db.query(`
      SELECT c.id_cuenta FROM cuentas c
      JOIN monedas m ON c.id_moneda = m.id_moneda
      WHERE c.id_usuario = ? AND m.codigo = ?
    `, [idUsuario, moneda]);

    if (!rows.length)
      return res.status(404).json({ error: 'Cuenta no encontrada.' });

    const idCuenta = rows[0].id_cuenta;

    await db.query('UPDATE cuentas SET saldo = saldo + ? WHERE id_cuenta = ?',
      [monto, idCuenta]);

    await db.query(`
      INSERT INTO movimientos (id_cuenta, tipo, monto, descripcion)
      VALUES (?, 'RECARGA', ?, ?)
    `, [idCuenta, monto, `Recarga ${moneda}`]);

    res.json({ mensaje: 'Recarga exitosa' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al recargar.' });
  }
});

// ── ACTUALIZAR DATOS PERSONALES ──────────────────────────
// Solo nombre y celular — CC e ID de cuenta son inmutables
app.put('/perfil/:idUsuario', async (req, res) => {
  const { idUsuario } = req.params;
  const { nombre, celular } = req.body;

  if (!nombre && !celular)
    return res.status(400).json({ error: 'Debes enviar al menos nombre o celular.' });

  const nombre_val  = nombre?.trim();
  const celular_val = celular?.trim();

  if (nombre_val  !== undefined && nombre_val  === '') return res.status(400).json({ error: 'El nombre no puede estar vacío.' });
  if (celular_val !== undefined && celular_val === '') return res.status(400).json({ error: 'El celular no puede estar vacío.' });

  try {
    const updates = [];
    const params  = [];

    if (nombre_val)  { updates.push('nombre = ?');  params.push(nombre_val); }
    if (celular_val) { updates.push('celular = ?'); params.push(celular_val); }
    params.push(idUsuario);

    await db.query(
      `UPDATE usuarios SET ${updates.join(', ')} WHERE id_usuario = ?`,
      params
    );

    // Devolver datos actualizados
    const [rows] = await db.query(
      'SELECT nombre, celular FROM usuarios WHERE id_usuario = ?',
      [idUsuario]
    );
    res.json({ mensaje: 'Perfil actualizado', ...rows[0] });
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ error: 'Ese número de celular ya está registrado.' });
    res.status(500).json({ error: 'Error al actualizar perfil.' });
  }
});

// ── MOVIMIENTOS ──────────────────────────────────────────
app.get('/movimientos/:idUsuario', async (req, res) => {
  const { idUsuario } = req.params;
  try {
    const [rows] = await db.query(`
      SELECT mv.tipo, mv.monto, mv.descripcion, mv.fecha, m.codigo
      FROM movimientos mv
      JOIN cuentas c ON mv.id_cuenta = c.id_cuenta
      JOIN monedas m ON c.id_moneda  = m.id_moneda
      WHERE c.id_usuario = ?
      ORDER BY mv.fecha DESC
      LIMIT 50
    `, [idUsuario]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener movimientos.' });
  }
});

app.listen(PORT, () =>
  console.log(`💳 Accounts Service activo en http://localhost:${PORT}`)
);
