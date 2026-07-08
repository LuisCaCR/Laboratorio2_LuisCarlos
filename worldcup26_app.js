"use strict";

/* ──────────────────────────────────────────────────────
   CONFIGURACIÓN
────────────────────────────────────────────────────── */
const BASE = "https://worldcup26.ir";

/* ──────────────────────────────────────────────────────
   ESTADO DE APLICACIÓN
   Separamos claramente los tres recursos para que el fallo
   de uno no contamine el estado de los otros.
────────────────────────────────────────────────────── */
const state = {
  teams:          [],
  games:          [],
  gamesLoaded:    false,
  stadiums:       [],
  stadiumsLoaded: false,
  selectedTeamId: null,
};

/* ──────────────────────────────────────────────────────
   SELECTORES DOM
────────────────────────────────────────────────────── */
const teamSelect     = document.getElementById("teamSelect");
const teamInfo     = document.getElementById("teamInfo");
const cardsGrid       = document.getElementById("cardsGrid");
const statsBar        = document.getElementById("statsBar");
const sectionEyebrow  = document.getElementById("sectionEyebrow");
const citiesSection   = document.getElementById("citiesSection");
const apiStatus       = document.getElementById("apiStatus");
const alertBanner      = document.getElementById("alertBanner");
const alertMsg         = document.getElementById("alertMsg");

/* ──────────────────────────────────────────────────────
   NAVEGACIÓN ENTRE PANTALLAS
   Cambia la clase "active" en el botón de nav y en la
   sección correspondiente. No recarga ni destruye datos
   ya cargados de otras pantallas.
────────────────────────────────────────────────────── */
const viewNav = document.getElementById("viewNav");

const loadedViews = new Set(["ruta"]); // pantalla 1 ya se carga en init()

const viewLoaders = {
  goleadas: loadGoleadas,
   muro: loadMuro,
   estadios: loadEstadios,
  empates: loadEmpates,
  // muro, estadios y empates se agregan más adelante
};

function switchView(viewName) {
  document.querySelectorAll(".view-nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach(section => {
    section.classList.toggle("active", section.id === `view-${viewName}`);
  });

  if (!loadedViews.has(viewName) && viewLoaders[viewName]) {
    loadedViews.add(viewName);
    viewLoaders[viewName]();
  }
}

function initNav() {
  viewNav.addEventListener("click", (event) => {
    const btn = event.target.closest(".view-nav-btn");
    if (!btn) return;
    switchView(btn.dataset.view);
  });
}

/* ──────────────────────────────────────────────────────
   POBLAR SELECTOR DE EQUIPOS
   Datos obtenidos de /get/teams, ordenados alfabéticamente.
────────────────────────────────────────────────────── */
function populateTeamSelector() {
  const sortedTeamList = [...state.teams].sort((a, b) => {
    const na = a.name_en ?? "";
    const nb = b.name_en ?? "";
    return na.localeCompare(nb);
  });

  teamSelect.innerHTML =
    `<option value="">— Selecciona un equipo (${sortedTeamList.length}) —</option>`;

  sortedTeamList.forEach(team => {
    const opt = document.createElement("option");
    opt.value = String(team.id);
    opt.textContent = team.name_en ?? `Equipo ${team.id}`;
    teamSelect.appendChild(opt);
  });

  addEventToTeamSelect();
  teamSelect.disabled = false;
}

/* ──────────────────────────────────────────────────────
   EVENTO: cambio de equipo en el selector
────────────────────────────────────────────────────── */
function addEventToTeamSelect() {
  teamSelect.addEventListener("change", handleTeamChange);
}

async function handleTeamChange() {
  const tid = teamSelect.value;

  if (!tid) {
    teamInfo.style.display = "none";
    cardsGrid.innerHTML = "";
    statsBar.classList.remove("visible");
    citiesSection.classList.remove("visible");
    sectionEyebrow.classList.remove("visible");
    alertBanner.classList.remove("visible");
    return;
  }

  state.selectedTeamId = tid;
  const team = getTeamById(tid);
  if (!team) return;

  teamInfo.style.display = "block";
  document.getElementById("teamFlagImg").src = team.flag;
  document.getElementById("teamFlagImg").alt = `Bandera de ${team.name_en}`;
  document.getElementById("teamName").textContent = team.name_en;

  cardsGrid.innerHTML = `<p class="state-placeholder">Cargando partidos…</p>`;
  alertBanner.classList.remove("visible");

  const gamesOk = await ensureGamesLoaded();
  if (!gamesOk) {
    cardsGrid.innerHTML = `<p class="state-placeholder">No se pudieron cargar los partidos. Intenta de nuevo más tarde.</p>`;
    return;
  }

  if (!state.stadiumsLoaded) {
    const stadiumsOk = await ensureStadiumsLoaded();
    if (!stadiumsOk) {
      renderRutaItinerary(team);
      alertBanner.classList.add("visible");
      retryStadiumsWithBackoff();
      return;
    }
  }

  renderRutaItinerary(team);
}

/* ──────────────────────────────────────────────────────
   Init: carga inicial de los tres endpoints
────────────────────────────────────────────────────── */
async function init() {
  initNav();

  await fetch(`${BASE}/get/teams`)
    .then(response => response.json())
    .then(jsondata => {
      state.teams = jsondata.teams;
      populateTeamSelector();
    })
    .catch(err => {
      console.error("Error al cargar equipos:", err);
    });
}
/* ──────────────────────────────────────────────────────
   PANTALLA 2: RASTREADOR DE GOLEADAS
────────────────────────────────────────────────────── */
const goleadasGrid     = document.getElementById("goleadasGrid");
const goleadasEyebrow  = document.getElementById("goleadasEyebrow");
const goleadasCount    = document.getElementById("goleadasCount");

function getTeamById(id) {
  return state.teams.find(t => String(t.id) === String(id));
}

function buildGoleadaCard(game) {
  const home = getTeamById(game.home_team_id);
  const away = getTeamById(game.away_team_id);

  const homeLabel = home ? home.name_en : `Equipo ${game.home_team_id}`;
  const awayLabel = away ? away.name_en : `Equipo ${game.away_team_id}`;
  const homeFlag  = home ? `<img src="${home.flag}" alt="" class="mini-flag">` : "";
  const awayFlag  = away ? `<img src="${away.flag}" alt="" class="mini-flag">` : "";

  const card = document.createElement("div");
  card.className = "match-card";
  card.innerHTML = `
    <div class="card-stripe"></div>
    <div class="card-header">
      <div class="card-matchup">
        <div class="card-round">Diferencia de ${game.diff} goles</div>
        <div class="card-teams">
          ${homeFlag}${homeLabel} ${game.home_score} — ${game.away_score} ${awayLabel}${awayFlag}
        </div>
      </div>
    </div>
  `;
  return card;
}

function renderGoleadas(goleadas) {
  goleadasGrid.innerHTML = "";

 if (goleadas.length === 0) {
    goleadasGrid.innerHTML = `<p class="state-placeholder">Aún no hay partidos finalizados con diferencia ≥ 3 goles. Vuelve cuando avance el torneo.</p>`;
  } else {
    goleadas.forEach(game => goleadasGrid.appendChild(buildGoleadaCard(game)));
  }


  goleadasCount.textContent = goleadas.length;
  goleadasEyebrow.classList.add("visible");
}

async function loadGoleadas() {
  let games;
  try {
    const response = await fetch(`${BASE}/get/games`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    games = data.games;
  } catch (err) {
    console.error("Error al cargar partidos (goleadas):", err);
    goleadasGrid.innerHTML = `<p class="state-placeholder">No se pudieron cargar los partidos. Intenta de nuevo más tarde.</p>`;
    return;
  }

  const goleadas = games
    .filter(g => g.finished === true)
    .map(g => ({ ...g, diff: Math.abs(g.home_score - g.away_score) }))
    .filter(g => g.diff >= 3)
    .sort((a, b) => b.diff - a.diff);

  // Reto de resiliencia: si /get/teams falla, mostramos ids como
  // respaldo sin bloquear la lista, y reintentamos en segundo plano.
  if (state.teams.length === 0) {
    renderGoleadas(goleadas);
    try {
      const teamsResponse = await fetch(`${BASE}/get/teams`);
      if (!teamsResponse.ok) throw new Error(`HTTP ${teamsResponse.status}`);
      const teamsData = await teamsResponse.json();
      state.teams = teamsData.teams;
      renderGoleadas(goleadas); // re-render con nombres reales
    } catch (err) {
      console.error("Error al cargar equipos (goleadas):", err);
    }
  } else {
    renderGoleadas(goleadas);
  }
}

/* ──────────────────────────────────────────────────────
   PANTALLA 3: EL MURO
────────────────────────────────────────────────────── */
const muroGrid    = document.getElementById("muroGrid");
const muroEyebrow = document.getElementById("muroEyebrow");
const muroCount   = document.getElementById("muroCount");

function buildMuroCard(rank, teamStats, team, rivalLabel, rivalOk) {
  const flagHtml = team ? `<img src="${team.flag}" alt="" class="mini-flag">` : "";
  const nameLabel = team ? team.name_en : `Equipo ${teamStats.team_id}`;

  const card = document.createElement("div");
  card.className = "match-card";
  card.innerHTML = `
    <div class="card-stripe"></div>
    <div class="card-header">
      <span class="rank-badge">${rank}</span>
      <div class="card-matchup">
        <div class="card-teams">${flagHtml}${nameLabel}</div>
        <div class="card-round">Goles en contra: ${teamStats.ga}</div>
      </div>
    </div>
    <div class="card-body">
      <div class="card-row ${rivalOk ? "" : "stadium-error"}">
        <div class="card-icon">⚔️</div>
        <div class="card-row-content">
          <div class="card-row-label">Próximo rival</div>
          <div class="card-row-value">${rivalLabel}</div>
        </div>
      </div>
    </div>
  `;
  return card;
}

function findNextOpponentLabel(teamId, games) {
  const upcoming = games
    .filter(g => !g.finished && (String(g.home_team_id) === String(teamId) || String(g.away_team_id) === String(teamId)))
    .sort((a, b) => new Date(a.local_date) - new Date(b.local_date));

  if (upcoming.length === 0) return "Sin próximo partido programado";

  const next = upcoming[0];
  const opponentId = String(next.home_team_id) === String(teamId) ? next.away_team_id : next.home_team_id;
  const opponent = getTeamById(opponentId);
  return opponent ? opponent.name_en : `Equipo ${opponentId}`;
}

async function loadMuro() {
  let groups, games;

  try {
    const groupsResponse = await fetch(`${BASE}/get/groups`);
    if (!groupsResponse.ok) throw new Error(`HTTP ${groupsResponse.status}`);
    const groupsData = await groupsResponse.json();
    groups = groupsData.groups;
  } catch (err) {
    console.error("Error al cargar grupos:", err);
    muroGrid.innerHTML = `<p class="state-placeholder">No se pudieron cargar los grupos. Intenta de nuevo más tarde.</p>`;
    return;
  }

  // Unificamos los 48 registros (team_id + ga) de los 12 grupos
  const allTeamStats = [];
  groups.forEach(group => {
    group.teams.forEach(t => {
      allTeamStats.push({ team_id: t.team_id, ga: t.ga });
    });
  });

  const top5 = allTeamStats.sort((a, b) => a.ga - b.ga).slice(0, 5);

  // Aseguramos tener equipos cargados para nombre y bandera
  if (state.teams.length === 0) {
    try {
      const teamsResponse = await fetch(`${BASE}/get/teams`);
      if (!teamsResponse.ok) throw new Error(`HTTP ${teamsResponse.status}`);
      const teamsData = await teamsResponse.json();
      state.teams = teamsData.teams;
    } catch (err) {
      console.error("Error al cargar equipos (muro):", err);
    }
  }

  // Partidos para calcular próximo rival de cada uno de los 5
  try {
    const gamesResponse = await fetch(`${BASE}/get/games`);
    if (!gamesResponse.ok) throw new Error(`HTTP ${gamesResponse.status}`);
    const gamesData = await gamesResponse.json();
    games = gamesData.games;
  } catch (err) {
    console.error("Error al cargar partidos (muro):", err);
    games = null; // se maneja por-equipo abajo
  }

  muroGrid.innerHTML = "";
  top5.forEach((teamStats, index) => {
    const team = getTeamById(teamStats.team_id);
    let rivalLabel, rivalOk;

    // Reto de resiliencia: la búsqueda de rival se evalúa equipo
    // por equipo; si games no cargó, ese registro cae en el mensaje
    // de "no disponible" sin afectar a los otros 4.
    try {
      if (!games) throw new Error("Sin datos de partidos");
      rivalLabel = findNextOpponentLabel(teamStats.team_id, games);
      rivalOk = true;
    } catch (err) {
      rivalLabel = "Próximo rival no disponible";
      rivalOk = false;
    }

    muroGrid.appendChild(buildMuroCard(index + 1, teamStats, team, rivalLabel, rivalOk));
  });

  muroCount.textContent = top5.length;
  muroEyebrow.classList.add("visible");
}
/* ──────────────────────────────────────────────────────
   PANTALLA 4: ANALÍTICA DE ESTADIOS
────────────────────────────────────────────────────── */
const estadiosChart   = document.getElementById("estadiosChart");
const estadiosEyebrow = document.getElementById("estadiosEyebrow");
const estadiosCount   = document.getElementById("estadiosCount");

function renderEstadiosChart(rows, pending) {
  estadiosChart.innerHTML = "";

  const maxAttendance = Math.max(...rows.map(r => r.potential), 1);

  rows.forEach(row => {
    const pct = Math.round((row.potential / maxAttendance) * 100);

    const rowEl = document.createElement("div");
    rowEl.className = "chart-row";
    rowEl.innerHTML = `
      <div class="chart-label">${row.name}</div>
      <div class="chart-track">
        <div class="chart-bar" style="width:${pct}%"></div>
      </div>
      <div class="chart-value">${row.potential.toLocaleString("es-CR")}</div>
    `;
    estadiosChart.appendChild(rowEl);
  });

  if (pending) {
    const note = document.createElement("p");
    note.className = "chart-pending-note";
    note.textContent = "⏳ Esperando datos de partidos para completar el conteo por estadio…";
    estadiosChart.appendChild(note);
  }

  estadiosCount.textContent = rows.length;
  estadiosEyebrow.classList.add("visible");
}

async function loadEstadios() {
  let stadiums;

  try {
    const stadiumsResponse = await fetch(`${BASE}/get/stadiums`);
    if (!stadiumsResponse.ok) throw new Error(`HTTP ${stadiumsResponse.status}`);
    const stadiumsData = await stadiumsResponse.json();
    stadiums = stadiumsData.stadiums;
  } catch (err) {
    console.error("Error al cargar estadios:", err);
    estadiosChart.innerHTML = `<p class="state-placeholder">No se pudieron cargar los estadios. Intenta de nuevo más tarde.</p>`;
    return;
  }

  // Reto de resiliencia: si los estadios cargaron pero /get/games
  // falla después, mostramos las barras en "esperando datos de
  // partidos" en lugar de destruir lo ya dibujado.
  let games;
  try {
    const gamesResponse = await fetch(`${BASE}/get/games`);
    if (!gamesResponse.ok) throw new Error(`HTTP ${gamesResponse.status}`);
    const gamesData = await gamesResponse.json();
    games = gamesData.games;
  } catch (err) {
    console.error("Error al cargar partidos (estadios):", err);
    const placeholderRows = stadiums.map(s => ({ name: s.city_en ?? `Estadio ${s.id}`, potential: 0 }));
    renderEstadiosChart(placeholderRows, true);
    return;
  }

  const rows = stadiums.map(stadium => {
    const gamesHere = games.filter(g => String(g.stadium_id) === String(stadium.id)).length;
    return {
      name: stadium.city_en ?? `Estadio ${stadium.id}`,
      potential: stadium.capacity * gamesHere
    };
  }).sort((a, b) => b.potential - a.potential);

  renderEstadiosChart(rows, false);
}

/* ──────────────────────────────────────────────────────
   PANTALLA 5: RADAR DE EMPATES
   Incluye backoff exponencial con countdown visible para
   errores 429, y reintento en segundo plano para 500,
   sin bloquear los grupos que ya se dibujaron.
────────────────────────────────────────────────────── */
const empatesMatrix  = document.getElementById("empatesMatrix");
const empatesEyebrow = document.getElementById("empatesEyebrow");
const empatesCount   = document.getElementById("empatesCount");
const empatesRetry   = document.getElementById("empatesRetry");

function showRetryCountdown(seconds, attempt) {
  empatesRetry.style.display = "block";
  let remaining = seconds;

  return new Promise(resolve => {
    const tick = () => {
      empatesRetry.textContent =
        `⏱️ Intento ${attempt}: reintentando en ${remaining}s…`;
      if (remaining <= 0) {
        empatesRetry.style.display = "none";
        resolve();
      } else {
        remaining -= 1;
        setTimeout(tick, 1000);
      }
    };
    tick();
  });
}

function buildTieMatrix(ties) {
  empatesMatrix.innerHTML = "";

  const byGroup = {};
  ties.forEach(g => {
    const key = g.group ?? "Sin grupo";
    if (!byGroup[key]) byGroup[key] = [];
    byGroup[key].push(g);
  });

  const groupKeys = Object.keys(byGroup).sort();

  if (groupKeys.length === 0) {
    empatesMatrix.innerHTML = `<p class="state-placeholder">Aún no hay empates registrados con partidos finalizados.</p>`;
    return;
  }

  groupKeys.forEach(key => {
    const block = document.createElement("div");
    block.className = "group-block";

    const cellsHtml = byGroup[key].map(g => {
      const home = getTeamById(g.home_team_id);
      const away = getTeamById(g.away_team_id);
      const homeLabel = home ? home.name_en : `Equipo ${g.home_team_id}`;
      const awayLabel = away ? away.name_en : `Equipo ${g.away_team_id}`;
      return `<div class="tie-cell">${homeLabel} ${g.home_score} — ${g.away_score} ${awayLabel}</div>`;
    }).join("");

    block.innerHTML = `
      <div class="group-block-title">Grupo ${key}</div>
      ${cellsHtml}
    `;
    empatesMatrix.appendChild(block);
  });

  empatesCount.textContent = ties.length;
  empatesEyebrow.classList.add("visible");
}

async function fetchGamesWithBackoff(maxAttempts = 4) {
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await fetch(`${BASE}/get/games`);

      if (response.status === 429 || response.status === 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      return data.games;
    } catch (err) {
      console.error(`Intento ${attempt} falló al cargar partidos (empates):`, err);
      if (attempt >= maxAttempts) return null;

      const waitSeconds = Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s
      await showRetryCountdown(waitSeconds, attempt);
    }
  }
  return null;
}

async function loadEmpates() {
  const games = await fetchGamesWithBackoff();

  if (!games) {
    empatesMatrix.innerHTML = `<p class="state-placeholder">No se pudieron cargar los partidos tras varios intentos.</p>`;
    return;
  }

  const ties = games.filter(g => g.finished === true && g.home_score === g.away_score);

  if (state.teams.length === 0) {
    try {
      const teamsResponse = await fetch(`${BASE}/get/teams`);
      if (!teamsResponse.ok) throw new Error(`HTTP ${teamsResponse.status}`);
      const teamsData = await teamsResponse.json();
      state.teams = teamsData.teams;
    } catch (err) {
      console.error("Error al cargar equipos (empates):", err);
    }
  }

  buildTieMatrix(ties);
}

/* ──────────────────────────────────────────────────────
   CARGA DE PARTIDOS Y ESTADIOS (con cache en state)
   Cada endpoint se pide una sola vez y se reutiliza entre
   selecciones de equipo distintas.
────────────────────────────────────────────────────── */
async function ensureGamesLoaded() {
  if (state.gamesLoaded) return true;
  try {
    const response = await fetch(`${BASE}/get/games`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.games = data.games;
    state.gamesLoaded = true;
    return true;
  } catch (err) {
    console.error("Error al cargar partidos (ruta):", err);
    return false;
  }
}

async function ensureStadiumsLoaded() {
  try {
    const response = await fetch(`${BASE}/get/stadiums`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.stadiums = data.stadiums;
    state.stadiumsLoaded = true;
    return true;
  } catch (err) {
    console.error("Error al cargar estadios (ruta):", err);
    return false;
  }
}

function getStadiumById(id) {
  return state.stadiums.find(s => String(s.id) === String(id));
}

/* ──────────────────────────────────────────────────────
   RENDER: itinerario del equipo seleccionado
────────────────────────────────────────────────────── */
function buildRutaCard(game, team) {
  const isHome = String(game.home_team_id) === String(team.id);
  const opponentId = isHome ? game.away_team_id : game.home_team_id;
  const opponent = getTeamById(opponentId);
  const opponentLabel = opponent ? opponent.name_en : `Equipo ${opponentId}`;

  const stadium = state.stadiumsLoaded ? getStadiumById(game.stadium_id) : null;
  const stadiumOk = state.stadiumsLoaded && stadium;

  const stadiumValueHtml = stadiumOk
    ? `${stadium.city_en ?? "—"}, ${stadium.country_en ?? "—"}`
    : "Estadio no disponible";
  const stadiumSubHtml = stadiumOk
    ? `<div class="card-row-sub">Aforo: ${Number(stadium.capacity).toLocaleString("es-CR")}</div>`
    : "";

  const card = document.createElement("div");
  card.className = `match-card ${isHome ? "home" : ""}`;
  card.innerHTML = `
    <div class="card-stripe"></div>
    <div class="card-header">
      <div class="card-matchup">
        <div class="card-round">${game.local_date ?? "Fecha por confirmar"}</div>
        <div class="card-teams">
          <span class="team-highlight">${team.name_en}</span> vs ${opponentLabel}
        </div>
      </div>
      <span class="card-role-badge ${isHome ? "role-home" : "role-away"}">
        ${isHome ? "Local" : "Visitante"}
      </span>
    </div>
    <div class="card-body">
      <div class="card-row ${stadiumOk ? "" : "stadium-error"}">
        <div class="card-icon">🏟️</div>
        <div class="card-row-content">
          <div class="card-row-label">Estadio</div>
          <div class="card-row-value">${stadiumValueHtml}</div>
          ${stadiumSubHtml}
        </div>
      </div>
    </div>
  `;
  return card;
}

function renderRutaItinerary(team) {
  const teamGames = state.games
    .filter(g => String(g.home_team_id) === String(team.id) || String(g.away_team_id) === String(team.id))
    .sort((a, b) => new Date(a.local_date) - new Date(b.local_date));

  cardsGrid.innerHTML = "";
  if (teamGames.length === 0) {
    cardsGrid.innerHTML = `<p class="state-placeholder">Este equipo no tiene partidos programados todavía.</p>`;
  } else {
    teamGames.forEach(game => cardsGrid.appendChild(buildRutaCard(game, team)));
  }

  // Estadísticas
  const homeGames = teamGames.filter(g => String(g.home_team_id) === String(team.id));
  const awayGames = teamGames.filter(g => String(g.away_team_id) === String(team.id));

  const cityNames = new Set();
  if (state.stadiumsLoaded) {
    teamGames.forEach(g => {
      const stadium = getStadiumById(g.stadium_id);
      if (stadium && stadium.city_en) cityNames.add(stadium.city_en);
    });
  }

  document.getElementById("statGames").textContent = teamGames.length;
  document.getElementById("statCities").textContent = state.stadiumsLoaded ? cityNames.size : "—";
  document.getElementById("statHome").textContent = homeGames.length;
  document.getElementById("statAway").textContent = awayGames.length;
  statsBar.classList.add("visible");

  // Chips de ciudades
  const citiesChips = document.getElementById("citiesChips");
  citiesChips.innerHTML = "";
  if (cityNames.size > 0) {
    [...cityNames].sort().forEach(city => {
      const chip = document.createElement("span");
      chip.className = "city-chip";
      chip.textContent = city;
      citiesChips.appendChild(chip);
    });
    citiesSection.classList.add("visible");
  } else {
    citiesSection.classList.remove("visible");
  }

  document.getElementById("eyebrowCount").textContent = teamGames.length;
  sectionEyebrow.classList.add("visible");
}

/* ──────────────────────────────────────────────────────
   RETO DE RESILIENCIA: backoff exponencial solo para
   /get/stadiums, sin volver a pedir /get/games.
────────────────────────────────────────────────────── */
async function retryStadiumsWithBackoff(maxAttempts = 4) {
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    const waitSeconds = Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s

    await new Promise(resolve => {
      let remaining = waitSeconds;
      const tick = () => {
        alertMsg.textContent =
          `Reintentando estadios (intento ${attempt}) en ${remaining}s…`;
        if (remaining <= 0) return resolve();
        remaining -= 1;
        setTimeout(tick, 1000);
      };
      tick();
    });

    const ok = await ensureStadiumsLoaded();
    if (ok) {
      alertBanner.classList.remove("visible");
      // Re-renderizamos con los partidos YA cargados (no se piden de nuevo)
      const currentTeam = getTeamById(state.selectedTeamId);
      if (currentTeam) renderRutaItinerary(currentTeam);
      return;
    }
  }

  alertMsg.textContent = "No se pudo cargar la información de estadios tras varios intentos.";
}

/* Punto de entrada */
init();