// Menu latéral : ancré (largeur réglable) ou détaché (déplaçable, redimensionnable), réductible.
const KEY = 'sdc-menu-layout-v1';
const $ = id => document.getElementById(id);
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), Math.max(lo, hi));

function read() { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } }
function write(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* stockage indisponible : mise en page non mémorisée */ } }

// Glisser avec capture du pointeur ; onMove reçoit le déplacement depuis le départ.
function drag(handle, { start, move, end, ignore }) {
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || ignore?.(event)) return;
    const origin = { x: event.clientX, y: event.clientY }, context = start?.(event);
    if (context === false) return;
    handle.setPointerCapture(event.pointerId); event.preventDefault();
    const onMove = e => move(e.clientX - origin.x, e.clientY - origin.y, context, e);
    const onUp = () => { handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', onUp); handle.removeEventListener('pointercancel', onUp); end?.(context); };
    handle.addEventListener('pointermove', onMove); handle.addEventListener('pointerup', onUp); handle.addEventListener('pointercancel', onUp);
  });
}

export function initLayout() {
  const layout = $('layout'), menu = $('menu'), bar = $('menu-bar');
  const state = { floating: false, collapsed: false, width: 320, x: 40, y: 90, w: 360, h: 560, treeHeight: 190, treeHidden: false, bomHeight: 200, bomHidden: false, ...read() };
  // Listes à hauteur réglable (occurrences, nomenclature) : [préfixe d'identifiants, clé d'état, variable CSS].
  const lists = [['tree', 'tree', '--tree-h'], ['bom', 'bom', '--bom-h']];
  const save = () => write(state);
  const limits = () => ({ minW: 220, maxW: Math.max(260, innerWidth - 24), minH: 120, maxH: innerHeight - 12 });

  function apply() {
    const { minW, maxW, minH, maxH } = limits();
    state.width = clamp(state.width, 200, Math.min(720, innerWidth * .6));
    state.x = clamp(state.x, 0, innerWidth - 80); state.y = clamp(state.y, 0, innerHeight - 40);
    // Le menu détaché reste entièrement dans la fenêtre : la poignée de coin doit rester atteignable.
    state.w = clamp(state.w, minW, Math.min(maxW, innerWidth - state.x)); state.h = clamp(state.h, minH, Math.min(maxH, innerHeight - state.y - 4));
    layout.classList.toggle('menu-floating', state.floating);
    menu.classList.toggle('floating', state.floating);
    menu.classList.toggle('collapsed', state.collapsed);
    layout.style.setProperty('--menu-w', state.floating ? '0px' : (state.collapsed ? '46px' : `${state.width}px`));
    Object.assign(menu.style, state.floating
      ? { left: `${state.x}px`, top: `${state.y}px`, width: `${state.w}px`, height: state.collapsed ? 'auto' : `${state.h}px` }
      : { left: '', top: '', width: '', height: '' });
    for (const [id, key, variable] of lists) {
      layout.style.setProperty(variable, state[`${key}Hidden`] ? '0px' : `${state[`${key}Height`]}px`);
      $(`${id}-wrap`).classList.toggle('closed', state[`${key}Hidden`]);
      $(`${id}-toggle`).textContent = state[`${key}Hidden`] ? '▸' : '▾';
      $(`${id}-toggle`).setAttribute('aria-expanded', String(!state[`${key}Hidden`]));
    }
    $('menu-float').textContent = state.floating ? '⇥ Ancrer' : '⧉ Détacher';
    $('menu-float').title = state.floating ? 'Replacer le menu à gauche' : 'Détacher le menu : il devient déplaçable et redimensionnable';
    $('menu-collapse').textContent = state.collapsed ? '»' : '«';
    $('menu-collapse').title = state.collapsed ? 'Déployer le menu' : 'Réduire le menu';
    $('menu-collapse').setAttribute('aria-expanded', String(!state.collapsed));
    $('splitter').hidden = state.floating;
    $('splitter').setAttribute('aria-valuenow', String(Math.round(state.width)));
  }
  function setFloating(on, from) {
    if (on && from) { state.x = from.left; state.y = from.top; state.w = from.width; state.h = Math.min(from.height, innerHeight * .8); }
    else if (on) { state.x = Math.max(16, innerWidth - state.w - 24); state.y = 90; }
    state.floating = on; apply(); save();
  }
  const toggleFloating = () => setFloating(!state.floating);
  const toggleCollapsed = () => { state.collapsed = !state.collapsed; apply(); save(); };

  $('menu-float').onclick = toggleFloating;
  $('menu-collapse').onclick = toggleCollapsed;
  $('menu-toggle-tools').onclick = toggleCollapsed;
  bar.addEventListener('dblclick', event => { if (!event.target.closest('button')) toggleFloating(); });

  // Déplacement par la barre de titre ; depuis le mode ancré, tirer la barre détache le menu.
  drag(bar, {
    ignore: event => event.target.closest('button'),
    start: event => {
      const rect = menu.getBoundingClientRect();
      return { rect, origin: { x: state.x, y: state.y }, pending: !state.floating, pointer: { x: event.clientX, y: event.clientY } };
    },
    move: (dx, dy, c) => {
      if (c.pending) {
        if (Math.hypot(dx, dy) < 8) return;
        c.pending = false; setFloating(true, c.rect); c.origin = { x: state.x, y: state.y };
      }
      state.x = c.origin.x + dx; state.y = c.origin.y + dy; apply();
    },
    end: () => save()
  });

  // Largeur du menu ancré : poignée verticale, double-clic pour réduire, flèches au clavier.
  drag($('splitter'), {
    start: () => ({ width: state.width }),
    move: (dx, dy, c) => { state.collapsed = false; state.width = c.width + dx; apply(); },
    end: () => save()
  });
  $('splitter').addEventListener('dblclick', toggleCollapsed);
  $('splitter').addEventListener('keydown', event => {
    const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key];
    if (step) { state.collapsed = false; state.width += step; apply(); save(); event.preventDefault(); }
    else if (event.key === 'Enter') toggleCollapsed();
  });

  // Dimensions du menu détaché : bord droit, bord bas et coin.
  for (const [id, dxOn, dyOn] of [['menu-resize-r', 1, 0], ['menu-resize-b', 0, 1], ['menu-resize', 1, 1]]) {
    drag($(id), {
      start: () => ({ w: state.w, h: state.h }),
      move: (dx, dy, c) => { if (dxOn) state.w = c.w + dx; if (dyOn) state.h = c.h + dy; apply(); },
      end: () => save()
    });
  }

  // Hauteur des listes : poignée, double-clic pour replier, flèches haut/bas, bouton de repli.
  for (const [id, key] of lists) {
    const height = `${key}Height`, hidden = `${key}Hidden`;
    drag($(`${id}-resize`), {
      start: () => ({ h: state[height] }),
      move: (dx, dy, c) => { state[hidden] = false; state[height] = clamp(c.h + dy, 40, innerHeight * .7); apply(); },
      end: () => save()
    });
    $(`${id}-resize`).addEventListener('dblclick', () => { state[hidden] = !state[hidden]; apply(); save(); });
    $(`${id}-resize`).addEventListener('keydown', event => {
      const step = { ArrowUp: -24, ArrowDown: 24 }[event.key];
      if (step) { state[hidden] = false; state[height] = clamp(state[height] + step, 40, innerHeight * .7); apply(); save(); event.preventDefault(); }
    });
    $(`${id}-toggle`).onclick = () => { state[hidden] = !state[hidden]; apply(); save(); };
  }

  addEventListener('resize', apply);
  apply();
}
