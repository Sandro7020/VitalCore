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
// PAGINATION STATE
// =========================================================
const pag = {
  telemetria:  { page: 1, perPage: 20 },
  alertas:     { page: 1, perPage: 15 },
  historial:   { data: [], fullData: [], page: 1, perPage: 15 },
  activos:     { data: [], fullData: [], page: 1, perPage: 12 },
  riesgo:      { data: [], fullData: [], page: 1, perPage: 12 },
  salud:       { data: [], fullData: [], paciente: null, page: 1, perPage: 15 },
};

// =========================================================
// PAGINATION UTILITIES
// =========================================================
function renderPagination(containerId, meta, onPageChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!meta || meta.pages <= 1) { el.innerHTML = ''; return; }

  const { page, per_page, total, pages } = meta;
  const start = (page - 1) * per_page + 1;
  const end = Math.min(page * per_page, total);

  let html = `<div class="pagination">`;
  html += `<span class="pagination-info">Mostrando ${start}-${end} de ${total}</span>`;
  html += `<button class="pagination-btn" ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}">&laquo;</button>`;

  const maxVis = 5;
  let s = Math.max(1, page - Math.floor(maxVis / 2));
  let e = Math.min(pages, s + maxVis - 1);
  if (e - s < maxVis - 1) s = Math.max(1, e - maxVis + 1);

  if (s > 1) {
    html += `<button class="pagination-btn" data-page="1">1</button>`;
    if (s > 2) html += `<span class="pagination-ellipsis">&hellip;</span>`;
  }
  for (let i = s; i <= e; i++) {
    html += `<button class="pagination-btn${i === page ? ' active' : ''}" data-page="${i}">${i}</button>`;
  }
  if (e < pages) {
    if (e < pages - 1) html += `<span class="pagination-ellipsis">&hellip;</span>`;
    html += `<button class="pagination-btn" data-page="${pages}">${pages}</button>`;
  }

  html += `<button class="pagination-btn" ${page >= pages ? 'disabled' : ''} data-page="${page + 1}">&raquo;</button>`;
  html += `</div>`;
  el.innerHTML = html;

  el.querySelectorAll('.pagination-btn:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page);
      if (p && p !== page) onPageChange(p);
    });
  });
}

function pagMeta(total, page, perPage) {
  return { page, per_page: perPage, total, pages: Math.max(1, Math.ceil(total / perPage)) };
}

function pagSlice(array, page, perPage) {
  const s = (page - 1) * perPage;
  return array.slice(s, s + perPage);
}

// =========================================================
// INITIALIZATION
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
  inicializarTabs();
  inicializarSubTabs();
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
    dot.title = 'Sin conexion — asegurate de correr python server.py';
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
  try { umbralesSensores = await apiFetch('/thresholds'); }
  catch (e) { console.warn('No se pudieron cargar umbrales:', e.message); }
}

async function cargarDropdowns() {
  try {
    [todosLosPacientes, todosLosMedicos] = await Promise.all([
      apiFetch('/pacientes'),
      apiFetch('/medicos'),
    ]);
    ['h-paciente', 't-paciente', 'r-paciente', 's-paciente'].forEach(id => {
      poblarSelect(id, todosLosPacientes, p => ({ value: p._id, text: `${p._id} — ${p.nombre}` }));
    });
    ['p-medico', 'r-medico'].forEach(id => {
      poblarSelect(id, todosLosMedicos, m => ({ value: m._id, text: `${m._id} — ${m.nombre} (${m.especialidad})` }));
    });
  } catch (e) { console.warn('No se pudieron cargar los dropdowns:', e.message); }
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
// SUB-TABS
// =========================================================
function inicializarSubTabs() {
  document.querySelectorAll('.sub-tab-nav').forEach(nav => {
    nav.querySelectorAll('.sub-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = btn.closest('.tab-panel');
        panel.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
        panel.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        panel.querySelector(`#subpanel-${btn.dataset.subtab}`).classList.add('active');
      });
    });
  });
}

// =========================================================
// CONSULTA 1 — Historial clinico (client-side pagination)
// =========================================================
async function buscarHistorial(page = 1) {
  const pacienteId = document.getElementById('h-paciente').value;
  if (!pacienteId) return alertar('Selecciona un paciente.');

  const resultado = document.getElementById('h-result');

  // If same patient and we already have data, just re-render page
  if (pag.historial.data.length && pag.historial._patient === pacienteId && page !== 1) {
    pag.historial.page = page;
    renderHistorialPage();
    return;
  }

  resultado.innerHTML = cargando();
  try {
    const consultas = await apiFetch(`/historial/${pacienteId}`);
    pag.historial.fullData = consultas;
    pag.historial._patient = pacienteId;
    pag.historial.page = 1;

    if (!consultas.length) {
      resultado.innerHTML = sinResultados('No hay consultas registradas para este paciente.');
      return;
    }
    renderHistorialPage();
  } catch (e) { resultado.innerHTML = errorHTML(e.message); }
}

function renderHistorialPage() {
  const resultado = document.getElementById('h-result');
  const d = pag.historial;
  const page = d.page;
  const consultas = d.fullData;
  const meta = pagMeta(consultas.length, page, d.perPage);
  const pageData = pagSlice(consultas, page, d.perPage);
  const globalOffset = (page - 1) * d.perPage;

  resultado.innerHTML = `
    <p class="count-label">${consultas.length} consulta(s) encontrada(s)</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>#</th><th>Fecha</th><th>Medico</th><th>Especialidad</th><th>Motivo</th><th>Notas clinicas</th></tr>
        </thead>
        <tbody>
          ${pageData.map((c, i) => `
            <tr>
              <td class="text-muted">${globalOffset + i + 1}</td>
              <td class="fw-bold">${formatFecha(c.fecha_consulta)}</td>
              <td>${c.medico ? c.medico.nombre : c.medico_id}</td>
              <td>${c.medico ? `<span class="chip ${chipEsp(c.medico.especialidad)}">${c.medico.especialidad}</span>` : '—'}</td>
              <td>${c.motivo}</td>
              <td class="text-muted" style="max-width:320px;font-size:.8rem">${c.notas_clinicas}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div id="h-pagination"></div>`;
  renderPagination('h-pagination', meta, (p) => { d.page = p; renderHistorialPage(); });
}

// =========================================================
// CONSULTA 2 — Telemetria (server-side pagination)
// =========================================================
async function buscarTelemetria(page = 1) {
  const pacienteId = document.getElementById('t-paciente').value;
  const sensor     = document.getElementById('t-sensor').value;
  const desde      = document.getElementById('t-desde').value;
  const hasta      = document.getElementById('t-hasta').value;

  if (!pacienteId) return alertar('Selecciona un paciente.');
  if (!desde || !hasta) return alertar('Ingresa el rango de fechas.');

  pag.telemetria.page = page;
  const resultado = document.getElementById('t-result');
  resultado.innerHTML = cargando();

  try {
    const { lecturas, estadisticas, pagination } = await apiFetch(
      `/telemetria/${pacienteId}?sensor=${sensor}&desde=${desde}&hasta=${hasta}&page=${page}&per_page=${pag.telemetria.perPage}`
    );

    if (!pagination || pagination.total === 0) {
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
          <div class="stat-label">Minimo</div>
          <div class="stat-value">${s.minimo}</div>
          <div class="stat-unit">${lecturas[0]?.unidad ?? ''}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Maximo</div>
          <div class="stat-value" style="color:${s.maximo > (umbral?.umbral_critico ?? Infinity) ? 'var(--red)' : 'var(--primary)'}">${s.maximo}</div>
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
            <tr><th>#</th><th>Timestamp</th><th>Valor</th><th>Unidad</th><th>Estado</th></tr>
          </thead>
          <tbody>
            ${lecturas.map((l, i) => {
              const critico = esCritico(sensor, l.valor);
              const rowNum = (pagination.page - 1) * pagination.per_page + i + 1;
              return `
                <tr>
                  <td class="text-muted">${rowNum}</td>
                  <td>${formatFechaHora(l.timestamp)}</td>
                  <td class="fw-bold ${critico ? 'text-red' : ''}">${l.valor}</td>
                  <td class="text-muted">${l.unidad}</td>
                  <td>${critico
                    ? '<span class="chip chip-red">Critico</span>'
                    : '<span class="chip chip-green">Normal</span>'}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div id="t-pagination"></div>`;
    renderPagination('t-pagination', pagination, (p) => buscarTelemetria(p));
  } catch (e) { resultado.innerHTML = errorHTML(e.message); }
}

// =========================================================
// CONSULTA 3 — Pacientes activos por medico (client-side pagination)
// =========================================================
async function buscarPacientesActivos(page = 1) {
  const medicoId = document.getElementById('p-medico').value;
  if (!medicoId) return alertar('Selecciona un medico.');

  const resultado = document.getElementById('p-result');

  if (pag.activos.fullData.length && pag.activos._medico === medicoId && page !== 1) {
    pag.activos.page = page;
    renderActivosPage();
    return;
  }

  resultado.innerHTML = cargando();
  try {
    const pacientes = await apiFetch(`/medico/${medicoId}/pacientes-activos`);
    pag.activos.fullData = pacientes;
    pag.activos._medico = medicoId;
    pag.activos.page = 1;

    if (!pacientes.length) {
      resultado.innerHTML = sinResultados('Este medico no tiene pacientes activos.');
      return;
    }
    renderActivosPage();
  } catch (e) { resultado.innerHTML = errorHTML(e.message); }
}

function renderActivosPage() {
  const resultado = document.getElementById('p-result');
  const d = pag.activos;
  const page = d.page;
  const pacientes = d.fullData;
  const meta = pagMeta(pacientes.length, page, d.perPage);
  const pageData = pagSlice(pacientes, page, d.perPage);

  resultado.innerHTML = `
    <p class="count-label">${pacientes.length} paciente(s) activo(s)</p>
    <div class="patient-grid">
      ${pageData.map(p => {
        const ulv = p.ultima_lectura_vital;
        const critico = ulv ? esCritico(ulv.tipo_sensor, ulv.valor) : false;
        return `
          <div class="patient-card">
            <div class="patient-name">${p.nombre}</div>
            <div class="patient-meta">
              ${p._id} &middot; ${p.genero === 'M' ? 'Masculino' : 'Femenino'} &middot;
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
                ${critico ? '<span class="chip chip-red">!</span>' : ''}
              </div>
              <div style="font-size:.72rem;color:var(--text-muted);margin-top:.4rem">
                Ultima lectura: ${formatFechaHora(ulv.timestamp)}
              </div>
            ` : '<div class="text-muted" style="font-size:.8rem;margin-top:.5rem">Sin lecturas vitales</div>'}
          </div>`;
      }).join('')}
    </div>
    <div id="p-pagination"></div>`;
  renderPagination('p-pagination', meta, (p) => { d.page = p; renderActivosPage(); });
}

// =========================================================
// CONSULTA 4 — Alertas criticas (server-side pagination)
// =========================================================
async function buscarAlertas(page = 1) {
  const fc      = document.getElementById('u-fc').value;
  const glucosa = document.getElementById('u-glucosa').value;
  const spo2    = document.getElementById('u-spo2').value;
  const pa      = document.getElementById('u-pa').value;

  pag.alertas.page = page;
  const resultado = document.getElementById('a-result');
  resultado.innerHTML = cargando();

  try {
    const { data: alertas, pagination } = await apiFetch(
      `/alertas?fc=${fc}&glucosa=${glucosa}&spo2=${spo2}&pa=${pa}&page=${page}&per_page=${pag.alertas.perPage}`
    );

    const badge = document.getElementById('alertas-badge');
    if (pagination.total > 0) {
      badge.textContent = pagination.total;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }

    if (!pagination || pagination.total === 0) {
      resultado.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">&#x2705;</div>
          <div>Sin alertas activas. Todos los valores estan dentro de los umbrales.</div>
        </div>`;
      return;
    }

    resultado.innerHTML = `
      <p class="count-label">${pagination.total} alerta(s) activa(s)</p>
      <div class="alerts-list">
        ${alertas.map(a => {
          const sensor = labelSensor(a.sensor);
          const dir    = a.direccion === 'mayor' ? 'supera' : 'esta por debajo de';
          return `
            <div class="alert-card">
              <div class="alert-icon">${iconoSensor(a.sensor)}</div>
              <div class="alert-body">
                <div class="alert-patient">${a.nombre}</div>
                <div class="alert-detail">
                  ${a.paciente_id} &middot; ${a.condicion ?? '—'}<br>
                  <span class="text-red">${sensor} ${dir} el umbral de ${a.umbral}</span><br>
                  <span class="text-muted">Medico: ${a.medico_id} &middot; ${formatFechaHora(a.timestamp)}</span>
                </div>
              </div>
              <div class="alert-value">
                <span class="val">${a.valor}</span>
                <span class="unit">${a.unidad}</span>
                <span class="lim">umbral: ${a.umbral}</span>
              </div>
            </div>`;
        }).join('')}
      </div>
      <div id="a-pagination"></div>`;
    renderPagination('a-pagination', pagination, (p) => buscarAlertas(p));
  } catch (e) { resultado.innerHTML = errorHTML(e.message); }
}

// =========================================================
// CONSULTA 5 — Red de referidos (no pagination, naturally small)
// =========================================================
async function buscarRedReferidos() {
  const pacienteId = document.getElementById('r-paciente').value;
  if (!pacienteId) return alertar('Selecciona un paciente.');

  const resultado = document.getElementById('r-result');
  resultado.innerHTML = cargando();

  try {
    const red = await apiFetch(`/red-referidos/${pacienteId}`);
    const { paciente, medico_principal, nodos } = red;

    const especialistas = nodos.filter(n => n._id !== medico_principal?._id);
    const nodoPrincipal = nodos.find(n => n._id === medico_principal?._id);

    resultado.innerHTML = `
      <div class="referral-network">
        <div class="rn-node paciente">
          <div class="rn-avatar">&#x1f464;</div>
          <div class="rn-info">
            <div class="rn-name">${paciente.nombre}</div>
            <div class="rn-sub">${paciente.id} &middot; ${paciente.condicion}</div>
          </div>
          <span class="rn-badge">Paciente</span>
        </div>
        <div class="rn-connector"></div>
        ${medico_principal ? `
          <div class="rn-node principal">
            <div class="rn-avatar">&#x1fa7a;</div>
            <div class="rn-info">
              <div class="rn-name">${medico_principal.nombre}</div>
              <div class="rn-sub">
                <span class="esp-${medico_principal.especialidad.replace(/ /g,'')}">${medico_principal.especialidad}</span>
                &middot; ${medico_principal._id}
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
                  <div class="rn-avatar">&#x1fa7a;</div>
                  <div class="rn-info">
                    <div class="rn-name">${m.nombre}</div>
                    <div class="rn-sub">
                      <span class="esp-${m.especialidad.replace(/ /g,'')}">${m.especialidad}</span>
                      &middot; ${m._id}
                    </div>
                    <div class="rn-sub text-muted" style="margin-top:.15rem">
                      Ultima: ${formatFecha(n.ultima_consulta)}
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
  } catch (e) { resultado.innerHTML = errorHTML(e.message); }
}

// =========================================================
// KPI 2 — SALUD DEL PACIENTE (client-side pagination)
// =========================================================
async function buscarSaludPaciente(page = 1) {
  const pacienteId = document.getElementById('s-paciente').value;
  const n          = document.getElementById('s-cantidad').value;
  if (!pacienteId) return alertar('Selecciona un paciente.');

  const resultado = document.getElementById('s-result');

  if (pag.salud.fullData.length && pag.salud._patient === pacienteId && pag.salud._n === n && page !== 1) {
    pag.salud.page = page;
    renderSaludPage();
    return;
  }

  resultado.innerHTML = cargando();
  try {
    const { paciente, lecturas } = await apiFetch(
      `/paciente/${pacienteId}/lecturas-recientes?n=${n}`
    );

    pag.salud.fullData = lecturas;
    pag.salud.paciente = paciente;
    pag.salud._patient = pacienteId;
    pag.salud._n = n;
    pag.salud.page = 1;

    if (!lecturas.length) {
      resultado.innerHTML = sinResultados('Sin lecturas para este paciente.');
      return;
    }
    renderSaludPage();
  } catch (e) { resultado.innerHTML = errorHTML(e.message); }
}

function renderSaludPage() {
  const resultado = document.getElementById('s-result');
  const d = pag.salud;
  const page = d.page;
  const lecturas = d.fullData;
  const paciente = d.paciente;
  const meta = pagMeta(lecturas.length, page, d.perPage);
  const pageData = pagSlice(lecturas, page, d.perPage);
  const globalOffset = (page - 1) * d.perPage;
  const criticos = lecturas.filter(l => l.critico).length;

  resultado.innerHTML = `
    <div class="salud-header">
      <div class="salud-patient-name">${paciente.nombre}</div>
      <div class="text-muted" style="font-size:.85rem">${paciente._id} &middot; ${paciente.condicion_cronica ?? 'Sin condicion'}</div>
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
          <tr><th>#</th><th>Timestamp</th><th>Sensor</th><th>Valor</th><th>Unidad</th><th>Estado</th></tr>
        </thead>
        <tbody>
          ${pageData.map((l, i) => `
            <tr class="${l.critico ? 'row-critical' : ''}">
              <td class="text-muted">${globalOffset + i + 1}</td>
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
    </div>
    <div id="s-pagination"></div>`;
  renderPagination('s-pagination', meta, (p) => { d.page = p; renderSaludPage(); });
}

// =========================================================
// KPI 3 — PACIENTES POR RIESGO (client-side pagination)
// =========================================================
async function buscarPacientesPorRiesgo(page = 1) {
  const medicoId = document.getElementById('r-medico').value;
  if (!medicoId) return alertar('Selecciona un medico.');

  const resultado = document.getElementById('rr-result');

  if (pag.riesgo.fullData.length && pag.riesgo._medico === medicoId && page !== 1) {
    pag.riesgo.page = page;
    renderRiesgoPage();
    return;
  }

  resultado.innerHTML = cargando();
  try {
    const pacientes = await apiFetch(`/medico/${medicoId}/pacientes-por-riesgo`);
    pag.riesgo.fullData = pacientes;
    pag.riesgo._medico = medicoId;
    pag.riesgo.page = 1;

    if (!pacientes.length) {
      resultado.innerHTML = sinResultados('Este medico no tiene pacientes activos.');
      return;
    }
    renderRiesgoPage();
  } catch (e) { resultado.innerHTML = errorHTML(e.message); }
}

function renderRiesgoPage() {
  const resultado = document.getElementById('rr-result');
  const d = pag.riesgo;
  const page = d.page;
  const pacientes = d.fullData;
  const meta = pagMeta(pacientes.length, page, d.perPage);
  const pageData = pagSlice(pacientes, page, d.perPage);
  const alto = pacientes.filter(p => p.riesgo >= 1).length;
  const bajo = pacientes.length - alto;

  resultado.innerHTML = `
    <div class="riesgo-summary">
      <span class="chip chip-blue">${pacientes.length} paciente(s)</span>
      ${alto > 0 ? `<span class="chip chip-red">${alto} en riesgo</span>` : ''}
      <span class="chip chip-green">${bajo} estable(s)</span>
    </div>
    <div class="patient-grid">
      ${pageData.map(p => {
        const ulv = p.ultima_lectura_vital;
        const riesgoNivel = p.riesgo >= 1 ? 'alto' : 'bajo';
        return `
          <div class="patient-card riesgo-${riesgoNivel}">
            <div class="patient-name">${p.nombre}</div>
            <div class="patient-meta">
              ${p._id} &middot; ${p.genero === 'M' ? 'Masculino' : 'Femenino'} &middot;
              <span class="text-muted">${p.condicion_cronica}</span>
            </div>
            <div class="riesgo-badge riesgo-${riesgoNivel}">
              ${p.riesgo >= 1 ? 'Riesgo alto' : 'Estable'}
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
    </div>
    <div id="rr-pagination"></div>`;
  renderPagination('rr-pagination', meta, (p) => { d.page = p; renderRiesgoPage(); });
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
    buscarAlertas(1);
    alertasAutoRefreshInterval = setInterval(() => {
      alertasCountdown = 30;
      buscarAlertas(pag.alertas.page);
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
// KPI 1 — RENDIMIENTO (no pagination, small dataset)
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
            <tr><th>Endpoint</th><th>Llamadas</th><th>Promedio</th><th>Minimo</th><th>Maximo</th><th>P95</th></tr>
          </thead>
          <tbody>
            ${metricas.map(m => {
              const cls = m.promedio_ms < 50 ? 'text-green'
                        : m.promedio_ms < 200 ? 'text-amber'
                        : 'text-red';
              return `
                <tr>
                  <td class="fw-bold" style="font-family:'JetBrains Mono',monospace;font-size:.82rem">${m.endpoint}</td>
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
  } catch (e) { resultado.innerHTML = errorHTML(e.message); }
}

// =========================================================
// UTILITIES
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

function alertar(msg) { alert(msg); }

function cargando() {
  return `<div class="loading"><div class="spinner"></div>Consultando base de datos...</div>`;
}

function sinResultados(msg) {
  return `<div class="empty-state"><div class="empty-icon">&#x1f50d;</div><div>${msg}</div></div>`;
}

function errorHTML(msg) {
  return `
    <div class="empty-state">
      <div class="empty-icon">&#x26a0;&#xfe0f;</div>
      <div class="text-red fw-bold">Error de conexion</div>
      <div class="text-muted" style="margin-top:.5rem;font-size:.85rem">${msg}</div>
      <div class="text-muted" style="margin-top:.5rem;font-size:.8rem">
        Verifica que MongoDB y <code>python server.py</code> esten corriendo.
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

function esCritico(sensor, valor) {
  const u = umbralesSensores[sensor];
  if (!u || !u.umbral_critico) return false;
  const direction = u.direccion || 'mayor';
  return direction === 'mayor' ? valor > u.umbral_critico : valor < u.umbral_critico;
}

function iconoSensor(sensor) {
  const iconos = {
    glucosa: '\u{1FA78}', frecuencia_cardiaca: '\u2764\uFE0F',
    saturacion_oxigeno: '\u{1F4A8}', presion_sistolica: '\u{1FAC0}',
    horas_sueno: '\u{1F634}',
  };
  return iconos[sensor] ?? '\u{1F4CA}';
}

function labelSensor(sensor) {
  const labels = {
    glucosa: 'Glucosa', frecuencia_cardiaca: 'Frec. Cardiaca',
    saturacion_oxigeno: 'Saturacion O2', presion_sistolica: 'Presion Sistolica',
    horas_sueno: 'Horas de Sueno',
  };
  return labels[sensor] ?? sensor;
}

function chipEsp(especialidad) {
  const map = {
    'Cardiologia': 'chip-red', 'Endocrinologia': 'chip-amber',
    'Medicina General': 'chip-green', 'Neumologia': 'chip-green',
    'Geriatria': 'chip-purple',
  };
  return map[especialidad] ?? 'chip-blue';
}
