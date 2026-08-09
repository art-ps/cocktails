import * as THREE from 'three';
import { COCKTAILS } from './cocktails.js';
import { createScene } from './scene.js';
import { buildGlass, buildVessel, buildStream, glassInfo, makeLiquidLayer } from './vessels.js';

// ---------------------------------------------------------------------------
// Вся анимация — чистая функция от прогресса скролла p ∈ [0..1].
// Поэтому пауза, реверс и любая скорость скролла работают сами собой.
// ---------------------------------------------------------------------------

const INTRO = 0.04; // камера «усаживается», ничего не двигается
const OUTRO = 0.1;  // финальный облёт камеры

// Фазы внутри сегмента одного ингредиента (t ∈ [0..1])
const PH = {
  liftEnd: 0.16,
  tiltEnd: 0.34,
  pourEnd: 0.7,
  backEnd: 0.86,
};

const TILT_START = 1.72; // ~99° — угол начала налива
const TILT_END = 2.02;   // ~116° — бутылка «допивается»

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const smooth = (x, a, b) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, k) => a + (b - a) * k;

// ---------------------------------------------------------------------------

const app = document.getElementById('app');
const { renderer, scene, camera, makeContactShadow } = createScene(app);

const ui = {
  menu: document.getElementById('menu'),
  cards: document.getElementById('cards'),
  hud: document.getElementById('hud'),
  backBtn: document.getElementById('backBtn'),
  againBtn: document.getElementById('againBtn'),
  drinkTitle: document.getElementById('drinkTitle'),
  steps: document.getElementById('steps'),
  pourLabel: document.getElementById('pourLabel'),
  pourName: document.getElementById('pourName'),
  pourMl: document.getElementById('pourMl'),
  scrollHint: document.getElementById('scrollHint'),
  finale: document.getElementById('finale'),
  finaleName: document.getElementById('finaleName'),
  finaleRecipe: document.getElementById('finaleRecipe'),
  spacer: document.getElementById('spacer'),
};

// ---------- Состояние текущего коктейля ----------

let active = null; // { cocktail, glass, liquid, vessels[], stream, shadows[], totalVol }
let targetP = 0;
let curP = 0;
const mouse = { x: 0, y: 0, cx: 0, cy: 0 };
const tmpColor = new THREE.Color();

function disposeObject(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
}

function clearActive() {
  if (!active) return;
  [active.glass, active.stream, ...active.vessels, ...active.shadows].forEach((o) => {
    scene.remove(o);
    disposeObject(o);
  });
  active = null;
}

function startCocktail(cocktail) {
  clearActive();

  const glass = buildGlass(cocktail.glass);
  scene.add(glass);

  // Слой на каждый ингредиент — пропорции коктейля видны по слоям
  const layers = cocktail.ingredients.map((ing, i) => {
    const layer = makeLiquidLayer(cocktail.glass, i === 0);
    layer.renderOrder = 2 + i;
    const c = new THREE.Color(ing.color);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    // затемняем базу: яркий свет + ACES-тонмаппинг иначе выбеливают цвет
    c.setHSL(hsl.h, Math.min(1, hsl.s * 1.35), hsl.l * (0.3 + 0.35 * (1 - ing.opacity)));
    layer.material.color.copy(c);
    layer.material.emissive.copy(c).multiplyScalar(0.25);
    layer.material.opacity = clamp01(0.25 + ing.opacity * 0.72);
    glass.add(layer);
    return layer;
  });

  const stream = buildStream();
  scene.add(stream);

  const shadows = [];
  const glassShadow = makeContactShadow(cocktail.glass === 'rocks' ? 1.15 : 0.95);
  scene.add(glassShadow);
  shadows.push(glassShadow);

  const vessels = cocktail.ingredients.map((ing, i) => {
    const v = buildVessel(ing.vessel);
    const side = i % 2 === 0 ? -1 : 1;
    const ring = Math.floor(i / 2);
    v.userData.rest = new THREE.Vector3(side * (2.7 + ring * 1.45), 0, 0.15 - ring * 0.55);
    v.userData.side = side;
    v.position.copy(v.userData.rest);
    scene.add(v);

    const sh = makeContactShadow(0.85);
    sh.position.x = v.userData.rest.x;
    sh.position.z = v.userData.rest.z;
    scene.add(sh);
    sh.userData.forVessel = v;
    shadows.push(sh);
    return v;
  });

  active = {
    cocktail,
    glass,
    layers,
    vessels,
    stream,
    shadows,
    totalVol: cocktail.ingredients.reduce((s, x) => s + x.amount, 0),
  };

  // HUD
  ui.drinkTitle.textContent = cocktail.name;
  ui.steps.innerHTML = '';
  cocktail.ingredients.forEach((ing) => {
    const el = document.createElement('div');
    el.className = 'step';
    el.innerHTML = `<span>${ing.name} · ${ing.amount} мл</span><span class="dot"></span>`;
    ui.steps.appendChild(el);
  });
  ui.finaleName.textContent = cocktail.name;
  ui.finaleRecipe.textContent = cocktail.ingredients
    .map((x) => `${x.name} — ${x.amount} мл`)
    .join('  ·  ');

  // Длина скролла: ~1500px на ингредиент
  const h = cocktail.ingredients.length * 1500 + 1000 + window.innerHeight;
  ui.spacer.style.height = `${h}px`;

  window.scrollTo(0, 0);
  targetP = 0;
  curP = 0;

  ui.menu.classList.add('hidden');
  ui.hud.hidden = false;
}

function backToMenu() {
  ui.menu.classList.remove('hidden');
  ui.hud.hidden = true;
  ui.spacer.style.height = '0px';
  window.scrollTo(0, 0);
  clearActive();
}

// ---------- Меню ----------

COCKTAILS.forEach((c) => {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="swatch" style="background:${c.swatch}"></div>
    <h3>${c.name}</h3>
    <p>${c.tagline}</p>`;
  card.addEventListener('click', () => startCocktail(c));
  ui.cards.appendChild(card);
});

ui.backBtn.addEventListener('click', backToMenu);
ui.againBtn.addEventListener('click', backToMenu);

// ---------- Ввод ----------

window.addEventListener('scroll', () => {
  const max = Math.max(1, ui.spacer.offsetHeight - window.innerHeight);
  targetP = clamp01(window.scrollY / max);
});

window.addEventListener('mousemove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
});

// ---------- Поза сосуда ----------
// Во время налива горлышко «приколочено» к точке над стаканом,
// бутылка вращается вокруг него — как рука бармена.

function vesselPourPose(v, angleMag, mouthTarget) {
  const H = v.userData.mouthHeight;
  const s = v.userData.side;
  return new THREE.Vector3(
    mouthTarget.x + s * H * Math.sin(angleMag),
    mouthTarget.y - H * Math.cos(angleMag),
    0
  );
}

function updateVessels(p) {
  const { cocktail, vessels, stream, layers } = active;
  const n = cocktail.ingredients.length;
  const gp = glassInfo(cocktail.glass);
  const usable = 1 - INTRO - OUTRO;
  const pp = (p - INTRO) / usable; // прогресс по ингредиентам

  let pouringIndex = -1;
  let pourProg = 0;
  let segT = 0;

  vessels.forEach((v, i) => {
    const s = v.userData.side;
    const H = v.userData.mouthHeight;
    const rest = v.userData.rest;
    const hover = new THREE.Vector3(s * 1.95, 1.45, 0);
    const mouthTarget = new THREE.Vector3(s * 0.1, gp.height + 1.18, 0);

    // t — локальное время этого ингредиента
    const t = clamp01(pp * n - i);
    let pos = rest;
    let ang = 0;

    if (t <= 0) {
      pos = rest;
    } else if (t < PH.liftEnd) {
      const k = ease(t / PH.liftEnd);
      pos = rest.clone().lerp(hover, k);
      pos.y += Math.sin(k * Math.PI) * 0.35; // дуга подъёма
    } else if (t < PH.tiltEnd) {
      const k = ease((t - PH.liftEnd) / (PH.tiltEnd - PH.liftEnd));
      ang = TILT_START * k;
      pos = hover.clone().lerp(vesselPourPose(v, ang, mouthTarget), k);
    } else if (t < PH.pourEnd) {
      const u = (t - PH.tiltEnd) / (PH.pourEnd - PH.tiltEnd);
      ang = lerp(TILT_START, TILT_END, u);
      pos = vesselPourPose(v, ang, mouthTarget);
      pouringIndex = i;
      pourProg = u;
      segT = t;
    } else if (t < PH.backEnd) {
      const u = ease((t - PH.pourEnd) / (PH.backEnd - PH.pourEnd));
      ang = TILT_END * (1 - u);
      pos = hover.clone().lerp(vesselPourPose(v, ang, mouthTarget), 1 - u);
    } else if (t < 1) {
      const k = ease((t - PH.backEnd) / (1 - PH.backEnd));
      pos = hover.clone().lerp(rest, k);
      pos.y += Math.sin(k * Math.PI) * 0.35;
    } else {
      pos = rest;
    }

    v.position.copy(pos);
    v.rotation.z = s * ang;

    // крышку «снимают» на время налива
    const cap = v.userData.cap;
    if (cap) {
      const capOp = Math.max(1 - smooth(t, 0.02, 0.13), smooth(t, 0.87, 0.98));
      cap.material.opacity = capOp;
      cap.visible = capOp > 0.02;
    }
  });

  // Тени сосудов гаснут, когда бутылка поднята
  active.shadows.forEach((sh) => {
    const v = sh.userData.forVessel;
    if (!v) return;
    const lifted = clamp01(v.position.y / 0.9) * clamp01(v.position.distanceTo(v.userData.rest) * 2);
    sh.material.opacity = 1 - lifted;
  });

  // ---------- Жидкость в стакане: слои по ингредиентам ----------
  let level = 0; // суммарная высота налитого
  cocktail.ingredients.forEach((ing, i) => {
    let vi = 0;
    const t = clamp01(pp * n - i);
    if (t >= PH.pourEnd) vi = ing.amount;
    else if (t > PH.tiltEnd) vi = ing.amount * ((t - PH.tiltEnd) / (PH.pourEnd - PH.tiltEnd));
    const h = (vi / active.totalVol) * gp.maxFill;
    const layer = layers[i];
    if (h > 0.002) {
      layer.visible = true;
      layer.scale.y = h + (i > 0 ? 0.006 : 0); // лёгкий нахлёст против щелей
      layer.position.y = gp.floor + 0.005 + level - (i > 0 ? 0.006 : 0);
    } else {
      layer.visible = false;
    }
    level += h;
  });

  // ---------- Струя ----------
  if (pouringIndex >= 0) {
    const v = vessels[pouringIndex];
    const mouth = v.localToWorld(new THREE.Vector3(0, v.userData.mouthHeight, 0));
    const surfaceY = gp.floor + level + 0.02;
    const len = Math.max(0.01, mouth.y - surfaceY);
    const fade = smooth(pourProg, 0, 0.12) * (1 - smooth(pourProg, 0.88, 1));
    const r = v.userData.mouthR * 0.55 * fade;
    stream.visible = fade > 0.01;
    stream.position.set(mouth.x, mouth.y, mouth.z);
    stream.scale.set(Math.max(r, 0.0001), len, Math.max(r, 0.0001));
    tmpColor.setHex(cocktail.ingredients[pouringIndex].color);
    stream.material.color.copy(tmpColor);
    stream.material.opacity = 0.55 + cocktail.ingredients[pouringIndex].opacity * 0.4;
  } else {
    stream.visible = false;
  }

  // ---------- HUD ----------
  let labelOpacity = 0;
  const segIdx = Math.max(0, Math.min(n - 1, Math.floor(pp * n)));
  const segLocal = clamp01(pp * n - segIdx);
  if (pp > 0 && pp < 1) {
    labelOpacity = smooth(segLocal, 0.06, 0.22) * (1 - smooth(segLocal, 0.82, 0.96));
    const ing = cocktail.ingredients[segIdx];
    ui.pourName.textContent = ing.name;
    const poured = Math.round(
      ing.amount * clamp01((segLocal - PH.tiltEnd) / (PH.pourEnd - PH.tiltEnd))
    );
    ui.pourMl.textContent = poured;
  }
  ui.pourLabel.style.opacity = labelOpacity.toFixed(3);

  const stepEls = ui.steps.children;
  for (let i = 0; i < stepEls.length; i++) {
    const t = clamp01(pp * n - i);
    stepEls[i].classList.toggle('active', t > 0 && t < 1);
    stepEls[i].classList.toggle('done', t >= 1);
  }

  ui.scrollHint.style.opacity = p < 0.015 ? '1' : '0';

  const finaleK = smooth(p, 1 - OUTRO * 0.75, 1 - OUTRO * 0.12);
  ui.finale.style.opacity = finaleK.toFixed(3);
  ui.finale.classList.toggle('visible', finaleK > 0.6);
}

// ---------- Камера ----------

function updateCamera(p) {
  const rocks = active && active.cocktail.glass === 'rocks';
  const settle = smooth(p, 0, 0.1);
  let radius = lerp(9.6, rocks ? 6.6 : 7.6, settle);
  let height = lerp(3.1, rocks ? 2.1 : 2.45, settle);
  let phi = 0;
  let lookY = rocks ? 1.1 : 1.35;

  const fin = smooth(p, 1 - OUTRO, 1);
  radius = lerp(radius, rocks ? 5.6 : 6.8, fin);
  height = lerp(height, rocks ? 1.7 : 2.0, fin);
  phi = lerp(0, 0.36, fin);
  lookY = lerp(lookY, rocks ? 0.8 : 1.05, fin);

  mouse.cx = lerp(mouse.cx, mouse.x, 0.05);
  mouse.cy = lerp(mouse.cy, mouse.y, 0.05);

  camera.position.set(
    Math.sin(phi) * radius + mouse.cx * 0.3,
    height - mouse.cy * 0.2,
    Math.cos(phi) * radius
  );
  camera.lookAt(mouse.cx * 0.15, lookY, 0);
}

// ---------- Цикл ----------

let lastTime = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  // демпфирование скролла: движение плавное, но останавливается вместе с юзером
  curP += (targetP - curP) * Math.min(1, dt * 7);
  if (Math.abs(targetP - curP) < 0.0004) curP = targetP;

  if (active) {
    updateVessels(curP);
    updateCamera(curP);
  } else {
    updateCamera(0);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// отладочный хук (безвреден в проде)
window.__bar = {
  get active() { return active; },
  setP(p) { targetP = p; curP = p; },
  start(i) { startCocktail(COCKTAILS[i]); },
};
