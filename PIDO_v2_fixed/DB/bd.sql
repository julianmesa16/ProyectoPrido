-- ============================================================
--  PIDO_DB  — Esquema v2.1
--  • Usuarios normales y administradores diferenciados en BD
--  • Tabla transferencias con soporte USD
--  • Tasas con fuente (api/manual), quien actualizó y cuándo
--  • Configuración de saldos iniciales por moneda
-- ============================================================

CREATE DATABASE IF NOT EXISTS pido_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pido_db;

-- ─── ROLES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id_rol   INT PRIMARY KEY AUTO_INCREMENT,
  nombre   VARCHAR(30) NOT NULL UNIQUE   -- 'admin' | 'usuario'
);

INSERT IGNORE INTO roles (nombre) VALUES ('admin'), ('usuario');

-- ─── USUARIOS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario      INT AUTO_INCREMENT PRIMARY KEY,
  nombre          VARCHAR(100) NOT NULL,
  cc              VARCHAR(20)  NOT NULL UNIQUE,
  celular         VARCHAR(20)  NOT NULL UNIQUE,
  password        VARCHAR(255) NOT NULL,
  id_rol          INT          NOT NULL DEFAULT 2,   -- 2 = usuario normal
  status          ENUM('activo','suspendido') DEFAULT 'activo',
  fecha_registro  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_rol) REFERENCES roles(id_rol)
);

-- Administrador por defecto (password: admin123)
INSERT IGNORE INTO usuarios (nombre, cc, celular, password, id_rol)
VALUES ('Administrador', '0000000000', 'admin', 'admin123', 1);

-- ─── MONEDAS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monedas (
  id_moneda INT AUTO_INCREMENT PRIMARY KEY,
  codigo    VARCHAR(3)  NOT NULL UNIQUE,
  nombre    VARCHAR(50) NOT NULL
);

INSERT IGNORE INTO monedas (codigo, nombre) VALUES
  ('COP', 'Peso Colombiano'),
  ('USD', 'Dólar Estadounidense'),
  ('EUR', 'Euro');

-- ─── CONFIGURACIÓN DEL SISTEMA ────────────────────────────
-- Guarda parámetros configurables: saldos iniciales, etc.
CREATE TABLE IF NOT EXISTS configuracion (
  clave   VARCHAR(50) PRIMARY KEY,
  valor   VARCHAR(255) NOT NULL,
  descripcion VARCHAR(200)
);

-- Saldos iniciales por defecto (0 = sin dinero de pruebas)
INSERT IGNORE INTO configuracion (clave, valor, descripcion) VALUES
  ('saldo_inicial_COP', '0', 'Saldo inicial en COP al crear cuenta'),
  ('saldo_inicial_USD', '0', 'Saldo inicial en USD al crear cuenta'),
  ('saldo_inicial_EUR', '0', 'Saldo inicial en EUR al crear cuenta');

-- ─── CUENTAS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cuentas (
  id_cuenta  INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT NOT NULL,
  id_moneda  INT NOT NULL,
  saldo      DECIMAL(14,2) DEFAULT 0.00,
  FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  FOREIGN KEY (id_moneda)  REFERENCES monedas(id_moneda),
  UNIQUE (id_usuario, id_moneda)
);

-- ─── TASAS DE CAMBIO ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasas_cambio (
  id_tasa        INT AUTO_INCREMENT PRIMARY KEY,
  moneda_origen  INT NOT NULL,
  moneda_destino INT NOT NULL,
  tasa           DECIMAL(14,8) NOT NULL,
  fuente         ENUM('api','manual') DEFAULT 'manual',
  actualizado_por INT NULL,               -- id_usuario del admin (NULL si fue por API)
  fecha          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (moneda_origen)  REFERENCES monedas(id_moneda),
  FOREIGN KEY (moneda_destino) REFERENCES monedas(id_moneda),
  FOREIGN KEY (actualizado_por) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
);

INSERT IGNORE INTO tasas_cambio (moneda_origen, moneda_destino, tasa, fuente) VALUES
  (2, 3, 0.92000000, 'manual'),   -- USD → EUR
  (3, 2, 1.08000000, 'manual'),   -- EUR → USD
  (2, 1, 4200.00000000, 'manual'),-- USD → COP
  (3, 1, 4500.00000000, 'manual'),-- EUR → COP
  (1, 2, 0.00023800, 'manual'),   -- COP → USD
  (1, 3, 0.00022200, 'manual');   -- COP → EUR

-- ─── MOVIMIENTOS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS movimientos (
  id_movimiento INT AUTO_INCREMENT PRIMARY KEY,
  id_cuenta     INT NOT NULL,
  tipo          ENUM('RECARGA','CAMBIO','TRANSFERENCIA') NOT NULL,
  monto         DECIMAL(14,2) NOT NULL,
  descripcion   VARCHAR(255),
  fecha         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_cuenta) REFERENCES cuentas(id_cuenta)
);

-- ─── TRANSFERENCIAS (solo USD) ────────────────────────────
CREATE TABLE IF NOT EXISTS transferencias (
  id_transferencia INT AUTO_INCREMENT PRIMARY KEY,
  cuenta_origen    INT          NOT NULL,
  cuenta_destino   INT          NOT NULL,
  monto_usd        DECIMAL(14,2) NOT NULL,
  descripcion      VARCHAR(255),
  estado           ENUM('completada','revertida') DEFAULT 'completada',
  fecha            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_origen)  REFERENCES cuentas(id_cuenta),
  FOREIGN KEY (cuenta_destino) REFERENCES cuentas(id_cuenta),
  CHECK (cuenta_origen <> cuenta_destino)
);

-- ─── MIGRACIÓN (si ya existe la BD) ───────────────────────
-- Ejecutar solo si actualizas desde v2:
-- ALTER TABLE tasas_cambio ADD COLUMN IF NOT EXISTS fuente ENUM('api','manual') DEFAULT 'manual';
-- ALTER TABLE tasas_cambio ADD COLUMN IF NOT EXISTS actualizado_por INT NULL;
-- ALTER TABLE tasas_cambio MODIFY COLUMN tasa DECIMAL(14,8) NOT NULL;
-- CREATE TABLE IF NOT EXISTS configuracion (...); -- ver arriba
-- UPDATE configuracion SET valor='0' WHERE clave LIKE 'saldo_inicial_%';
