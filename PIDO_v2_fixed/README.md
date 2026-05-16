# PIDO v2 — Arquitectura de Microservicios

## Estructura del proyecto

```
PIDO_v2/
├── DB/
│   └── bd.sql                  ← Esquema actualizado (roles, transferencias USD)
├── services/
│   ├── db.js                   ← Conexión compartida a MySQL Workbench
│   ├── package.json
│   ├── auth/index.js           ← Puerto 3001 — Registro y login
│   ├── accounts/index.js       ← Puerto 3002 — Saldos, recargas, movimientos
│   ├── exchange/index.js       ← Puerto 3003 — Tasas y cambio de divisas
│   ├── transfers/index.js      ← Puerto 3004 — Transferencias USD
│   └── admin/index.js          ← Puerto 3005 — Panel administrativo
└── frontend/
    ├── index.html
    ├── Admin.html
    ├── script.js               ← Llama a cada servicio por separado
    └── style.css
```

---


---

## 2. Instalar dependencias

```bash
cd services
npm install
```

---

## 3. Levantar todos los microservicios

```bash
# Todos de una vez (requiere `concurrently`, ya incluido en package.json)
npm start

# O uno por uno en terminales separadas:
npm run auth       # :3001
npm run accounts   # :3002
npm run exchange   # :3003
npm run transfers  # :3004
npm run admin      # :3005
```

---

## 4. Abrir el frontend

Abre `frontend/index.html` directamente en el navegador
(o sirve la carpeta con Live Server en VS Code).

---git 

### Microservicios
Cada módulo de negocio es un servidor Express independiente:

| Servicio   | Puerto | Responsabilidad                    |
|------------|--------|------------------------------------|
| Auth       | 3001   | Registro y login                   |
| Accounts   | 3002   | Saldos, recargas, movimientos      |
| Exchange   | 3003   | Tasas de cambio y conversión       |
| Transfers  | 3004   | Transferencias USD entre usuarios  |
| Admin      | 3005   | Panel de administración            |

### Conexión a MySQL Workbench
- Puerto **3306** (estándar de MySQL), no 3307.
- Pool de conexiones con `mysql2/promise`.
- Configurable por variables de entorno: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.

### Diferenciación de roles en la base de datos
- Nueva tabla `roles` con valores `admin` y `usuario`.
- La columna `id_rol` en `usuarios` distingue el tipo de cuenta.
- Los administradores solo se crean directamente en la base de datos (no desde el registro público).
- El login devuelve el campo `rol`, y el frontend redirige al panel admin si corresponde.
- El Admin Service verifica el rol en cada petición usando el header `x-admin-id`.

### Transferencias USD
- Solo se pueden hacer transferencias en **dólares (USD)**.
- Endpoint: `POST :3004/transferir` con `{ idOrigen, celularDestino, montoUSD }`.
- Usa transacción SQL (BEGIN / COMMIT / ROLLBACK) para garantizar atomicidad.
- Registra movimiento en ambas cuentas (origen y destino).
- Historial disponible en `GET :3004/historial/:idUsuario`.
- Nueva pestaña "↗️ Transferir" en el frontend del usuario.

---

## Credenciales por defecto

| Rol   | Celular | Contraseña |
|-------|---------|------------|
| Admin | `admin` | `admin123` |

Los usuarios normales se registran desde la app. El admin existe desde el `bd.sql`.
