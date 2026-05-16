// ══════════════════════════════════════════════════════
//  CONFIGURACIÓN — MICROSERVICIOS
//  Cada módulo apunta a su propio servicio independiente
// ══════════════════════════════════════════════════════

const SERVICES = {
  auth:      'http://localhost:3001',
  accounts:  'http://localhost:3002',
  exchange:  'http://localhost:3003',
  transfers: 'http://localhost:3004',
  admin:     'http://localhost:3005'
};

const FLAGS    = { COP: '🇨🇴', USD: '🇺🇸', EUR: '🇪🇺' };
const NAMES    = { COP: 'Peso colombiano', USD: 'Dólar', EUR: 'Euro' };
const MOV_ICONS = { CAMBIO: '💱', RECARGA: '⬆️', TRANSFERENCIA: '↗️' };

let currentUser    = null;
let tasas          = {};
let selectedUserId = null;

// ══════════════════════════════════════════════════════
//  HELPER FETCH (apunta al servicio correcto)
// ══════════════════════════════════════════════════════

async function apiFetch(service, path, method = 'GET', body = null) {
  const base = SERVICES[service];
  const opts = { method, headers: { 'Content-Type': 'application/json' } };

  // Enviar id del admin en header para rutas protegidas
  if (service === 'admin' && currentUser?.rol === 'admin')
    opts.headers['x-admin-id'] = currentUser.id;

  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(base + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

// ══════════════════════════════════════════════════════
//  NAVEGACIÓN
// ══════════════════════════════════════════════════════

function mostrarPantalla(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');

  const userScreens = ['u-inicio','u-movimientos','u-cambio','u-tasas','u-perfil','u-transferencias'];
  const isUserScreen = userScreens.includes(id);
  const topbar = document.getElementById('topbar');
  const tabNav = document.getElementById('tabNav');
  if (topbar) topbar.style.display = isUserScreen ? 'flex' : 'none';
  if (tabNav) tabNav.style.display = isUserScreen ? 'flex' : 'none';
}

function mostrarLogin()    { mostrarPantalla('login'); }
function mostrarRegistro() { mostrarPantalla('register'); }

function showTab(id) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById(id);
  if (pane) pane.classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b => {
    if (b.dataset.tab === id) b.classList.add('active');
  });

  if (id === 'u-movimientos')    cargarMovimientosUsuario('all');
  if (id === 'u-tasas')          renderTasasGrid();
  if (id === 'u-perfil')         renderPerfil();
  if (id === 'u-transferencias') cargarHistorialTransferencias();
}

// ══════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════

async function login() {
  const cel   = document.getElementById('loginCel').value.trim();
  const pass  = document.getElementById('loginPass').value.trim();
  const errEl = document.getElementById('loginError');
  errEl.style.display = 'none';

  try {
    const user = await apiFetch('auth', '/login', 'POST', { celular: cel, password: pass });
    currentUser = user;

    if (user.rol === 'admin') {
      window.location.href = 'Admin.html?adminId=' + user.id;
      return;
    }

    await cargarTasas();
    initUserApp();
  } catch (err) {
    errEl.textContent   = err.message;
    errEl.style.display = 'block';
  }
}

// ── TÉRMINOS Y CONDICIONES ───────────────────────────────
// Carga el texto desde el archivo .txt del servidor
async function mostrarTerminos() {
  const nombre = document.getElementById('nombre').value.trim();
  const cc     = document.getElementById('cc').value.trim();
  const cel    = document.getElementById('celular').value.trim();
  const pass   = document.getElementById('pass').value.trim();

  if (!nombre || !cc || !cel || !pass) { showToast('⚠️ Completa todos los campos.'); return; }

  // Cargar texto de términos si aún no está cargado
  const contenido = document.getElementById('terminosContenido');
  if (!contenido.textContent.trim()) {
    try {
      const resp = await fetch('terminos_y_condiciones.txt');
      contenido.textContent = await resp.text();
    } catch(e) {
      contenido.textContent = 'No se pudo cargar el texto de términos. Contacte al administrador.';
    }
  }

  document.getElementById('checkTerminos').checked = false;
  document.getElementById('modalTerminos').classList.add('open');
}

function cerrarTerminos() {
  document.getElementById('modalTerminos').classList.remove('open');
}

async function confirmarTerminos() {
  if (!document.getElementById('checkTerminos').checked) {
    showToast('⚠️ Debes aceptar los términos para continuar.'); return;
  }
  cerrarTerminos();
  await registrar();
}

async function registrar() {
  const nombre = document.getElementById('nombre').value.trim();
  const cc     = document.getElementById('cc').value.trim();
  const cel    = document.getElementById('celular').value.trim();
  const pass   = document.getElementById('pass').value.trim();

  if (!nombre || !cc || !cel || !pass) { showToast('⚠️ Completa todos los campos.'); return; }

  try {
    await apiFetch('auth', '/register', 'POST', { nombre, cc, celular: cel, password: pass });
    showToast('🎉 Cuenta creada. Iniciando sesión...');
    document.getElementById('loginCel').value  = cel;
    document.getElementById('loginPass').value = pass;
    await login();
  } catch (err) {
    showToast('❌ ' + err.message);
  }
}

// ── EDITAR PERFIL USUARIO ────────────────────────────────
function abrirEditarPerfil() {
  document.getElementById('editNombre').value  = currentUser.nombre  || '';
  document.getElementById('editCelular').value = currentUser.celular || '';
  document.getElementById('modalEditarPerfil').classList.add('open');
}

function cerrarEditarPerfil() {
  document.getElementById('modalEditarPerfil').classList.remove('open');
}

async function guardarPerfil() {
  const nombre  = document.getElementById('editNombre').value.trim();
  const celular = document.getElementById('editCelular').value.trim();

  if (!nombre && !celular) { showToast('⚠️ Ingresa al menos un campo.'); return; }

  try {
    const body = {};
    if (nombre)  body.nombre  = nombre;
    if (celular) body.celular = celular;

    const result = await apiFetch('accounts', `/perfil/${currentUser.id}`, 'PUT', body);
    if (result.nombre)  currentUser.nombre  = result.nombre;
    if (result.celular) currentUser.celular = result.celular;

    cerrarEditarPerfil();
    renderPerfil();
    // Actualizar topbar
    document.getElementById('topAvatar').textContent = currentUser.nombre[0].toUpperCase();
    document.getElementById('topName').textContent   = currentUser.nombre.split(' ')[0];
    showToast('✅ Perfil actualizado correctamente');
  } catch(err) {
    showToast('❌ ' + err.message);
  }
}

function cerrarSesion() {
  currentUser = null;
  document.getElementById('loginCel').value  = '';
  document.getElementById('loginPass').value = '';
  mostrarLogin();
}

// ══════════════════════════════════════════════════════
//  INICIALIZAR APP USUARIO
// ══════════════════════════════════════════════════════

async function initUserApp() {
  const u = currentUser;
  document.getElementById('topAvatar').textContent = u.nombre[0].toUpperCase();
  document.getElementById('topName').textContent   = u.nombre.split(' ')[0];

  actualizarSaldos();
  await cargarMovimientosUsuario('all', true);
  renderTasasGrid();
  renderPerfil();
  updateCambioUI();
  mostrarPantalla('u-inicio');
  showTab('u-inicio');
}

// ══════════════════════════════════════════════════════
//  SALDOS  (Accounts Service)
// ══════════════════════════════════════════════════════

async function refrescarSaldos() {
  try {
    const saldo = await apiFetch('accounts', `/saldos/${currentUser.id}`);
    currentUser.saldo = saldo;
    actualizarSaldos();
  } catch(e) { /* silencioso */ }
}

function actualizarSaldos() {
  const u = currentUser;
  if (!u) return;
  const fmt = v => parseFloat(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  document.getElementById('saldoCOP').textContent = fmt(u.saldo.COP);
  document.getElementById('saldoUSD').textContent = fmt(u.saldo.USD);
  document.getElementById('saldoEUR').textContent = fmt(u.saldo.EUR);
  updateFromBalance();
}

// ══════════════════════════════════════════════════════
//  TASAS  (Exchange Service)
// ══════════════════════════════════════════════════════

let tasasMeta = {}; // metadatos de tasas (fuente, fecha, admin) — solo visibles para admins

async function cargarTasas() {
  try {
    const resp = await apiFetch('exchange', '/tasas');
    // El exchange service ahora devuelve { tasas, meta }
    if (resp && resp.tasas) {
      tasas     = resp.tasas;
      tasasMeta = resp.meta || {};
    } else {
      // Fallback: si por alguna razón llega el objeto plano antiguo
      tasas = resp;
    }
  } catch(e) {
    tasas = {
      COP: { USD: 0.000238, EUR: 0.000222, COP: 1 },
      USD: { COP: 4200, EUR: 0.92, USD: 1 },
      EUR: { COP: 4500, USD: 1.08, EUR: 1 }
    };
  }
}

function renderTasasGrid() {
  const div = document.getElementById('tasasGrid');
  if (!div) return;
  const pairs = [
    { from:'USD', to:'COP' }, { from:'EUR', to:'COP' },
    { from:'USD', to:'EUR' }, { from:'EUR', to:'USD' },
    { from:'COP', to:'USD' }, { from:'COP', to:'EUR' }
  ];
  div.innerHTML = pairs.map(p => {
    const val = tasas[p.from]?.[p.to] ?? '—';
    const display = typeof val === 'number'
      ? val.toLocaleString('es-CO', { maximumFractionDigits: 6 }) : val;
    return `
      <div class="tasa-card">
        <div>
          <div class="tasa-pair">${FLAGS[p.from]} ${p.from} / ${FLAGS[p.to]} ${p.to}</div>
          <div class="tasa-subtitle">1 ${NAMES[p.from]}</div>
        </div>
        <div>
          <div class="tasa-value">${display}</div>
          <div class="tasa-subtitle" style="text-align:right">${p.to}</div>
        </div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════
//  CAMBIO DE DIVISAS  (Exchange Service)
// ══════════════════════════════════════════════════════

function updateCambioUI() {
  const from  = document.getElementById('fromCurrency')?.value || 'USD';
  const to    = document.getElementById('toCurrency')?.value   || 'EUR';
  const monto = parseFloat(document.getElementById('montoCambio')?.value);

  const set = (id, val) => { const e = document.getElementById(id); if(e) e.textContent = val; };
  set('fromFlag', FLAGS[from]);
  set('toFlag',   FLAGS[to]);
  set('fromName', NAMES[from]);
  set('toName',   NAMES[to]);
  updateFromBalance();

  const preview = document.getElementById('resultPreview');
  if (!preview) return;
  const tasa = tasas[from]?.[to];
  if (!isNaN(monto) && monto > 0 && from !== to && tasa) {
    const result = (monto * tasa).toLocaleString('es-CO', { maximumFractionDigits: 2 });
    preview.innerHTML = `<div class="result-label">Recibirás</div><div class="result-amount">${result} ${to}</div>`;
  } else {
    preview.innerHTML = `<div class="result-label">Recibirás</div><div class="result-amount">—</div>`;
  }
}

function updateFromBalance() {
  if (!currentUser) return;
  const from = document.getElementById('fromCurrency')?.value;
  const to   = document.getElementById('toCurrency')?.value;
  const fmt  = v => parseFloat(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  if (from && document.getElementById('fromBalance'))
    document.getElementById('fromBalance').textContent = 'Saldo: ' + fmt(currentUser.saldo[from]) + ' ' + from;
  if (to && document.getElementById('toBalance'))
    document.getElementById('toBalance').textContent   = 'Saldo: ' + fmt(currentUser.saldo[to])   + ' ' + to;
}

function swapCurrencies() {
  const from = document.getElementById('fromCurrency');
  const to   = document.getElementById('toCurrency');
  const tmp  = from.value;
  from.value = to.value;
  to.value   = tmp;
  updateCambioUI();
}

async function convertirMoneda() {
  if (!currentUser) return;
  const from  = document.getElementById('fromCurrency').value;
  const to    = document.getElementById('toCurrency').value;
  const monto = parseFloat(document.getElementById('montoCambio').value);

  if (from === to)                              { showToast('⚠️ Selecciona monedas diferentes'); return; }
  if (isNaN(monto) || monto <= 0)              { showToast('⚠️ Ingresa un monto válido'); return; }
  if ((currentUser.saldo[from] || 0) < monto) { showToast('❌ Saldo insuficiente en ' + from); return; }

  try {
    const data = await apiFetch('exchange', '/cambio', 'POST',
      { idUsuario: currentUser.id, from, to, monto });
    document.getElementById('montoCambio').value = '';
    await refrescarSaldos();
    await cargarMovimientosUsuario('all', true);
    updateCambioUI();
    renderPerfil();
    showToast(`✅ ${monto.toLocaleString()} ${from} → ${data.convertido.toLocaleString()} ${to}`);
  } catch(err) {
    showToast('❌ ' + err.message);
  }
}

// ══════════════════════════════════════════════════════
//  RECARGA  (Accounts Service)
// ══════════════════════════════════════════════════════

function openRecarga() {
  document.getElementById('modalRecarga').classList.add('open');
}
function closeRecarga() {
  document.getElementById('modalRecarga').classList.remove('open');
  document.getElementById('montoRecarga').value = '';
}

async function recargarCuenta() {
  if (!currentUser) return;
  const monto  = parseFloat(document.getElementById('montoRecarga').value);
  const moneda = document.getElementById('monedaRecarga').value;

  if (isNaN(monto) || monto <= 0) { showToast('⚠️ Monto inválido'); return; }

  try {
    await apiFetch('accounts', '/recargar', 'POST',
      { idUsuario: currentUser.id, moneda, monto });
    closeRecarga();
    await refrescarSaldos();
    await cargarMovimientosUsuario('all', true);
    renderPerfil();
    showToast('💰 +' + monto.toLocaleString() + ' ' + moneda + ' recargados');
  } catch(err) {
    showToast('❌ ' + err.message);
  }
}

// ══════════════════════════════════════════════════════
//  TRANSFERENCIAS USD  (Transfers Service)
// ══════════════════════════════════════════════════════

function openTransferencia() {
  document.getElementById('modalTransferencia').classList.add('open');
  // Mostrar saldo USD disponible
  const fmt = v => parseFloat(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const el  = document.getElementById('transferUSDBalance');
  if (el) el.textContent = 'Disponible: $' + fmt(currentUser?.saldo?.USD) + ' USD';
  document.getElementById('transferError').style.display  = 'none';
  document.getElementById('transferResult').style.display = 'none';
}

function closeTransferencia() {
  document.getElementById('modalTransferencia').classList.remove('open');
  document.getElementById('transferCelular').value = '';
  document.getElementById('transferMonto').value   = '';
  document.getElementById('transferDesc').value    = '';
  document.getElementById('transferError').style.display  = 'none';
  document.getElementById('transferResult').style.display = 'none';
}

async function realizarTransferencia() {
  if (!currentUser) return;
  const celDest  = document.getElementById('transferCelular').value.trim();
  const montoUSD = parseFloat(document.getElementById('transferMonto').value);
  const desc     = document.getElementById('transferDesc').value.trim();
  const errEl    = document.getElementById('transferError');
  const resEl    = document.getElementById('transferResult');

  errEl.style.display = 'none';
  resEl.style.display = 'none';

  if (!celDest)                          { errEl.textContent = '⚠️ Ingresa el celular del destinatario.'; errEl.style.display='block'; return; }
  if (isNaN(montoUSD) || montoUSD <= 0) { errEl.textContent = '⚠️ Ingresa un monto válido en USD.';      errEl.style.display='block'; return; }
  if ((currentUser.saldo?.USD || 0) < montoUSD) {
    errEl.textContent = `❌ Saldo USD insuficiente. Tienes $${parseFloat(currentUser.saldo?.USD||0).toFixed(2)} USD`;
    errEl.style.display = 'block';
    return;
  }

  // Confirmar si el monto es alto
  if (montoUSD > 1000) {
    if (!confirm(`¿Confirmas transferir $${montoUSD} USD a ${celDest}?`)) return;
  }

  try {
    const data = await apiFetch('transfers', '/transferir', 'POST', {
      idOrigen:        currentUser.id,
      celularDestino:  celDest,
      montoUSD,
      descripcion:     desc || undefined
    });

    await refrescarSaldos();
    await cargarMovimientosUsuario('all', true);
    renderPerfil();

    resEl.innerHTML = `
      <div style="color:var(--success,#22c55e);font-weight:600">✅ Transferencia exitosa</div>
      <div style="font-size:13px;margin-top:6px">
        Enviaste <strong>$${montoUSD.toFixed(2)} USD</strong> a <strong>${data.destinatario}</strong>
      </div>`;
    resEl.style.display = 'block';

    document.getElementById('transferCelular').value = '';
    document.getElementById('transferMonto').value   = '';
    document.getElementById('transferDesc').value    = '';
    showToast(`↗️ $${montoUSD} USD enviados a ${data.destinatario}`);
  } catch(err) {
    errEl.textContent   = '❌ ' + err.message;
    errEl.style.display = 'block';
  }
}

// Historial de transferencias (pestaña)
let _historialTransferencias = [];

async function cargarHistorialTransferencias() {
  if (!currentUser) return;
  try {
    _historialTransferencias = await apiFetch('transfers', `/historial/${currentUser.id}`);
    renderHistorialTransferencias();
  } catch(e) {
    const div = document.getElementById('historialTransferencias');
    if (div) div.innerHTML = '<div class="empty-state">Error al cargar historial</div>';
  }
}

function renderHistorialTransferencias() {
  const div = document.getElementById('historialTransferencias');
  if (!div) return;

  if (!_historialTransferencias.length) {
    div.innerHTML = '<div class="empty-state">Sin transferencias aún</div>';
    return;
  }

  div.innerHTML = _historialTransferencias.map(t => {
    const enviada = t.direccion === 'enviada';
    const fecha   = t.fecha ? new Date(t.fecha).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' }) : '—';
    const monto   = parseFloat(t.monto_usd).toLocaleString('es-CO', { maximumFractionDigits:2 });
    const contraparte = enviada ? t.nombre_destino : t.nombre_origen;
    return `
      <div class="mov-item">
        <div class="mov-icon ${enviada ? 'cambio' : 'recarga'}">${enviada ? '↗️' : '↙️'}</div>
        <div class="mov-info">
          <div class="mov-title">
            ${enviada ? 'A ' + contraparte : 'De ' + contraparte}
            ${t.descripcion ? ' · <span style="color:var(--muted)">' + t.descripcion + '</span>' : ''}
          </div>
          <div class="mov-date">${fecha}</div>
        </div>
        <div class="mov-amount ${enviada ? 'negative' : 'positive'}">
          ${enviada ? '-' : '+'}$${monto} USD
        </div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════
//  MOVIMIENTOS  (Accounts Service)
// ══════════════════════════════════════════════════════

let _movimientosUsuario = [];

async function cargarMovimientosUsuario(filtro = 'all', renderRecientes = false) {
  try {
    const rows = await apiFetch('accounts', `/movimientos/${currentUser.id}`);
    _movimientosUsuario = rows;
    renderMovListUser(filtro);
    if (renderRecientes) renderRecentMov();
    renderPerfilStats();
  } catch(e) { /* sin conexión */ }
}

function movItemHTML(m, showUser) {
  const tipo  = (m.tipo || '').toUpperCase();
  const icon  = MOV_ICONS[tipo] || '•';
  const clase = tipo === 'RECARGA' ? 'positive' : tipo === 'CAMBIO' ? 'neutral' : 'negative';
  const fecha = m.fecha
    ? new Date(m.fecha).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' }) : '—';
  const desc  = m.descripcion || m.desc || tipo;
  const monto = typeof m.monto === 'number'
    ? m.monto.toLocaleString('es-CO', { maximumFractionDigits:2 }) : m.monto || '—';

  return `
    <div class="mov-item">
      <div class="mov-icon ${tipo.toLowerCase()}">${icon}</div>
      <div class="mov-info">
        <div class="mov-title">${desc}${showUser && m.nombre ? ' · <span class="mov-user">' + m.nombre + '</span>' : ''}</div>
        <div class="mov-date">${fecha}</div>
      </div>
      <div class="mov-amount ${clase}">${monto} ${m.codigo || ''}</div>
    </div>`;
}

function renderRecentMov() {
  const div = document.getElementById('recentMov');
  if (!div) return;
  const movs = _movimientosUsuario.slice(0, 4);
  div.innerHTML = movs.length
    ? movs.map(m => movItemHTML(m, false)).join('')
    : '<div class="empty-state">Sin movimientos aún</div>';
}

function filterMovUser(el, f) {
  document.querySelectorAll('#u-movimientos .filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderMovListUser(f);
}

function renderMovListUser(f) {
  const div = document.getElementById('movListUser');
  if (!div) return;
  const movs = f === 'all'
    ? _movimientosUsuario
    : _movimientosUsuario.filter(m => m.tipo?.toUpperCase() === f.toUpperCase());
  div.innerHTML = movs.length
    ? movs.map(m => movItemHTML(m, false)).join('')
    : '<div class="empty-state">Sin movimientos</div>';
}

// ══════════════════════════════════════════════════════
//  PERFIL
// ══════════════════════════════════════════════════════

function renderPerfil() {
  const u = currentUser;
  if (!u) return;
  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  const fmt = v => '$' + parseFloat(v||0).toLocaleString('es-CO', { maximumFractionDigits:2 });

  set('perfAvatar',  u.nombre[0].toUpperCase());
  set('heroName',    u.nombre);
  set('perfName',    u.nombre);
  set('perfIdLabel', 'CC: ' + u.cc);
  set('infoNombre',  u.nombre);
  set('infoCC',      u.cc);
  set('infoCel',     u.celular || '—');
  set('infoId',      '#' + u.id);
  set('perfCOP',     fmt(u.saldo.COP) + ' COP');
  set('perfUSD',     fmt(u.saldo.USD) + ' USD');
  set('perfEUR',     fmt(u.saldo.EUR) + ' EUR');
  renderPerfilStats();
}

function renderPerfilStats() {
  const el = document.getElementById('perfTransCount');
  if (el) el.textContent = _movimientosUsuario.length;
}

// ══════════════════════════════════════════════════════
//  ADMIN  (Admin Service)
// ══════════════════════════════════════════════════════

// Leer adminId desde URL
function getAdminId() {
  return new URLSearchParams(window.location.search).get('adminId');
}

async function apiFetchAdmin(path, method = 'GET', body = null) {
  const adminId = getAdminId();
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-id': adminId }
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(SERVICES.admin + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

async function cargarDashboardAdmin() {
  try {
    const resp = await apiFetch('exchange', '/tasas');
    if (resp && resp.tasas) { tasas = resp.tasas; tasasMeta = resp.meta || {}; }
    else tasas = resp;
    renderDashboard();
  } catch(e) {}

  await Promise.allSettled([
    cargarYRenderUsuarios(),
    cargarYRenderMovAdmin()
  ]);
}

function renderDashboard() {
  const activos    = _adminUsuarios.filter(u => u.status === 'activo').length;
  const suspendidos = _adminUsuarios.filter(u => u.status === 'suspendido').length;
  const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  set('sideUserCount',   _adminUsuarios.length);
  set('statTotal',       _adminUsuarios.length);
  set('statActive',      activos);
  set('statSuspended',   suspendidos);

  const feedDiv = document.getElementById('activityFeed');
  if (feedDiv && _adminMovimientos.length) {
    feedDiv.innerHTML = _adminMovimientos.slice(0, 6).map(m => {
      const fecha = m.fecha ? new Date(m.fecha).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' }) : '—';
      return `
        <div class="mov-item">
          <div class="mov-icon ${(m.tipo||'').toLowerCase()}">${MOV_ICONS[m.tipo] || '•'}</div>
          <div class="mov-info">
            <div class="mov-title">${m.nombre} · ${m.descripcion || m.tipo}</div>
            <div class="mov-time">${fecha}</div>
          </div>
        </div>`;
    }).join('') || '<div class="empty-state">Sin actividad</div>';
  }

  const ratesDiv = document.getElementById('dashRates');
  if (ratesDiv) {
    const pares = [
      { pair: 'USD / COP', val: tasas.USD?.COP },
      { pair: 'EUR / COP', val: tasas.EUR?.COP },
      { pair: 'USD / EUR', val: tasas.USD?.EUR }
    ];
    ratesDiv.innerHTML = pares.map(r => `
      <div class="rate-row-admin">
        <span class="rate-pair-admin">${r.pair}</span>
        <span class="rate-val-admin">${r.val?.toLocaleString('es-CO', { maximumFractionDigits:6 }) || '—'}</span>
      </div>`).join('');
  }
}

let _adminUsuarios   = [];
let _adminMovimientos = [];

async function cargarYRenderUsuarios() {
  try {
    _adminUsuarios = await apiFetchAdmin('/admin/usuarios');
    renderUsersTable(_adminUsuarios);
    renderDashboard();
  } catch(err) { showToast('❌ Error al cargar usuarios'); }
}

function renderUsersTable(list) {
  const tbody = document.getElementById('usersTable');
  if (!tbody) return;
  const set = document.getElementById('sideUserCount');
  if (set) set.textContent = list.length;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="padding:30px;text-align:center">Sin resultados</td></tr>`;
    return;
  }
  const fmt = v => '$' + parseFloat(v||0).toLocaleString('es-CO', { maximumFractionDigits:2 });
  tbody.innerHTML = list.map(u => `
    <tr onclick="openUserModal(${u.id})" style="cursor:pointer">
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="table-avatar">${u.nombre[0].toUpperCase()}</div>
          <div>
            <div style="font-weight:600">${u.nombre}</div>
            <div style="font-size:11px;color:var(--muted)">#${u.id}</div>
          </div>
        </div>
      </td>
      <td class="mono">${u.cc}</td>
      <td class="mono">${u.celular}</td>
      <td class="mono">${fmt(u.saldo?.COP)}</td>
      <td class="mono">${fmt(u.saldo?.USD)}</td>
      <td class="mono">${fmt(u.saldo?.EUR)}</td>
      <td><span class="badge badge-${u.status === 'activo' ? 'green' : 'red'}">${u.status}</span></td>
      <td onclick="event.stopPropagation()">
        <div style="display:flex;gap:6px">
          <button class="btn-sm btn-outline" onclick="openUserModal(${u.id})">Ver</button>
          <button class="btn-sm btn-danger" onclick="toggleUserById(${u.id})">${u.status === 'activo' ? 'Suspender' : 'Activar'}</button>
        </div>
      </td>
    </tr>`).join('');
}

function filterUsers() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const s = document.getElementById('statusFilter').value;
  const filtered = _adminUsuarios.filter(u => {
    const matchQ = u.nombre.toLowerCase().includes(q) || u.cc.includes(q) || u.celular.includes(q);
    const matchS = s === 'all' || u.status === s;
    return matchQ && matchS;
  });
  renderUsersTable(filtered);
}

async function openUserModal(id) {
  selectedUserId = id;
  let u = _adminUsuarios.find(x => x.id === id);
  if (!u) {
    try { _adminUsuarios = await apiFetchAdmin('/admin/usuarios'); u = _adminUsuarios.find(x => x.id === id); }
    catch(e) { return; }
  }
  if (!u) return;

  const set = (elId, val) => { const el = document.getElementById(elId); if(el) el.textContent = val; };
  const fmt = v => '$' + parseFloat(v||0).toLocaleString('es-CO', { maximumFractionDigits:2 });

  set('modalInitial',  u.nombre[0].toUpperCase());
  set('modalName',     u.nombre);
  set('modalIdLabel',  'CC: ' + u.cc);
  set('modalCel',      u.celular);
  set('modalCC',       u.cc);
  set('modalUserId',   '#' + u.id);
  set('modalCOP',      fmt(u.saldo?.COP));
  set('modalUSD',      fmt(u.saldo?.USD));
  set('modalEUR',      fmt(u.saldo?.EUR));

  let movimientos = [];
  try { movimientos = await apiFetch('accounts', `/movimientos/${u.id}`); } catch(e) {}
  set('modalTrans', movimientos.length);

  const statusEl = document.getElementById('modalStatus');
  if (statusEl) statusEl.innerHTML = `<span class="badge badge-${u.status === 'activo' ? 'green' : 'red'}">${u.status}</span>`;

  const btn = document.getElementById('toggleStatusBtn');
  if (btn) btn.textContent = u.status === 'activo' ? 'Suspender' : 'Activar';

  const movDiv = document.getElementById('modalMovimientos');
  if (movDiv) {
    movDiv.innerHTML = movimientos.length
      ? movimientos.slice(0, 4).map(m => movItemHTML(m, false)).join('')
      : '<div class="empty-state">Sin movimientos</div>';
  }
  document.getElementById('userModal').classList.add('open');
}

function closeUserModal() {
  document.getElementById('userModal').classList.remove('open');
  selectedUserId = null;
}

async function toggleSelectedUser() {
  if (!selectedUserId) return;
  await toggleUserById(selectedUserId);
  await openUserModal(selectedUserId);
}

async function toggleUserById(id) {
  const u = _adminUsuarios.find(x => x.id === id);
  if (!u) return;
  const newStatus = u.status === 'activo' ? 'suspendido' : 'activo';
  try {
    await apiFetchAdmin(`/admin/usuario/${id}/status`, 'POST', { status: newStatus });
    u.status = newStatus;
    renderUsersTable(_adminUsuarios);
    renderDashboard();
    showToast(newStatus === 'activo' ? '✅ Usuario activado' : '🚫 Usuario suspendido');
  } catch(err) { showToast('❌ ' + err.message); }
}

async function deleteSelectedUser() {
  if (!selectedUserId) return;
  const u = _adminUsuarios.find(x => x.id === selectedUserId);
  const nombre = u ? u.nombre : 'este usuario';
  const confirmar = window.confirm(`⚠️ ¿Estás seguro de eliminar la cuenta de "${nombre}"?\n\nEsta acción es permanente y no se puede deshacer.`);
  if (!confirmar) return;
  try {
    await apiFetchAdmin(`/admin/usuario/${selectedUserId}`, 'DELETE');
    _adminUsuarios = _adminUsuarios.filter(u => u.id !== selectedUserId);
    closeUserModal();
    renderUsersTable(_adminUsuarios);
    renderDashboard();
    showToast('🗑️ Usuario eliminado');
  } catch(err) { showToast('❌ ' + err.message); }
}

async function exportUsers() {
  let usuarios = _adminUsuarios;
  if (!usuarios.length) {
    try { usuarios = await apiFetchAdmin('/admin/usuarios'); } catch(e) { return; }
  }
  const rows = [['ID','Nombre','Cédula','Celular','COP','USD','EUR','Estado']];
  usuarios.forEach(u => rows.push([u.id, u.nombre, u.cc, u.celular,
    u.saldo?.COP, u.saldo?.USD, u.saldo?.EUR, u.status]));
  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'pido_usuarios.csv';
  a.click();
  showToast('📥 CSV exportado');
}

async function cargarYRenderMovAdmin() {
  const div = document.getElementById('allMovimientos');
  if (!div) return;
  try {
    _adminMovimientos = await apiFetchAdmin('/admin/movimientos');
    div.innerHTML = _adminMovimientos.length
      ? _adminMovimientos.map(m => movItemHTML(m, true)).join('')
      : '<div class="empty-state">Sin movimientos registrados</div>';
    renderDashboard();
  } catch(err) {
    div.innerHTML = '<div class="empty-state">Error al cargar movimientos</div>';
  }
}

const RATE_KEYS = [
  { from:'USD', to:'COP', label:'1 USD → COP' },
  { from:'EUR', to:'COP', label:'1 EUR → COP' },
  { from:'USD', to:'EUR', label:'1 USD → EUR' },
  { from:'EUR', to:'USD', label:'1 EUR → USD' },
  { from:'COP', to:'USD', label:'1 COP → USD' },
  { from:'COP', to:'EUR', label:'1 COP → EUR' }
];

function renderRateEditor() {
  const ed = document.getElementById('rateEditor');
  if (!ed) return;

  const fmtFecha = f => f ? new Date(f).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' }) : '—';

  ed.innerHTML = RATE_KEYS.map(r => {
    const meta = tasasMeta[r.from]?.[r.to];
    const badgeColor  = meta?.fuente === 'api' ? '#22c55e' : '#f59e0b';
    const badgeLabel  = meta?.fuente === 'api' ? '🌐 API' : '✏️ Manual';
    const quien       = meta?.fuente === 'manual' && meta?.admin_nombre ? `Por: ${meta.admin_nombre}` : (meta?.fuente === 'api' ? 'Actualizado automáticamente' : '');
    const cuandoLabel = meta?.fecha ? `· ${fmtFecha(meta.fecha)}` : '';

    return `
    <div class="rate-row-admin" style="flex-direction:column;align-items:flex-start;gap:6px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
        <span class="rate-pair-admin">${r.label}</span>
        <input class="rate-input" id="rate-${r.from}-${r.to}" type="number" step="any" min="0"
          value="${tasas[r.from]?.[r.to] ?? ''}" oninput="updateRatePreview()" style="width:130px">
      </div>
      <div style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--muted)">
        <span style="background:${badgeColor}22;color:${badgeColor};padding:2px 7px;border-radius:20px;font-weight:600;font-size:10px">${badgeLabel}</span>
        ${quien ? `<span>${quien}</span>` : ''}
        ${cuandoLabel ? `<span>${cuandoLabel}</span>` : ''}
      </div>
    </div>`;
  }).join('');
  updateRatePreview();
}

async function saveRates() {
  const promises = RATE_KEYS.map(async r => {
    const el  = document.getElementById(`rate-${r.from}-${r.to}`);
    // Permitir 0 como valor válido — solo saltar si el campo está vacío o no es número
    if (!el || el.value === '') return;
    const val = parseFloat(el.value);
    if (!isNaN(val) && val >= 0) {
      await apiFetchAdmin('/admin/tasa', 'POST', { from: r.from, to: r.to, tasa: val });
    }
  });
  try {
    await Promise.all(promises);
    const resp = await apiFetch('exchange', '/tasas');
    if (resp && resp.tasas) { tasas = resp.tasas; tasasMeta = resp.meta || {}; }
    else tasas = resp;
    showToast('📈 Tasas actualizadas correctamente');
    renderDashboard();
    renderRateEditor(); // refrescar badges con nueva metadata
  } catch(err) { showToast('❌ Error al guardar tasas'); }
}

function updateRatePreview() {
  const div = document.getElementById('ratePreview');
  if (!div) return;
  const examples = [
    { amount:100,     from:'USD', to:'COP' },
    { amount:100,     from:'EUR', to:'COP' },
    { amount:1000000, from:'COP', to:'USD' },
    { amount:50,      from:'USD', to:'EUR' }
  ];
  div.innerHTML = examples.map(e => {
    const el   = document.getElementById(`rate-${e.from}-${e.to}`);
    const rate = el ? parseFloat(el.value) : (tasas[e.from]?.[e.to] || 0);
    const res  = (e.amount * rate).toLocaleString('es-CO', { maximumFractionDigits:2 });
    return `
      <div class="rate-row-admin">
        <span style="font-size:13px;color:var(--muted)">${e.amount.toLocaleString()} ${e.from}</span>
        <span class="rate-val-admin">${res} ${e.to}</span>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Inicialización ──
window.addEventListener('DOMContentLoaded', () => {
  const topbar = document.getElementById('topbar');
  const tabNav = document.getElementById('tabNav');
  if (topbar) topbar.style.display = 'none';
  if (tabNav) tabNav.style.display = 'none';

  // Si estamos en Admin.html, cargar dashboard
  if (document.getElementById('usersTable')) {
    cargarDashboardAdmin();
  }
});
