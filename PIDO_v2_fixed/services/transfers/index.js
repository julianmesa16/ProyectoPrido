// ============================================================
//  MICROSERVICIO — TRANSFERS  (puerto 3004)
//
//  Las transferencias entre usuarios SOLO se hacen en USD.
//
//  POST /transferir
//       { idOrigen, celularDestino, montoUSD, descripcion? }
//
//  GET  /historial/:idUsuario
//       Devuelve transferencias enviadas y recibidas
// ============================================================

const express = require('express');
const cors    = require('cors');
const db      = require('../db');

const app  = express();
const PORT = process.env.TRANSFERS_PORT || 3004;

app.use(cors());
app.use(express.json());

// ── TRANSFERIR (solo USD) ────────────────────────────────
app.post('/transferir', async (req, res) => {
  const { idOrigen, celularDestino, montoUSD, descripcion } = req.body;

  // ── Validaciones básicas
  if (!idOrigen || !celularDestino || !montoUSD)
    return res.status(400).json({ error: 'Campos obligatorios: idOrigen, celularDestino, montoUSD.' });

  const monto = parseFloat(montoUSD);
  if (isNaN(monto) || monto <= 0)
    return res.status(400).json({ error: 'El monto en USD debe ser mayor que 0.' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Buscar usuario destino por celular
    const [destRows] = await conn.query(
      `SELECT u.id_usuario, u.nombre, u.status,
              c.id_cuenta, c.saldo
       FROM usuarios u
       JOIN cuentas c ON u.id_usuario = c.id_usuario
       JOIN monedas m ON c.id_moneda  = m.id_moneda
       WHERE u.celular = ? AND m.codigo = 'USD'`,
      [celularDestino]
    );

    if (!destRows.length)
      throw { status: 404, msg: 'Usuario destino no encontrado o no tiene cuenta USD.' };

    const dest = destRows[0];

    if (dest.status === 'suspendido')
      throw { status: 403, msg: 'La cuenta destino está suspendida.' };

    if (dest.id_usuario === parseInt(idOrigen))
      throw { status: 400, msg: 'No puedes transferirte a ti mismo.' };

    // 2. Cuenta USD del origen
    const [origRows] = await conn.query(
      `SELECT c.id_cuenta, c.saldo
       FROM cuentas c
       JOIN monedas m ON c.id_moneda = m.id_moneda
       WHERE c.id_usuario = ? AND m.codigo = 'USD'`,
      [idOrigen]
    );

    if (!origRows.length)
      throw { status: 404, msg: 'No tienes cuenta USD activa.' };

    const orig = origRows[0];

    if (parseFloat(orig.saldo) < monto)
      throw { status: 400, msg: `Saldo USD insuficiente. Disponible: $${parseFloat(orig.saldo).toFixed(2)}` };

    // 3. Mover fondos
    await conn.query(
      'UPDATE cuentas SET saldo = saldo - ? WHERE id_cuenta = ?',
      [monto, orig.id_cuenta]
    );
    await conn.query(
      'UPDATE cuentas SET saldo = saldo + ? WHERE id_cuenta = ?',
      [monto, dest.id_cuenta]
    );

    // 4. Registrar en tabla transferencias
    const desc = descripcion || `Transferencia USD a ${dest.nombre}`;
    const [transferResult] = await conn.query(`
      INSERT INTO transferencias (cuenta_origen, cuenta_destino, monto_usd, descripcion)
      VALUES (?, ?, ?, ?)
    `, [orig.id_cuenta, dest.id_cuenta, monto, desc]);

    // 5. Registrar movimientos en ambas cuentas
    await conn.query(`
      INSERT INTO movimientos (id_cuenta, tipo, monto, descripcion) VALUES
        (?, 'TRANSFERENCIA', ?, ?),
        (?, 'TRANSFERENCIA', ?, ?)
    `, [
      orig.id_cuenta, monto,  `Enviaste $${monto} USD a ${dest.nombre}`,
      dest.id_cuenta, monto,  `Recibiste $${monto} USD de transferencia`
    ]);

    await conn.commit();

    res.json({
      mensaje:          'Transferencia realizada con éxito',
      id_transferencia: transferResult.insertId,
      monto_usd:        monto,
      destinatario:     dest.nombre
    });

  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ error: err.msg });
    console.error(err);
    res.status(500).json({ error: 'Error interno al realizar la transferencia.' });
  } finally {
    conn.release();
  }
});

// ── HISTORIAL DE TRANSFERENCIAS ──────────────────────────
app.get('/historial/:idUsuario', async (req, res) => {
  const { idUsuario } = req.params;
  try {
    const [rows] = await db.query(`
      SELECT
        t.id_transferencia,
        t.monto_usd,
        t.descripcion,
        t.estado,
        t.fecha,
        uo.nombre AS nombre_origen,
        ud.nombre AS nombre_destino,
        CASE WHEN co.id_usuario = ? THEN 'enviada' ELSE 'recibida' END AS direccion
      FROM transferencias t
      JOIN cuentas co ON t.cuenta_origen  = co.id_cuenta
      JOIN cuentas cd ON t.cuenta_destino = cd.id_cuenta
      JOIN usuarios uo ON co.id_usuario   = uo.id_usuario
      JOIN usuarios ud ON cd.id_usuario   = ud.id_usuario
      WHERE co.id_usuario = ? OR cd.id_usuario = ?
      ORDER BY t.fecha DESC
      LIMIT 50
    `, [idUsuario, idUsuario, idUsuario]);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener historial de transferencias.' });
  }
});

app.listen(PORT, () =>
  console.log(`↗️  Transfers Service activo en http://localhost:${PORT}`)
);
