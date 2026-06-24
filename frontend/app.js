/* =========================================================
   VitalCore — app.js
   Frontend vanilla JS para el dashboard médico
   ========================================================= */

// ← CAMBIAR si el servidor Flask no corre en localhost:5000
const API = 'http://localhost:5000/api';

// cache de datos para dropdowns
let todosLosPacientes = [];
let todosLosMedicos   = [];
let umbralesSensores  = {};

// =========================================================
// INICIALIZACIÓN
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
  inicializarTabs();
  setFechasDefecto();
  verificarConexion();
  cargarUmbrales();
  cargarDropdowns();
});

async function verificarConexion() {
  const dot = document.getElementById('status-indicator');
  try {
    const r = await fetch(`${API}/medicos`);
    if (r.ok) {
      dot.className = 'status-dot connected';
      dot.title = 'Conectado a VitalCore API';
    } else throw new Error();
  } catch {
    dot.className = 'status-dot error';
    dot.title = 'Sin conexión — asegúrate de correr python server.py';
  }
}

function setFechasDefecto() {
  const hoy    = new Date();
  const hace6m = new Date(hoy);
  hace6m.setMonth(hace6m.getMonth() - 6);

  document.getElementById('t-desde').value = hace6m.toISOString().slice(0, 10);
  document.getElementById('t-hasta').value = hoy.toISOString().slice(0, 10);
}

async function cargarUmbrales() {
  try {
    umbralesSensores = await apiFetch('/thresholds');
  } catch (e) {
    console.warn('No se pudieron cargar umbrales:', e.message);
  }
}

async function cargarDropdowns() {
  try {
    [todosLosPacientes, todosLosMedicos] = await Promise.all([
      apiFetch('/pacientes'),
      apiFetch('/medicos'),
    ]);

    const selectoresPacientes = ['h-paciente', 't-paciente', 'r-paciente', 's-paciente'];
    selectoresPacientes.forEach(id => {
      poblarSelect(id, todosLosPacientes, p => ({
        value: p._id,
        text:  `${p._id} — ${p.nombre}`,
      }));
    });

    const selectoresMedicos = ['p-medico', 'r-medico'];
    selectoresMedicos.forEach(id => {
      poblarSelect(id, todosLosMedicos, m => ({
        value: m._id,
        text:  `${m._id} — ${m.nombre} (${m.especialidad})`,
      }));
    });
  } catch (e) {
    console.warn('No se pudieron cargar los dropdowns:', e.message);
  }
}

// =========================================================
// TABS
// =========================================================
function inicializarTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// =========================================================
// CONSULTA 1 — Historial clínico
// =========================================================
async function buscarHistorial() {
  const pacienteId = document.getElementById('h-paciente').value;
  if (!pacienteId) return alertar('Selecciona un paciente.');

  const resultado = document.getElementById('h-result');
  resultado.innerHTML = cargando();

  try {
    const consultas = await apiFetch(`/historial/${pacienteId}`);

    if (!consultas.length) {
      resultado.innerHTML = sinResultados('No hay consultas registradas para este paciente.');
      return;
    }

    resultado.innerHTML = `
      <p class="count-label">${consultas.length} consulta(s) encontrada(s)</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Médico</th>
              <th>Especialidad</th>
              <th>Motivo</th>
              <th>Notas clínicas</th>
            </tr>
          </thead>
          <tbody>
            ${consultas.map((c, i) => `
              <tr>
                <td class="text-muted">${i + 1}</td>
                <td class="fw-bold">${formatFecha(c.fecha_consulta)}</td>
                <td>${c.medico ? c.medico.nombre : c.medico_id}</td>
                <td>${c.medico ? `<span class="chip ${chipEsp(c.medico.especialidad)}">${c.medico.especialidad}</span>` : '—'}</td>
                <td>${c.motivo}</td>
                <td class="text-muted" style="max-width:320px;font-size:.8rem">${c.notas_clinicas}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    resultado.innerHTML = errorHTML(e.message);
  }
}

// =========================================================
// CONSULTA 2 — Telemetría
// =========================================================
async function buscarTelemetria() {
  const pacienteId = document.getElementById('t-paciente').value;
  const sensor     = document.getElementById('t-sensor').value;
  const desde      = document.getElementById('t-desde').value;
  const hasta      = document.getElementById('t-hasta').value;

  if (!pacienteId) return alertar('Selecciona un paciente.');
  if (!desde || !hasta) return alertar('Ingresa el rango de fechas.');

  const resultado = document.getElementById('t-result');
  resultado.innerHTML = cargando();

  try {
    const { lecturas, estadisticas } = await apiFetch(
      `/telemetria/${pacienteId}?sensor=${sensor}&desde=${desde}&hasta=${hasta}`
    );

    if (!lecturas.length) {
      resultado.innerHTML = sinResultados('Sin lecturas para este sensor en el rango de fechas.');
      return;
    }

    const umbral = umbralesSensores[sensor];
    const s = estadisticas;

    resultado.innerHTML = `
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Total</div>
          <div class="stat-value">${s.total}</div>
          <div class="stat-unit">lecturas</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Mínimo</div>
          <div class="stat-value">${s.minimo}</div>
          <div class="stat-unit">${lecturas[0]?.unidad ?? ''}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Máximo</div>
          <div class="stat-value" style="color:${s.maximo > (umbral?.umbral_critico ?? Infinity) ? 'var(--red)' : 'var(--blue)'}">${s.maximo}</div>
          <div class="stat-unit">${lecturas[0]?.unidad ?? ''}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Promedio</div>
          <div class="stat-value">${s.promedio}</div>
          <div class="stat-unit">${lecturas[0]?.unidad ?? ''}</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Timestamp</th>
              <th>Valor</th>
              <th>Unidad</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${lecturas.map((l, i) => {
              const critico = esCritico(sensor, l.valor);
              return `
                <tr>
                  <td class="text-muted">${i + 1}</td>
                  <td>${formatFechaHora(l.timestamp)}</td>
                  <td class="fw-bold ${critico ? 'text-red' : ''}">${l.valor}</td>
                  <td class="text-muted">${l.unidad}</td>
                  <td>${critico
                    ? '<span class="chip chip-red">⚠ Crítico</span>'
                    : '<span class="chip chip-green">Normal</span>'}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    resultado.innerHTML = errorHTML(e.message);
  }
}

// =========================================================
// CONSULTA 3 — Pacientes activos por médico
// =========================================================
async function buscarPacientesActivos() {
  const medicoId = document.getElementById('p-medico').value;
  if (!medicoId) return alertar('Selecciona un médico.');

  const resultado = document.getElementById('p-result');
  resultado.innerHTML = cargando();

  try {
    const pacientes = await apiFetch(`/medico/${medicoId}/pacientes-activos`);

    if (!pacientes.length) {
      resultado.innerHTML = sinResultados('Este médico no tiene pacientes activos.');
      return;
    }

    resultado.innerHTML = `
      <p class="count-label">${pacientes.length} paciente(s) activo(s)</p>
      <div class="patient-grid">
        ${pacientes.map(p => {
          const ulv   = p.ultima_lectura_vital;
          const critico = ulv ? esCritico(ulv.tipo_sensor, ulv.valor) : false;
          return `
            <div class="patient-card">
              <div class="patient-name">${p.nombre}</div>
              <div class="patient-meta">
                ${p._id} &nbsp;·&nbsp;
                ${p.genero === 'M' ? 'Masculino' : 'Femenino'} &nbsp;·&nbsp;
                <span class="${critico ? 'text-red' : 'text-muted'}">${p.condicion_cronica}</span>
              </div>
              ${ulv ? `
                <div class="vital-badge ${critico ? 'critico' : 'normal'}">
                  <span style="font-size:1.1rem">${iconoSensor(ulv.tipo_sensor)}</span>
                  <span style="flex:1">
                    <span class="vb-label">${labelSensor(ulv.tipo_sensor)}</span><br>
                    <span class="vb-value">${ulv.valor}</span>
                    <span class="vb-unit">${ulv.unidad}</span>
                  </span>
                  ${critico ? '<span class="chip chip-red">⚠</span>' : ''}
                </div>
                <div style="font-size:.72rem;color:var(--text-muted);margin-top:.4rem">
                  Última lectura: ${formatFechaHora(ulv.timestamp)}
                </div>
              ` : '<div class="text-muted" style="font-size:.8rem;margin-top:.5rem">Sin lecturas vitales</div>'}
            </div>`;
        }).join('')}
      </div>`;
  } catch (e) {
    resultado.innerHTML = errorHTML(e.message);
  }
}

// =========================================================
// CONSULTA 4 — Alertas críticas
// =========================================================
async function buscarAlertas() {
  const fc      = document.getElementById('u-fc').value;
  const glucosa = document.getElementById('u-glucosa').value;
  const spo2    = document.getElementById('u-spo2').value;
  const pa      = document.getElementById('u-pa').value;

  const resultado = document.getElementById('a-result');
  resultado.innerHTML = cargando();

  try {
    const alertas = await apiFetch(
      `/alertas?fc=${fc}&glucosa=${glucosa}&spo2=${spo2}&pa=${pa}`
    );

    // Actualizar badge en el tab
    const badge = document.getElementById('alertas-badge');
    if (alertas.length > 0) {
      badge.textContent = alertas.length;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }

    if (!alertas.length) {
      resultado.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✅</div>
          <div>Sin alertas activas. Todos los valores están dentro de los umbrales.</div>
        </div>`;
      return;
    }

    resultado.innerHTML = `
      <p class="count-label">${alertas.length} alerta(s) activa(s)</p>
      <div class="alerts-list">
        ${alertas.map(a => {
          const sensor = labelSensor(a.sensor);
          const dir    = a.direccion === 'mayor' ? 'supera' : 'está por debajo de';
          return `
            <div class="alert-card">
              <div class="alert-icon">${iconoSensor(a.sensor)}</div>
              <div class="alert-body">
                <div class="alert-patient">${a.nombre}</div>
                <div class="alert-detail">
                  ${a.paciente_id} &nbsp;·&nbsp; ${a.condicion ?? '—'}<br>
                  <span class="text-red">${sensor} ${dir} el umbral de ${a.umbral}</span><br>
                  <span class="text-muted">Médico: ${a.medico_id} &nbsp;·&nbsp; ${formatFechaHora(a.timestamp)}</span>
                </div>
              </div>
              <div class="alert-value">
                <span class="val">${a.valor}</span>
                <span class="unit">${a.unidad}</span>
                <span class="lim">umbral: ${a.umbral}</span>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  } catch (e) {
    resultado.innerHTML = errorHTML(e.message);
  }
}

// =========================================================
// CONSULTA 5 — Red de referidos
// =========================================================
async function buscarRedReferidos() {
  const pacienteId = document.getElementById('r-paciente').value;
  if (!pacienteId) return alertar('Selecciona un paciente.');

  const resultado = document.getElementById('r-result');
  resultado.innerHTML = cargando();

  try {
    const red = await apiFetch(`/red-referidos/${pacienteId}`);
    const { paciente, medico_principal, nodos } = red;

    // Separar médico principal del resto (especialistas)
    const especialistas = nodos.filter(n => n._id !== paciente_principal_id(medico_principal));
    const nodoPrincipal = nodos.find(n => n._id === paciente_principal_id(medico_principal));

    resultado.innerHTML = `
      <div class="referral-network">

        <!-- PACIENTE -->
        <div class="rn-node paciente">
          <div class="rn-avatar">👤</div>
          <div class="rn-info">
            <div class="rn-name">${paciente.nombre}</div>
            <div class="rn-sub">${paciente.id} &nbsp;·&nbsp; ${paciente.condicion}</div>
          </div>
          <span class="rn-badge">Paciente</span>
        </div>

        <div class="rn-connector"></div>

        <!-- MÉDICO PRINCIPAL -->
        ${medico_principal ? `
          <div class="rn-node principal">
            <div class="rn-avatar">🩺</div>
            <div class="rn-info">
              <div class="rn-name">${medico_principal.nombre}</div>
              <div class="rn-sub">
                <span class="esp-${medico_principal.especialidad.replace(/ /g,'')}">${medico_principal.especialidad}</span>
                &nbsp;·&nbsp; ${medico_principal._id}
              </div>
            </div>
            <span class="rn-badge">${nodoPrincipal ? nodoPrincipal.total_consultas + ' consulta(s)' : 'Principal'}</span>
          </div>
        ` : ''}

        ${especialistas.length ? `
          <div class="rn-connector"></div>
          <div class="rn-section-label">Especialistas referidos (${especialistas.length})</div>
          <div class="rn-specialists-row">
            ${especialistas.map(n => {
              const m = n.medico_info;
              return `
                <div class="rn-node especialista">
                  <div class="rn-avatar">👨‍⚕️</div>
                  <div class="rn-info">
                    <div class="rn-name">${m.nombre}</div>
                    <div class="rn-sub">
                      <span class="esp-${m.especialidad.replace(/ /g,'')}">${m.especialidad}</span>
                      &nbsp;·&nbsp; ${m._id}
                    </div>
                    <div class="rn-sub text-muted" style="margin-top:.15rem">
                      Última: ${formatFecha(n.ultima_consulta)}
                    </div>
                  </div>
                  <span class="rn-badge">${n.total_consultas} consulta(s)</span>
                </div>`;
            }).join('')}
          </div>
        ` : `
          <div class="empty-state" style="padding:1.5rem 0;font-size:.9rem">
            Este paciente no tiene referidos a especialistas registrados.
          </div>
        `}

      </div>`;
  } catch (e) {
    resultado.innerHTML = errorHTML(e.message);
  }
}

function paciente_principal_id(medico_principal) {
  return medico_principal ? medico_principal._id : null;
}

// =========================================================
// KPI 2 — SALUD DEL PACIENTE
// =========================================================
async function buscarSaludPaciente() {
  const pacienteId = document.getElementById('s-paciente').value;
  const n          = document.getElementById('s-cantidad').value;
  if (!pacienteId) return alertar('Selecciona un paciente.');

  const resultado = document.getElementById('s-result');
  resultado.innerHTML = cargando();

  try {
    const { paciente, lecturas } = await apiFetch(
      `/paciente/${pacienteId}/lecturas-recientes?n=${n}`
    );

    if (!lecturas.length) {
      resultado.innerHTML = sinResultados('Sin lecturas para este paciente.');
      return;
    }

    const criticos = lecturas.filter(l => l.critico).length;

    resultado.innerHTML = `
      <div class="salud-header">
        <div class="salud-patient-name">${paciente.nombre}</div>
        <div class="text-muted" style="font-size:.85rem">${paciente._id} · ${paciente.condicion_cronica ?? 'Sin condicion'}</div>
        <div class="salud-summary">
          <span class="chip chip-blue">${lecturas.length} lecturas</span>
          ${criticos > 0
            ? `<span class="chip chip-red">${criticos} critica(s)</span>`
            : '<span class="chip chip-green">Sin alertas</span>'}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Timestamp</th>
              <th>Sensor</th>
              <th>Valor</th>
              <th>Unidad</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${lecturas.map((l, i) => `
              <tr class="${l.critico ? 'row-critical' : ''}">
                <td class="text-muted">${i + 1}</td>
                <td>${formatFechaHora(l.timestamp)}</td>
                <td>${iconoSensor(l.tipo_sensor)} ${labelSensor(l.tipo_sensor)}</td>
                <td class="fw-bold ${l.critico ? 'text-red' : ''}">${l.valor}</td>
                <td class="text-muted">${l.unidad}</td>
                <td>${l.critico
                  ? '<span class="chip chip-red">Critico</span>'
                  : '<span class="chip chip-green">Normal</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    resultado.innerHTML = errorHTML(e.message);
  }
}

// =========================================================
// KPI 3 — PACIENTES POR RIESGO
// =========================================================
async function buscarPacientesPorRiesgo() {
  const medicoId = document.getElementById('r-medico').value;
  if (!medicoId) return alertar('Selecciona un medico.');

  const resultado = document.getElementById('rr-result');
  resultado.innerHTML = cargando();

  try {
    const pacientes = await apiFetch(`/medico/${medicoId}/pacientes-por-riesgo`);

    if (!pacientes.length) {
      resultado.innerHTML = sinResultados('Este medico no tiene pacientes activos.');
      return;
    }

    const alto = pacientes.filter(p => p.riesgo >= 1).length;
    const bajo = pacientes.length - alto;

    resultado.innerHTML = `
      <div class="riesgo-summary">
        <span class="chip chip-blue">${pacientes.length} paciente(s)</span>
        ${alto > 0
          ? `<span class="chip chip-red">${alto} en riesgo</span>`
          : ''}
        <span class="chip chip-green">${bajo} estable(s)</span>
      </div>
      <div class="patient-grid">
        ${pacientes.map(p => {
          const ulv = p.ultima_lectura_vital;
          const riesgoNivel = p.riesgo >= 1 ? 'alto' : 'bajo';
          return `
            <div class="patient-card riesgo-${riesgoNivel}">
              <div class="patient-name">${p.nombre}</div>
              <div class="patient-meta">
                ${p._id} &nbsp;·&nbsp;
                ${p.genero === 'M' ? 'Masculino' : 'Femenino'} &nbsp;·&nbsp;
                <span class="text-muted">${p.condicion_cronica}</span>
              </div>
              <div class="riesgo-badge riesgo-${riesgoNivel}">
                ${p.riesgo >= 1 ? '🔴 Riesgo alto' : '🟢 Estable'}
              </div>
              ${ulv ? `
                <div class="vital-badge ${ulv.tipo_sensor && esCritico(ulv.tipo_sensor, ulv.valor) ? 'critico' : 'normal'}">
                  <span style="font-size:1.1rem">${iconoSensor(ulv.tipo_sensor)}</span>
                  <span style="flex:1">
                    <span class="vb-label">${labelSensor(ulv.tipo_sensor)}</span><br>
                    <span class="vb-value">${ulv.valor}</span>
                    <span class="vb-unit">${ulv.unidad}</span>
                  </span>
                </div>
              ` : ''}
            </div>`;
        }).join('')}
      </div>`;
  } catch (e) {
    resultado.innerHTML = errorHTML(e.message);
  }
}

// =========================================================
// AUTO-REFRESH PARA ALERTAS
// =========================================================
let alertasAutoRefreshInterval = null;
let alertasCountdownInterval = null;
let alertasCountdown = 30;

function toggleAutoRefreshAlertas() {
  const toggle = document.getElementById('auto-refresh-toggle');
  const countdownEl = document.getElementById('alertas-countdown');

  if (toggle.checked) {
    alertasCountdown = 30;
    countdownEl.textContent = `Actualizacion en ${alertasCountdown}s`;
    buscarAlertas();
    alertasAutoRefreshInterval = setInterval(() => {
      alertasCountdown = 30;
      buscarAlertas();
    }, 30000);
    alertasCountdownInterval = setInterval(() => {
      alertasCountdown--;
      countdownEl.textContent = `Actualizacion en ${alertasCountdown}s`;
    }, 1000);
  } else {
    clearInterval(alertasAutoRefreshInterval);
    clearInterval(alertasCountdownInterval);
    alertasAutoRefreshInterval = null;
    alertasCountdownInterval = null;
    countdownEl.textContent = '';
  }
}

// =========================================================
// KPI 1 — RENDIMIENTO
// =========================================================
async function cargarMetricas() {
  const resultado = document.getElementById('rm-result');
  resultado.innerHTML = cargando();

  try {
    const metricas = await apiFetch('/metricas');

    const statsEl = document.getElementById('rendimiento-stats');
    if (metricas.length > 0) {
      const totalCalls = metricas.reduce((s, m) => s + m.total_llamadas, 0);
      const avgGlobal = (metricas.reduce((s, m) => s + m.promedio_ms, 0) / metricas.length).toFixed(1);
      statsEl.innerHTML = `
        <span class="chip chip-blue">${totalCalls} llamadas totales</span>
        <span class="chip chip-green">Promedio global: ${avgGlobal}ms</span>`;
    } else {
      statsEl.innerHTML = '<span class="chip chip-blue">Sin datos todavia</span>';
    }

    if (!metricas.length) {
      resultado.innerHTML = sinResultados('Aun no hay datos de rendimiento. Navega por los otros tabs para generar metricas.');
      return;
    }

    resultado.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Llamadas</th>
              <th>Promedio</th>
              <th>Minimo</th>
              <th>Maximo</th>
              <th>P95</th>
            </tr>
          </thead>
          <tbody>
            ${metricas.map(m => {
              const cls = m.promedio_ms < 50 ? 'text-green'
                        : m.promedio_ms < 200 ? 'text-amber'
                        : 'text-red';
              return `
                <tr>
                  <td class="fw-bold" style="font-family:monospace;font-size:.82rem">${m.endpoint}</td>
                  <td>${m.total_llamadas}</td>
                  <td class="fw-bold ${cls}">${m.promedio_ms}ms</td>
                  <td>${m.minimo_ms}ms</td>
                  <td>${m.maximo_ms}ms</td>
                  <td>${m.p95_ms}ms</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    resultado.innerHTML = errorHTML(e.message);
  }
}

// =========================================================
// UTILIDADES
// =========================================================

async function apiFetch(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${r.status}`);
  }
  return r.json();
}

function poblarSelect(id, items, mapFn) {
  const el = document.getElementById(id);
  if (!el) return;
  const base = el.options[0];
  el.innerHTML = '';
  el.appendChild(base);
  items.forEach(item => {
    const opt = document.createElement('option');
    const { value, text } = mapFn(item);
    opt.value = value;
    opt.textContent = text;
    el.appendChild(opt);
  });
}

function alertar(msg) {
  alert(msg);
}

function cargando() {
  return `<div class="loading"><div class="spinner"></div>Consultando base de datos...</div>`;
}

function sinResultados(msg) {
  return `<div class="empty-state"><div class="empty-icon">🔍</div><div>${msg}</div></div>`;
}

function errorHTML(msg) {
  return `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <div class="text-red fw-bold">Error de conexión</div>
      <div class="text-muted" style="margin-top:.5rem;font-size:.85rem">${msg}</div>
      <div class="text-muted" style="margin-top:.5rem;font-size:.8rem">
        Verifica que MongoDB y <code>python server.py</code> estén corriendo.
      </div>
    </div>`;
}

function formatFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatFechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Umbrales cargados desde /api/thresholds (fuente de verdad: config/thresholds.py)
// umbralesSensores es un objeto global llenado por cargarUmbrales()

function esCritico(sensor, valor) {
  const u = umbralesSensores[sensor];
  if (!u || !u.umbral_critico) return false;
  // Use explicit direction from threshold config
  const direction = u.direccion || 'mayor';
  if (direction === 'mayor') {
    return valor > u.umbral_critico;
  } else { // direction === 'menor'
    return valor < u.umbral_critico;
  }
}

function iconoSensor(sensor) {
  const iconos = {
    glucosa:             '🩸',
    frecuencia_cardiaca: '❤️',
    saturacion_oxigeno:  '💨',
    presion_sistolica:   '🫀',
    horas_sueno:         '😴',
  };
  return iconos[sensor] ?? '📊';
}

function labelSensor(sensor) {
  const labels = {
    glucosa:             'Glucosa',
    frecuencia_cardiaca: 'Frec. Cardíaca',
    saturacion_oxigeno:  'Saturación O₂',
    presion_sistolica:   'Presión Sistólica',
    horas_sueno:         'Horas de Sueño',
  };
  return labels[sensor] ?? sensor;
}

function chipEsp(especialidad) {
  const map = {
    'Cardiologia':      'chip-red',
    'Endocrinologia':   'chip-amber',
    'Medicina General': 'chip-blue',
    'Neumologia':       'chip-green',
    'Geriatria':        'chip-purple',
  };
  return map[especialidad] ?? 'chip-blue';
}
