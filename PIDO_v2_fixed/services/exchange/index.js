// ============================================================
//  MICROSERVICIO — EXCHANGE  (puerto 3003)
//  GET  /tasas          → tasas actuales + metadatos
//  POST /cambio         { idUsuario, from, to, monto }
//  POST /tasas/sync-api → forzar sync con API externa (debug)
// ============================================================

const express = require('express');
const cors    = require('cors');
const https   = require('https');
const db      = require('../db');

const app  = express();
const PORT = process.env.EXCHANGE_PORT || 3003;

app.use(cors());
app.use(express.json());

// ── Fetch desde API externa (open.er-api.com — gratis, sin key) ──
async function fetchRatesFromAPI() {
  return new Promise((resolve, reject) => {
    https.get('https://open.er-api.com/v6/latest/USD', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.result !== 'success') return reject(new Error('API sin datos'));
          // Extraer solo lo que necesitamos
          const r = json.rates;
          resolve({
            USD_EUR: r.EUR,
            USD_COP: r.COP,
            EUR_USD: 1 / r.EUR,
            EUR_COP: r.COP / r.EUR,
            COP_USD: 1 / r.COP,
            COP_EUR: r.EUR / r.COP
          });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Guardar tasas en BD con fuente='api' ─────────────────
async function guardarTasasAPI(rates) {
  const pairs = [
    { from: 'USD', to: 'EUR', val: rates.USD_EUR },
    { from: 'USD', to: 'COP', val: rates.USD_COP },
    { from: 'EUR', to: 'USD', val: rates.EUR_USD },
    { from: 'EUR', to: 'COP', val: rates.EUR_COP },
    { from: 'COP', to: 'USD', val: rates.COP_USD },
    { from: 'COP', to: 'EUR', val: rates.COP_EUR }
  ];
  for (const p of pairs) {
    await db.query(`
      INSERT INTO tasas_cambio (moneda_origen, moneda_destino, tasa, fuente, actualizado_por)
      VALUES (
        (SELECT id_moneda FROM monedas WHERE codigo = ?),
        (SELECT id_moneda FROM monedas WHERE codigo = ?),
        ?, 'api', NULL
      )
    `, [p.from, p.to, p.val]);
  }
  console.log('✅ Tasas actualizadas desde API externa:', new Date().toISOString());
}

// ── Verificar si ya se actualizó hoy ─────────────────────
async function yaActualizadoHoy() {
  const [rows] = await db.query(`
    SELECT COUNT(*) AS cnt FROM tasas_cambio
    WHERE fuente = 'api'
      AND DATE(fecha) = CURDATE()
  `);
  return rows[0].cnt > 0;
}

// ── Sincronización diaria con API ────────────────────────
async function syncDiaria() {
  try {
    const yaHoy = await yaActualizadoHoy();
    if (yaHoy) {
      console.log('ℹ️  Tasas API ya actualizadas hoy, omitiendo sync.');
      return;
    }
    const rates = await fetchRatesFromAPI();
    await guardarTasasAPI(rates);
  } catch (err) {
    console.error('⚠️  Error al sincronizar tasas con API:', err.message);
  }
}

// Ejecutar al iniciar y luego cada 24h
syncDiaria();
setInterval(syncDiaria, 24 * 60 * 60 * 1000);

// ── TASAS DE CAMBIO (con metadatos) ──────────────────────
app.get('/tasas', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT mo.codigo AS origen, md.codigo AS destino,
             tc.tasa, tc.fuente, tc.fecha,
             u.nombre AS admin_nombre
      FROM tasas_cambio tc
      JOIN monedas mo ON tc.moneda_origen  = mo.id_moneda
      JOIN monedas md ON tc.moneda_destino = md.id_moneda
      LEFT JOIN usuarios u ON tc.actualizado_por = u.id_usuario
      WHERE tc.id_tasa IN (
        SELECT MAX(id_tasa) FROM tasas_cambio GROUP BY moneda_origen, moneda_destino
      )
    `);

    const tasas = {};
    const meta  = {};  // metadatos para el admin

    rows.forEach(r => {
      if (!tasas[r.origen]) { tasas[r.origen] = {}; meta[r.origen] = {}; }
      tasas[r.origen][r.destino] = parseFloat(r.tasa);
      meta[r.origen][r.destino]  = {
        fuente:       r.fuente,
        fecha:        r.fecha,
        admin_nombre: r.admin_nombre || null
      };
    });

    ['COP','USD','EUR'].forEach(c => {
      if (!tasas[c]) { tasas[c] = {}; meta[c] = {}; }
      tasas[c][c] = 1;
    });

    res.json({ tasas, meta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener tasas.' });
  }
});

// ── FORZAR SYNC MANUAL (útil para testing) ───────────────
app.post('/tasas/sync-api', async (req, res) => {
  try {
    const rates = await fetchRatesFromAPI();
    await guardarTasasAPI(rates);
    res.json({ mensaje: 'Tasas sincronizadas desde API', fecha: new Date() });
  } catch (err) {
    res.status(500).json({ error: 'Error al sincronizar: ' + err.message });
  }
});

// ── CAMBIO DE DIVISA ─────────────────────────────────────
app.post('/cambio', async (req, res) => {
  const { idUsuario, from, to, monto } = req.body;

  if (!idUsuario || !from || !to || !monto || monto <= 0)
    return res.status(400).json({ error: 'Datos inválidos.' });

  if (from === to)
    return res.status(400).json({ error: 'Las monedas deben ser diferentes.' });

  try {
    const [cuentaOrigen] = await db.query(`
      SELECT c.saldo, c.id_cuenta
      FROM cuentas c
      JOIN monedas m ON c.id_moneda = m.id_moneda
      WHERE c.id_usuario = ? AND m.codigo = ?
    `, [idUsuario, from]);

    if (!cuentaOrigen.length)
      return res.status(404).json({ error: 'Cuenta origen no encontrada.' });

    if (parseFloat(cuentaOrigen[0].saldo) < monto)
      return res.status(400).json({ error: 'Saldo insuficiente.' });

    const [tasaRow] = await db.query(`
      SELECT tasa FROM tasas_cambio
      WHERE moneda_origen  = (SELECT id_moneda FROM monedas WHERE codigo = ?)
        AND moneda_destino = (SELECT id_moneda FROM monedas WHERE codigo = ?)
      ORDER BY fecha DESC LIMIT 1
    `, [from, to]);

    if (!tasaRow.length)
      return res.status(404).json({ error: 'Tasa de cambio no encontrada.' });

    const convertido  = parseFloat((monto * tasaRow[0].tasa).toFixed(2));
    const idCuentaOri = cuentaOrigen[0].id_cuenta;

    await db.query(`
      UPDATE cuentas SET saldo = saldo - ?
        WHERE id_usuario = ? AND id_moneda = (SELECT id_moneda FROM monedas WHERE codigo = ?);
      UPDATE cuentas SET saldo = saldo + ?
        WHERE id_usuario = ? AND id_moneda = (SELECT id_moneda FROM monedas WHERE codigo = ?);
    `, [monto, idUsuario, from, convertido, idUsuario, to]);

    await db.query(`
      INSERT INTO movimientos (id_cuenta, tipo, monto, descripcion)
      VALUES (?, 'CAMBIO', ?, ?)
    `, [idCuentaOri, monto, `${from} → ${to}: ${convertido} ${to}`]);

    res.json({ mensaje: 'Cambio realizado', convertido });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al realizar el cambio.' });
  }
});

app.listen(PORT, () =>
  console.log(`💱 Exchange Service activo en http://localhost:${PORT}`)
);
