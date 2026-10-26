// Browser entry point: wires the map, panels and turn controls to the simulation.
import { deterministicPolicy } from '../ai/deterministic.ts';
import type { GameState, UnitId } from '../core/types.ts';
import { CIVS } from '../data/civs.ts';
import { DEPOSITS, TERRAIN } from '../data/terrain.ts';
import { UNITS, UNIT_ORDER, armySpeed, totalRegiments } from '../data/units.ts';
import { parseSave, serializeSave } from '../persistence/save.ts';
import { SLOTS, readSlot, storageAvailable, writeSlot, type Slot } from '../persistence/storage.ts';
import { acceptPeaceOffer, declinePeaceOffer, proposePeace } from '../sim/diplomacy.ts';
import {
  canDeclareWar, canRecruit, cancelRecruit, declareWar, halfOf, log, mergeArmies, recruit,
  setArmyDestination, splitArmy,
} from '../sim/orders.ts';
import {
  armiesIn, armiesOf, armyStrength, atWar, budget, dateLabel, enemiesOf, estimateStrength, findWar,
  isBesiegedByEnemy, knownEvents, ownedProvinces, provinceYield, regimentsOf, truceUntil, trueMilitaryStrength, unitCost,
  visibleProvinces,
} from '../sim/queries.ts';
import { VICTORY_SHARE, processTurn } from '../sim/turn.ts';
import { DEFAULT_SETTINGS, generateWorld, setPlayer } from '../world/generate.ts';
import { MapView } from './map.ts';

type Tab = 'province' | 'army' | 'realm' | 'nations' | 'chronicle';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const signed = (n: number, d = 1) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n), d);

const ui = {
  state: null as GameState | null,
  mode: 'setup' as 'setup' | 'play',
  player: null as number | null,
  selProv: null as number | null,
  selArmy: null as number | null,
  tab: 'province' as Tab,
  sheetOpen: true,
  pickNation: null as number | null,
  seed: Math.floor(Math.random() * 1e6),
  countryCount: DEFAULT_SETTINGS.countryCount,
  confirmWar: null as number | null,
  chronicleMine: false,
  endShown: false,
  busy: false,
};

const map = new MapView($<HTMLCanvasElement>('#map'));

// ------------------------------------------------------------------ helpers

function S(): GameState { return ui.state!; }
function me() { return ui.player !== null ? S().countries[ui.player] : null; }
function swatch(id: number) { return `<span class="swatch" style="background:${S().countries[id].color}"></span>`; }
function countryName(id: number) { return esc(S().countries[id].name); }

let toastTimer = 0;
function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.className = 'toast'; }, 3200);
}

function bar(frac: number, kind = '') {
  return `<span class="bar ${kind}"><span style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></span></span>`;
}

function relationPill(other: number) {
  if (ui.player === null || other === ui.player) return '<span class="pill you">You</span>';
  if (!S().countries[other].alive) return '<span class="pill gone">Fallen</span>';
  if (atWar(S(), ui.player, other)) return '<span class="pill war">At war</span>';
  const t = truceUntil(S(), ui.player, other);
  if (t !== null) return `<span class="pill truce">Truce · ${t - S().turn} turns</span>`;
  return '<span class="pill peace">At peace</span>';
}

function autosave() {
  if (!ui.state || ui.mode !== 'play') return;
  writeSlot('auto', serializeSave(S(), saveLabel()));
}

function saveLabel() {
  const c = me();
  return `${c ? c.name : 'Observer'} · ${dateLabel(S().turn)}`;
}

// ------------------------------------------------------------------ setup

function newWorld() {
  ui.state = generateWorld(ui.seed, { ...DEFAULT_SETTINGS, countryCount: ui.countryCount });
  ui.mode = 'setup';
  ui.player = null;
  ui.pickNation = null;
  ui.selProv = null;
  ui.selArmy = null;
  ui.endShown = false;
  map.political = true;
  map.setWorld(S());
  refresh();
}

function begin() {
  if (ui.pickNation === null) { toast('Choose a nation first: tap it on the map or in the list.', 'err'); return; }
  ui.player = ui.pickNation;
  setPlayer(S(), ui.player);
  ui.mode = 'play';
  ui.tab = 'realm';
  log(S(), { type: 'info', participants: [ui.player], visibility: 'participants', text: `You take the throne of ${S().countries[ui.player].name}.` });
  autosave();
  map.centerOn(S().countries[ui.player].capital);
  refresh();
}

function loadState(state: GameState, how: string) {
  ui.state = state;
  ui.mode = 'play';
  ui.player = state.countries.find((c) => c.isPlayer)?.id ?? null;
  ui.selArmy = null;
  ui.selProv = null;
  ui.tab = 'realm';
  ui.endShown = state.winner !== null || (ui.player !== null && !state.countries[ui.player].alive);
  map.political = true;
  map.setWorld(state);
  if (ui.player !== null) map.centerOn(state.countries[ui.player].capital);
  closeModal();
  refresh();
  toast(how);
}

// ------------------------------------------------------------------ turn

function endTurn() {
  if (!ui.state || ui.mode !== 'play' || ui.busy) return;
  ui.busy = true;
  const t0 = performance.now();
  processTurn(S(), deterministicPolicy);
  const ms = performance.now() - t0;
  ui.confirmWar = null;
  if (ui.selArmy !== null && !S().armies.some((a) => a.id === ui.selArmy)) ui.selArmy = null;
  map.renderBase();
  autosave();
  ui.busy = false;
  refresh();
  const fresh = knownEvents(S(), ui.player).filter((e) => e.turn === S().turn - 1);
  const mine = fresh.filter((e) => ui.player !== null && e.participants.includes(ui.player));
  toast(`${dateLabel(S().turn)} · ${mine.length ? `${mine.length} event${mine.length > 1 ? 's' : ''} involve you` : `${fresh.length} events abroad`} · ${ms.toFixed(0)} ms`);
  afterTurnModals();
}

function afterTurnModals() {
  const s = S();
  if (!ui.endShown && ui.player !== null && !s.countries[ui.player].alive) {
    ui.endShown = true;
    openModal(`<p class="eyebrow">${dateLabel(s.turn)}</p><h2 class="title">Your realm has fallen</h2>
      <p>${countryName(ui.player)} survived ${s.turn - 1} turns. The world goes on without you.</p>
      <div class="row"><button class="btn primary" data-action="new-campaign">New campaign</button>
      <button class="btn ghost" data-action="close-modal">Watch the world</button></div>`);
    return;
  }
  if (!ui.endShown && s.winner !== null) {
    ui.endShown = true;
    const won = s.winner === ui.player;
    openModal(`<p class="eyebrow">${dateLabel(s.turn)}</p><h2 class="title">${won ? 'Hegemony achieved' : 'A hegemon rises'}</h2>
      <p>${countryName(s.winner)} holds ${Math.round(VICTORY_SHARE * 100)}% or more of the continent${won ? '. The age is yours.' : '.'}</p>
      <div class="row"><button class="btn primary" data-action="new-campaign">New campaign</button>
      <button class="btn ghost" data-action="close-modal">Keep playing</button></div>`);
    return;
  }
  const offers = s.peaceOffers.filter((o) => o.to === ui.player);
  if (offers.length) {
    openModal(`<p class="eyebrow">Diplomatic courier</p><h2 class="title">Peace offered</h2>
      ${offers.map((o) => {
        const note = [...s.log].reverse().find((e) => e.type === 'info' && e.participants[0] === o.from && e.text.includes('offers white peace'));
        const war = findWar(s, o.from, o.to)!;
        const mine = war.a === ui.player ? war.scoreA : war.scoreB, theirs = war.a === ui.player ? war.scoreB : war.scoreA;
        return `<div class="offer">
          <div class="row tight">${swatch(o.from)}<strong>${countryName(o.from)}</strong><span class="pill proposal">Proposal</span></div>
          <p class="muted">${esc(note ? note.text.replace(/^.*?offers white peace to .*?\. ?/, '') : '')}</p>
          <p class="small">Terms: white peace. Captured provinces stay with their captors, then a 12-turn truce. War score ${mine} to ${theirs}.</p>
          <div class="row"><button class="btn primary" data-action="accept-peace" data-id="${o.from}">Accept peace</button>
          <button class="btn ghost" data-action="decline-peace" data-id="${o.from}">Fight on</button></div></div>`;
      }).join('')}`);
  }
}

// ------------------------------------------------------------------ rendering

function refresh() {
  if (!ui.state) return;
  const s = S();
  map.overlay = {
    player: ui.player,
    visible: ui.mode === 'play' && ui.player !== null && s.countries[ui.player].alive ? visibleProvinces(s, ui.player) : null,
    selectedProvince: ui.selProv,
    selectedArmy: ui.selArmy,
    highlightCountry: ui.mode === 'setup' ? ui.pickNation : null,
  };
  map.invalidate();
  renderHud();
  renderTabs();
  renderPanel();
}

function renderHud() {
  const s = S();
  const c = me();
  const endBtn = $<HTMLButtonElement>('#end-turn');
  endBtn.hidden = ui.mode !== 'play';
  if (ui.mode !== 'play' || !c) {
    $('#hud').innerHTML = `<div class="hud-title"><span class="brand">Epochs of Aether</span><span class="muted small">${ui.mode === 'setup' ? 'Choose your realm' : `Observer · ${dateLabel(s.turn)}`}</span></div>
      <button class="icon-btn" data-action="menu" aria-label="Menu">☰</button>`;
    return;
  }
  const b = budget(s, c.id);
  const res = (label: string, val: number, delta: number | null, title: string) =>
    `<span class="res" title="${title}"><span class="res-label">${label}</span><span class="res-val">${fmt(val)}</span>${delta === null ? '' : `<span class="res-delta ${delta < 0 ? 'neg' : ''}">${signed(delta)}</span>`}</span>`;
  $('#hud').innerHTML = `<div class="hud-title">${swatch(c.id)}<span class="brand nation">${esc(c.name)}</span><span class="muted small">${dateLabel(s.turn)} · turn ${s.turn}</span></div>
    <button class="icon-btn" data-action="menu" aria-label="Menu">☰</button>
    <div class="res-row">
      ${res('Gold', c.treasury.gold, b.income.gold - b.expenses.gold, 'Gold per turn after army upkeep')}
      ${res('Food', c.treasury.food, b.income.food - b.expenses.food, 'Food per turn after rations')}
      ${res('Iron', c.treasury.iron, b.income.iron, 'Iron mined per turn')}
      ${res('Men', c.manpower / 1000, b.manpowerGain / 1000, 'Manpower in thousands')}
    </div>`;
}

function renderTabs() {
  const tabs: [Tab, string][] = ui.mode === 'setup'
    ? [['province', 'New campaign']]
    : [['province', 'Province'], ['army', 'Armies'], ['realm', 'Realm'], ['nations', 'Nations'], ['chronicle', 'Chronicle']];
  $('#tabs').innerHTML = tabs.map(([id, label]) =>
    `<button class="tab ${ui.tab === id || ui.mode === 'setup' ? 'active' : ''}" data-action="tab" data-tab="${id}">${label}</button>`).join('')
    + `<button class="tab collapse" data-action="toggle-sheet" aria-label="${ui.sheetOpen ? 'Collapse panel' : 'Expand panel'}">${ui.sheetOpen ? '▾' : '▴'}</button>`;
  $('#sheet').classList.toggle('collapsed', !ui.sheetOpen);
}

function renderPanel() {
  const el = $('#panel');
  if (ui.mode === 'setup') { el.innerHTML = setupPanel(); return; }
  switch (ui.tab) {
    case 'province': el.innerHTML = provincePanel(); break;
    case 'army': el.innerHTML = armyPanel(); break;
    case 'realm': el.innerHTML = realmPanel(); break;
    case 'nations': el.innerHTML = nationsPanel(); break;
    case 'chronicle': el.innerHTML = chroniclePanel(); break;
  }
}

function setupPanel() {
  const s = S();
  const hasAuto = readSlot('auto') !== null;
  const nations = s.countries.map((c) => {
    const prov = ownedProvinces(s, c.id).length;
    const civ = CIVS[c.civ];
    return `<button class="nation-card ${ui.pickNation === c.id ? 'picked' : ''}" data-action="pick-nation" data-id="${c.id}">
      <span class="row tight">${swatch(c.id)}<strong class="fell">${esc(c.name)}</strong></span>
      <span class="small muted">${civ.name} · ${prov} provinces · ${regimentsOf(s, c.id)} regiments</span>
      <span class="small">${esc(civ.description)}</span></button>`;
  }).join('');
  return `
    ${hasAuto ? `<div class="callout"><div><strong>Campaign in progress</strong><div class="small muted">${esc(autoLabel())}</div></div><button class="btn primary" data-action="continue">Continue</button></div>` : ''}
    <div class="setup-grid">
      <label class="field"><span class="eyebrow">World seed</span>
        <span class="row tight"><input id="seed" inputmode="numeric" value="${ui.seed}"><button class="btn ghost" data-action="reroll" aria-label="Random seed">Reroll</button></span></label>
      <label class="field"><span class="eyebrow">Realms</span>
        <select id="count">${[6, 8, 10, 12, 14].map((n) => `<option value="${n}" ${n === ui.countryCount ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button class="btn" data-action="generate">Generate</button>
    </div>
    <p class="small muted">${s.provinces.length} provinces, ${s.provinces.filter((p) => p.owner === null).length} of them untamed wilds. Tap a realm on the map or below.</p>
    <div class="nation-list">${nations}</div>
    <div class="sticky-cta"><button class="btn primary wide" data-action="begin" ${ui.pickNation === null ? 'disabled' : ''}>${ui.pickNation === null ? 'Choose a realm' : `Rule ${esc(s.countries[ui.pickNation].name)}`}</button>
    <button class="btn ghost" data-action="menu">Load save</button></div>`;
}

function autoLabel() {
  const r = parseSave(readSlot('auto') ?? '');
  return r.ok ? r.label : 'Autosave';
}

function provincePanel() {
  const s = S();
  if (ui.selProv === null) {
    return `<p class="empty">Tap a province on the map to inspect it. Tap one of your army banners to command it.</p>`;
  }
  const p = s.provinces[ui.selProv];
  const t = TERRAIN[p.terrain];
  const vis = map.overlay.visible;
  const seen = !vis || vis.has(p.id);
  const owner = p.owner;
  const isCapital = owner !== null && s.countries[owner].capital === p.id;
  const y = provinceYield(s, p);
  let html = `<div class="head"><div><p class="eyebrow">${t.name}${p.coastal ? ' · Coastal' : ''}${p.straits.length ? ' · Strait crossing' : ''}</p>
    <h2 class="title">${esc(p.name)}${isCapital ? ' <span class="pill capital">Capital</span>' : ''}</h2></div></div>
    <div class="kv">
      <span>Owner</span><span>${owner === null ? 'Untamed wilds' : `<button class="link" data-action="focus-country" data-id="${owner}">${swatch(owner)}${countryName(owner)}</button> ${relationPill(owner)}`}</span>
      <span>Resources</span><span>${p.deposit ? DEPOSITS[p.deposit].name : 'None'}</span>
      <span>Population</span><span>${p.population}k</span>
      <span>Fortifications</span><span>${p.fort ? `Level ${p.fort}` : 'None'} · defenders ×${t.defense.toFixed(2)} terrain</span>
      ${owner !== null ? `<span>Yield / turn</span><span class="num">${fmt(y.gold, 1)} gold · ${fmt(y.food, 1)} food · ${fmt(y.iron, 1)} iron</span>` : ''}
    </div>`;
  if (p.siege && seen) {
    const req = owner === null ? 2 : 1 + p.fort * 2;
    html += `<div class="status ${owner === null ? 'settle' : 'siege'}">${owner === null ? 'Being settled' : 'Under siege'} by ${countryName(p.siege.by)} ${bar(p.siege.progress / req, owner === null ? 'good' : 'bad')} <span class="num small">${fmt(p.siege.progress, 1)}/${req}</span></div>`;
  }
  if (owner === null) html += `<p class="small muted">Station an army here for 2 turns with no rivals present to settle it.</p>`;

  const armies = armiesIn(s, p.id).filter((a) => seen || a.owner === ui.player);
  html += `<p class="eyebrow">Armies here</p>`;
  html += armies.length ? `<div class="list">${armies.map(armyRow).join('')}</div>` : `<p class="small muted">${seen ? 'None.' : 'Beyond your sight. Armies here are unknown.'}</p>`;

  if (owner === ui.player && ui.player !== null) {
    const besieged = isBesiegedByEnemy(s, p.id);
    html += `<p class="eyebrow">Recruit${besieged ? ' (blocked: under siege)' : ''}</p><div class="units">${UNIT_ORDER.map((u) => unitCard(u, p.id)).join('')}</div>`;
    const queue = s.recruitment.map((r, i) => ({ r, i })).filter(({ r }) => r.country === ui.player && r.province === p.id);
    if (queue.length) {
      html += `<p class="eyebrow">Queued · arrives at end of turn</p><div class="list">${queue.map(({ r, i }) =>
        `<div class="item"><span>${r.count} × ${UNITS[r.unit].name}</span><button class="btn ghost small" data-action="cancel-recruit" data-id="${i}">Cancel (refund)</button></div>`).join('')}</div>`;
    }
  } else if (owner !== null && ui.player !== null && owner !== ui.player && s.countries[ui.player].alive) {
    html += diplomacyButtons(owner);
  }
  return html;
}

function unitCard(u: UnitId, provinceId: number) {
  const s = S();
  const c = me()!;
  const cost = unitCost(c.civ, u);
  const d = UNITS[u];
  const atk = d.attack * (CIVS[c.civ].unitAttack[u] ?? 1);
  const one = canRecruit(s, c.id, provinceId, u, 1);
  const three = canRecruit(s, c.id, provinceId, u, 3);
  return `<div class="unit">
    <div class="row between"><strong>${d.name}</strong><span class="small muted num">atk ${fmt(atk, 1)} · def ${d.defense} · spd ${d.speed}</span></div>
    <div class="small muted">${d.description}</div>
    <div class="small num">${cost.gold} gold${cost.iron ? ` · ${cost.iron} iron` : ''} · ${cost.manpower / 1000}k men · upkeep ${d.upkeepGold}g ${d.upkeepFood}f</div>
    <div class="row tight"><button class="btn small ${one.ok ? '' : 'off'}" data-action="recruit" data-unit="${u}" data-count="1">Recruit 1</button>
    <button class="btn small ${three.ok ? '' : 'off'}" data-action="recruit" data-unit="${u}" data-count="3">Recruit 3</button>
    ${one.ok ? '' : `<span class="small warn">${esc(one.reason)}</span>`}</div></div>`;
}

function armyRow(a: GameState['armies'][number]) {
  const s = S();
  const mine = a.owner === ui.player;
  const comp = UNIT_ORDER.filter((u) => a.units[u]).map((u) => `${a.units[u]} ${UNITS[u].name.toLowerCase()}`).join(', ');
  const strength = mine || !ui.player ? fmt(armyStrength(s, a)) : `≈${fmt(armyStrength(s, a))}`;
  return `<button class="item army ${a.id === ui.selArmy ? 'sel' : ''}" data-action="${mine ? 'select-army' : 'noop'}" data-id="${a.id}">
    <span class="row tight">${swatch(a.owner)}<strong>${totalRegiments(a.units)} regiments</strong><span class="small muted">${mine ? '' : countryName(a.owner)}</span></span>
    <span class="small muted">${comp}</span>
    <span class="row tight small">Morale ${bar(a.morale, a.morale > 0.5 ? 'good' : 'bad')} · Strength <span class="num">${strength}</span>${a.path.length && mine ? ` · → ${esc(s.provinces[a.path[a.path.length - 1]].name)}` : ''}</span></button>`;
}

function armyPanel() {
  const s = S();
  if (ui.player === null || !s.countries[ui.player].alive) return '<p class="empty">You command no armies.</p>';
  const army = s.armies.find((a) => a.id === ui.selArmy && a.owner === ui.player);
  if (!army) {
    const mine = armiesOf(s, ui.player);
    return `<p class="small muted">Select an army, then tap any province on the map to march there. Armies stop when they meet an enemy or reach an enemy fortress.</p>
      <div class="list">${mine.map(armyRow).join('') || '<p class="empty">No armies. Recruit regiments in a province you own.</p>'}</div>`;
  }
  const here = s.provinces[army.province];
  const speed = armySpeed(army.units);
  const turns = Math.ceil(army.path.length / speed);
  const companions = armiesIn(s, army.province).filter((a) => a.owner === ui.player).length;
  return `<div class="head"><div><p class="eyebrow">Army at ${esc(here.name)}</p><h2 class="title">${totalRegiments(army.units)} regiments</h2></div>
    <button class="btn ghost small" data-action="deselect-army">Done</button></div>
    <table class="tbl"><thead><tr><th>Unit</th><th>Regts</th><th>Atk</th><th>Def</th><th>Upkeep</th></tr></thead><tbody>
    ${UNIT_ORDER.filter((u) => army.units[u]).map((u) => `<tr><td>${UNITS[u].name}</td><td>${army.units[u]}</td><td>${fmt(UNITS[u].attack * (CIVS[me()!.civ].unitAttack[u] ?? 1), 1)}</td><td>${UNITS[u].defense}</td><td>${fmt(army.units[u] * UNITS[u].upkeepGold, 1)}g</td></tr>`).join('')}
    </tbody></table>
    <div class="kv"><span>Morale</span><span>${bar(army.morale, army.morale > 0.5 ? 'good' : 'bad')} ${Math.round(army.morale * 100)}%</span>
    <span>Strength</span><span class="num">${fmt(armyStrength(s, army))}</span>
    <span>Speed</span><span>${speed} province${speed > 1 ? 's' : ''} per turn</span>
    <span>Orders</span><span>${army.path.length ? `<span class="pill proposal">Ordered</span> March to ${esc(s.provinces[army.path[army.path.length - 1]].name)}, ${turns} turn${turns > 1 ? 's' : ''}` : 'Holding position'}</span></div>
    <p class="hint">Tap a province on the map to set a destination.</p>
    <div class="row wrap">
      <button class="btn" data-action="halt" ${army.path.length ? '' : 'disabled'}>Halt</button>
      <button class="btn" data-action="split" ${totalRegiments(army.units) > 1 ? '' : 'disabled'}>Split in half</button>
      <button class="btn" data-action="merge" ${companions > 1 ? '' : 'disabled'}>Merge armies here</button>
      <button class="btn ghost" data-action="center-army">Show on map</button>
    </div>`;
}

function realmPanel() {
  const s = S();
  const c = me();
  if (!c) return '<p class="empty">You are observing.</p>';
  if (!c.alive) return `<p class="empty">${esc(c.name)} has fallen. Start a new campaign from the menu.</p>`;
  const b = budget(s, c.id);
  const civ = CIVS[c.civ];
  const wars = s.wars.filter((w) => w.a === c.id || w.b === c.id);
  const provinces = ownedProvinces(s, c.id).length;
  const queue = s.recruitment.filter((r) => r.country === c.id);
  const line = (name: string, inc: number, exp: number) =>
    `<tr><td>${name}</td><td class="num">${fmt(inc, 1)}</td><td class="num">${fmt(exp, 1)}</td><td class="num ${inc - exp < 0 ? 'neg' : 'pos'}">${signed(inc - exp)}</td></tr>`;
  return `<div class="head"><div><p class="eyebrow">${civ.name}</p><h2 class="title">${esc(c.name)}</h2></div></div>
    <p class="small">${esc(civ.description)}</p>
    <div class="kv"><span>Territory</span><span>${provinces} of ${s.provinces.length} provinces · hegemony at ${Math.ceil(s.provinces.length * VICTORY_SHARE)}</span>
    <span>Capital</span><span><button class="link" data-action="select-prov" data-id="${c.capital}">${esc(s.provinces[c.capital].name)}</button></span>
    <span>Army</span><span>${regimentsOf(s, c.id)} regiments · strength ${fmt(trueMilitaryStrength(s, c.id))}</span></div>
    <p class="eyebrow">Treasury per turn</p>
    <table class="tbl"><thead><tr><th></th><th>Income</th><th>Upkeep</th><th>Net</th></tr></thead><tbody>
    ${line('Gold', b.income.gold, b.expenses.gold)}${line('Food', b.income.food, b.expenses.food)}${line('Iron', b.income.iron, 0)}
    </tbody></table>
    <p class="small muted">Food stores cap at ${b.foodCap}. Manpower ${fmt(c.manpower / 1000, 1)}k of ${fmt(b.manpowerCap / 1000, 1)}k, +${fmt(b.manpowerGain / 1000, 2)}k per turn. Empty coffers crush morale; empty granaries make regiments desert.</p>
    <p class="eyebrow">War exhaustion</p>
    <div class="row tight">${bar(c.warExhaustion / 100, 'bad')}<span class="num">${fmt(c.warExhaustion)}</span></div>
    <p class="small muted">Rises with war, casualties and lost provinces; cuts gold income by up to half. Falls slowly in peacetime.</p>
    <p class="eyebrow">Wars</p>
    ${wars.length ? `<div class="list">${wars.map((w) => {
      const foe = w.a === c.id ? w.b : w.a;
      const mine = w.a === c.id ? w.scoreA : w.scoreB, theirs = w.a === c.id ? w.scoreB : w.scoreA;
      return `<div class="item"><span class="row tight">${swatch(foe)}<strong>${countryName(foe)}</strong></span>
        <span class="small muted">Since ${dateLabel(w.startTurn)} · ${w.battles} battles · war score <span class="num">${mine}</span> to <span class="num">${theirs}</span></span>
        <span class="row tight"><button class="btn small" data-action="peace" data-id="${foe}">Propose white peace</button></span></div>`;
    }).join('')}</div>` : '<p class="small muted">The realm is at peace.</p>'}
    ${queue.length ? `<p class="eyebrow">Recruiting</p><div class="list">${queue.map((r) => `<div class="item small">${r.count} × ${UNITS[r.unit].name} at ${esc(s.provinces[r.province].name)} · arrives at end of turn</div>`).join('')}</div>` : ''}`;
}

function diplomacyButtons(id: number) {
  const s = S();
  if (ui.player === null) return '';
  if (atWar(s, ui.player, id)) {
    return `<div class="row wrap"><button class="btn" data-action="peace" data-id="${id}">Propose white peace</button></div>`;
  }
  const can = canDeclareWar(s, ui.player, id);
  if (!can.ok) return `<p class="small muted">${esc(can.reason)}</p>`;
  const confirming = ui.confirmWar === id;
  return `<div class="row wrap"><button class="btn ${confirming ? 'danger' : ''}" data-action="war" data-id="${id}">${confirming ? 'Confirm: declare war' : 'Declare war'}</button>
    ${confirming ? '<button class="btn ghost" data-action="cancel-war">Cancel</button>' : ''}</div>
    ${confirming ? '<p class="small warn">War cannot be undone without the enemy agreeing to peace, and a truce follows any peace for 12 turns.</p>' : ''}`;
}

function nationsPanel() {
  const s = S();
  const order = [...s.countries].sort((a, b) => Number(b.alive) - Number(a.alive) || ownedProvinces(s, b.id).length - ownedProvinces(s, a.id).length);
  return `<p class="small muted">Strengths of other realms are estimates from your scouts. Armies you can see are counted exactly; the rest are guesses.</p>
    <div class="list">${order.map((c) => {
      const prov = ownedProvinces(s, c.id).length;
      const est = ui.player === null || c.id === ui.player ? armiesOf(s, c.id).reduce((t, a) => t + armyStrength(s, a), 0) : estimateStrength(s, ui.player, c.id, map.overlay.visible ?? undefined);
      const theirWars = enemiesOf(s, c.id).map((e) => s.countries[e].name.replace(/^.* of /, '')).join(', ');
      return `<div class="item nation ${c.alive ? '' : 'fallen'}">
        <span class="row between"><button class="link" data-action="focus-country" data-id="${c.id}">${swatch(c.id)}<strong>${esc(c.name)}</strong></button>${relationPill(c.id)}</span>
        <span class="small muted">${CIVS[c.civ].name} · ${prov} provinces · strength ${c.id === ui.player ? '' : '≈'}<span class="num">${fmt(est)}</span>${theirWars ? ` · at war with ${esc(theirWars)}` : ''}</span>
        ${c.alive && c.id !== ui.player && ui.player !== null && s.countries[ui.player].alive ? diplomacyButtons(c.id) : ''}
      </div>`;
    }).join('')}</div>`;
}

function chroniclePanel() {
  const s = S();
  let events = knownEvents(s, ui.player);
  if (ui.chronicleMine && ui.player !== null) events = events.filter((e) => e.participants.includes(ui.player!));
  const recent = events.slice(-150).reverse();
  let lastTurn = -1;
  const rows = recent.map((e) => {
    const head = e.turn !== lastTurn ? `<p class="eyebrow chron-date">${dateLabel(e.turn)}</p>` : '';
    lastTurn = e.turn;
    const prov = e.province !== undefined ? ` data-action="select-prov" data-id="${e.province}"` : ' data-action="noop"';
    return `${head}<button class="chron ${e.type}"${prov}><span class="chron-type">${e.type}</span><span>${esc(e.text)}</span></button>`;
  }).join('');
  return `<div class="row between"><p class="small muted">What your realm knows. Secret dealings of others stay hidden.</p>
    <label class="check"><input type="checkbox" id="mine" ${ui.chronicleMine ? 'checked' : ''}> Mine only</label></div>${rows}`;
}

// ------------------------------------------------------------------ modals

function openModal(html: string) {
  $('#modal-card').innerHTML = html;
  $('#modal').hidden = false;
}

function closeModal() {
  $('#modal').hidden = true;
}

function menuModal() {
  const avail = storageAvailable();
  const slots = SLOTS.map((slot) => {
    const text = readSlot(slot);
    const parsed = text ? parseSave(text) : null;
    const label = parsed ? (parsed.ok ? `${esc(parsed.label)}` : 'Damaged save') : 'Empty';
    const name = slot === 'auto' ? 'Autosave' : `Slot ${slot}`;
    return `<div class="item"><span class="row between"><strong>${name}</strong><span class="small muted">${label}</span></span>
      <span class="row tight">${slot !== 'auto' && ui.mode === 'play' ? `<button class="btn small" data-action="save-slot" data-slot="${slot}">Save here</button>` : ''}
      ${parsed?.ok ? `<button class="btn small" data-action="load-slot" data-slot="${slot}">Load</button>` : ''}</span></div>`;
  }).join('');
  openModal(`<div class="row between"><h2 class="title">Campaign</h2><button class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></div>
    ${avail ? `<div class="list">${slots}</div>` : '<p class="warn small">Browser storage is unavailable here, so slots and autosave are off. Use a save code below to keep your campaign.</p>'}
    <p class="eyebrow">Save code</p>
    <p class="small muted">A save code is the whole campaign as text. Copy it into a note to keep it safe or move it to another device, and paste it back to resume.</p>
    <div class="row wrap">${ui.mode === 'play' ? '<button class="btn" data-action="export">Show save code</button>' : ''}
      <button class="btn" data-action="import">Paste a save code</button>
      <label class="btn file">Open save file<input type="file" id="import-file" accept=".json,.txt,application/json"></label></div>
    <div id="code-area"></div>
    <p class="eyebrow">Map</p>
    <div class="row wrap"><button class="btn" data-action="toggle-mapmode">${map.political ? 'Show terrain map' : 'Show political map'}</button>
    <button class="btn" data-action="fit-map">Fit map to screen</button></div>
    <p class="eyebrow">Game</p>
    <div class="row wrap"><button class="btn danger" data-action="new-campaign">New campaign</button></div>
    <p class="small muted">Epochs of Aether · Phase 1 build · seed ${S().seed}</p>`);
}

// ------------------------------------------------------------------ actions

function act(action: string, data: DOMStringMap) {
  const s = ui.state;
  const id = data.id !== undefined ? Number(data.id) : NaN;
  switch (action) {
    case 'noop': return;
    case 'tab': {
      const tab = data.tab as Tab;
      if (ui.mode === 'setup') return;
      if (ui.tab === tab) ui.sheetOpen = !ui.sheetOpen; else { ui.tab = tab; ui.sheetOpen = true; }
      break;
    }
    case 'toggle-sheet': ui.sheetOpen = !ui.sheetOpen; requestAnimationFrame(() => map.resize()); break;
    case 'menu': menuModal(); return;
    case 'close-modal': closeModal(); return;
    case 'reroll': ui.seed = Math.floor(Math.random() * 1e6); newWorld(); return;
    case 'generate': {
      const seed = Number(($<HTMLInputElement>('#seed')).value);
      ui.seed = Number.isFinite(seed) ? Math.abs(Math.floor(seed)) : ui.seed;
      ui.countryCount = Number(($<HTMLSelectElement>('#count')).value) || 10;
      newWorld();
      return;
    }
    case 'pick-nation': ui.pickNation = id; if (s) map.centerOn(s.countries[id].capital); break;
    case 'begin': begin(); return;
    case 'continue': {
      const r = parseSave(readSlot('auto') ?? '');
      if (r.ok) loadState(r.state, 'Campaign resumed'); else toast(`Autosave could not be loaded: ${r.errors[0]}`, 'err');
      return;
    }
    case 'select-prov': ui.selProv = id; ui.tab = 'province'; ui.sheetOpen = true; map.centerOn(id); break;
    case 'select-army': {
      ui.selArmy = id; ui.tab = 'army'; ui.sheetOpen = true;
      const a = s?.armies.find((x) => x.id === id);
      if (a) ui.selProv = a.province;
      break;
    }
    case 'deselect-army': ui.selArmy = null; break;
    case 'center-army': { const a = s?.armies.find((x) => x.id === ui.selArmy); if (a) map.centerOn(a.province); return; }
    case 'focus-country': if (s) { ui.selProv = s.countries[id].capital; ui.tab = 'province'; map.centerOn(s.countries[id].capital); } break;
    case 'recruit': {
      if (!s || ui.player === null || ui.selProv === null) return;
      const r = recruit(s, ui.player, ui.selProv, data.unit as UnitId, Number(data.count));
      if (r.ok) toast(`${data.count} × ${UNITS[data.unit as UnitId].name} queued. They muster at the end of the turn.`);
      else toast(r.reason, 'err');
      break;
    }
    case 'cancel-recruit': if (s && ui.player !== null) cancelRecruit(s, ui.player, id); break;
    case 'halt': { const a = s?.armies.find((x) => x.id === ui.selArmy); if (a && s && ui.player !== null) setArmyDestination(s, ui.player, a.id, a.province); break; }
    case 'split': {
      const a = s?.armies.find((x) => x.id === ui.selArmy);
      if (a && s && ui.player !== null) {
        const r = splitArmy(s, ui.player, a.id, halfOf(a.units));
        if (r.ok) { ui.selArmy = s.armies[s.armies.length - 1].id; toast('Army split. The new detachment is selected.'); } else toast(r.reason, 'err');
      }
      break;
    }
    case 'merge': {
      const a = s?.armies.find((x) => x.id === ui.selArmy);
      if (a && s && ui.player !== null) {
        const r = mergeArmies(s, ui.player, a.province);
        if (r.ok) ui.selArmy = s.armies.filter((x) => x.owner === ui.player && x.province === a.province)[0].id; else toast(r.reason, 'err');
      }
      break;
    }
    case 'war': {
      if (!s || ui.player === null) return;
      if (ui.confirmWar !== id) { ui.confirmWar = id; break; }
      const r = declareWar(s, ui.player, id);
      ui.confirmWar = null;
      if (r.ok) { toast(`War declared on ${s.countries[id].name}. Their lands are now open to your armies.`); map.invalidate(); } else toast(r.reason, 'err');
      break;
    }
    case 'cancel-war': ui.confirmWar = null; break;
    case 'peace': {
      if (!s || ui.player === null) return;
      const r = proposePeace(s, ui.player, id);
      if (r.ok) { toast(`Peace signed with ${s.countries[id].name}. A 12-turn truce begins.`); map.renderBase(); } else toast(r.reason, 'err');
      break;
    }
    case 'accept-peace': {
      if (!s || ui.player === null) return;
      const r = acceptPeaceOffer(s, ui.player, id);
      toast(r.ok ? `Peace signed with ${s.countries[id].name}.` : r.reason, r.ok ? 'ok' : 'err');
      if (!s.peaceOffers.some((o) => o.to === ui.player)) closeModal(); else afterTurnModals();
      break;
    }
    case 'decline-peace': {
      if (!s || ui.player === null) return;
      declinePeaceOffer(s, ui.player, id);
      if (!s.peaceOffers.some((o) => o.to === ui.player)) closeModal(); else afterTurnModals();
      break;
    }
    case 'save-slot': {
      if (!s) return;
      const ok = writeSlot(data.slot as Slot, serializeSave(s, saveLabel()));
      toast(ok ? `Saved to slot ${data.slot}.` : 'Could not save: browser storage is unavailable or full.', ok ? 'ok' : 'err');
      menuModal();
      return;
    }
    case 'load-slot': {
      const r = parseSave(readSlot(data.slot as Slot) ?? '');
      if (r.ok) loadState(r.state, `Loaded ${r.label}`); else toast(r.errors[0], 'err');
      return;
    }
    case 'export': {
      if (!s) return;
      $('#code-area').innerHTML = `<textarea id="code" readonly rows="5" spellcheck="false"></textarea>
        <div class="row"><button class="btn primary" data-action="copy-code">Copy save code</button><span class="small muted">${fmt(serializeSave(s).length / 1024, 0)} KB</span></div>`;
      ($<HTMLTextAreaElement>('#code')).value = serializeSave(s, saveLabel());
      return;
    }
    case 'copy-code': {
      const ta = $<HTMLTextAreaElement>('#code');
      navigator.clipboard?.writeText(ta.value).then(() => toast('Save code copied.'), () => { ta.select(); toast('Copy blocked here. The code is selected; copy it manually.', 'err'); })
        ?? (ta.select(), toast('The code is selected; copy it manually.', 'err'));
      return;
    }
    case 'import': {
      $('#code-area').innerHTML = `<textarea id="paste" rows="5" spellcheck="false" placeholder="Paste a save code here"></textarea>
        <div class="row"><button class="btn primary" data-action="import-go">Load this save</button></div>`;
      return;
    }
    case 'import-go': {
      const r = parseSave(($<HTMLTextAreaElement>('#paste')).value.trim());
      if (r.ok) loadState(r.state, `Loaded ${r.label || 'save'}`); else toast(`That save could not be loaded: ${r.errors.slice(0, 2).join(' ')}`, 'err');
      return;
    }
    case 'toggle-mapmode': map.political = !map.political; map.renderBase(); menuModal(); return;
    case 'fit-map': map.fitToScreen(); closeModal(); return;
    case 'new-campaign': closeModal(); ui.seed = Math.floor(Math.random() * 1e6); newWorld(); return;
  }
  refresh();
}

document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!t || (t as HTMLButtonElement).disabled) return;
  act(t.dataset.action!, t.dataset);
});

document.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'mine') { ui.chronicleMine = t.checked; renderPanel(); }
  if (t.id === 'import-file' && t.files?.[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      const r = parseSave(String(reader.result));
      if (r.ok) loadState(r.state, `Loaded ${r.label || 'save file'}`); else toast(`That file could not be loaded: ${r.errors[0]}`, 'err');
    };
    reader.readAsText(t.files[0]);
  }
});

$('#end-turn').addEventListener('click', endTurn);
$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });

// ------------------------------------------------------------------ map input

function tap(x: number, y: number) {
  const s = ui.state;
  if (!s) return;
  if (ui.mode === 'setup') {
    const p = map.provinceAt(x, y);
    if (p !== null && s.provinces[p].owner !== null) { ui.pickNation = s.provinces[p].owner; refresh(); }
    return;
  }
  const army = map.armyAt(x, y);
  if (army) {
    if (army.owner === ui.player) act('select-army', { id: String(army.id) });
    else { ui.selProv = army.province; ui.tab = 'province'; ui.sheetOpen = true; refresh(); }
    return;
  }
  const p = map.provinceAt(x, y);
  if (p === null) { ui.selArmy = null; ui.selProv = null; refresh(); return; }
  const sel = s.armies.find((a) => a.id === ui.selArmy && a.owner === ui.player);
  if (sel && ui.player !== null && p !== sel.province) {
    const r = setArmyDestination(s, ui.player, sel.id, p);
    if (r.ok) toast(`Marching to ${s.provinces[p].name}: ${Math.ceil(sel.path.length / armySpeed(sel.units))} turn(s). Moves happen when you end the turn.`);
    else toast(r.reason, 'err');
    refresh();
    return;
  }
  ui.selProv = p;
  ui.tab = 'province';
  ui.sheetOpen = true;
  refresh();
}

{
  const canvas = map.canvas;
  const pts = new Map<number, { x: number; y: number }>();
  let moved = false;
  let start = { x: 0, y: 0 };
  let pinch = 0;
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 1) { start = p; moved = false; }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      moved = true;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    const dpr = map.pixelRatio;
    if (pts.size === 1) {
      if (Math.hypot(p.x - start.x, p.y - start.y) > 8) moved = true;
      if (moved) map.pan((p.x - prev.x) * dpr, (p.y - prev.y) * dpr);
    } else if (pts.size === 2) {
      pts.set(e.pointerId, p);
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) map.zoomAt(((a.x + b.x) / 2) * dpr, ((a.y + b.y) / 2) * dpr, d / pinch);
      pinch = d;
      return;
    }
    pts.set(e.pointerId, p);
  });
  const up = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e);
    if (pts.size === 1 && !moved) tap(p.x, p.y);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = 0;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch = 0; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = { x: e.offsetX, y: e.offsetY };
    map.zoomAt(p.x * map.pixelRatio, p.y * map.pixelRatio, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
}

new ResizeObserver(() => map.resize()).observe(map.canvas);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) endTurn();
  if (e.key === 'Escape') { ui.selArmy = null; closeModal(); refresh(); }
});

// ------------------------------------------------------------------ boot

map.resize();
newWorld();
if (document.fonts) document.fonts.ready.then(() => map.invalidate());
