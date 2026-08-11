import * as THREE from 'three';

// Все сосуды строятся процедурно через LatheGeometry.
// Начало координат каждой группы — центр донышка (y=0).

const GLASS_PARAMS = {
  highball: { height: 2.35, outerR: 0.56, wall: 0.03, floor: 0.12, innerR: 0.53, maxFill: 1.72 },
  rocks:    { height: 1.55, outerR: 0.78, wall: 0.04, floor: 0.18, innerR: 0.74, maxFill: 0.98 },
};

// Честное стекло: transmission + ior. Ограничение three.js — transmission
// не показывает transparent-объекты сквозь себя, поэтому вся жидкость
// в сцене непрозрачная (см. makeLiquidLayer) и видна через стекло с преломлением.
function glassMaterial(tint = 0xffffff, opts = {}) {
  // fake: alpha-прозрачность вместо transmission. Нужна светлым бутылкам,
  // где сквозь стекло должна быть видна transparent-жидкость (см. addBottleLiquid).
  if (opts.fake) {
    return new THREE.MeshPhysicalMaterial({
      color: tint,
      metalness: 0,
      roughness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      specularIntensity: 1,
      envMapIntensity: 0.5,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: tint,
    metalness: 0,
    roughness: 0.06,
    transmission: 1,
    thickness: opts.thickness ?? 0.12,
    ior: 1.5,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    specularIntensity: 1,
    envMapIntensity: 0.5,
    side: THREE.DoubleSide,
  });
}

// Светлое прозрачное стекло? Тогда фейк-прозрачность + видимая жидкость.
// Тёмное тонированное transmission-стекло само выглядит «полным».
function isClearTint(tint) {
  const c = new THREE.Color(tint);
  return c.r * 0.3 + c.g * 0.6 + c.b * 0.1 > 0.55;
}

// ---------- Стакан ----------

export function buildGlass(type) {
  const p = GLASS_PARAMS[type];
  const pts = [];
  // внешняя стенка снизу вверх
  pts.push(new THREE.Vector2(0, 0.015));
  pts.push(new THREE.Vector2(p.outerR * 0.82, 0.015));
  pts.push(new THREE.Vector2(p.outerR, 0.09));
  pts.push(new THREE.Vector2(p.outerR, p.height));
  // скруглённый ободок
  pts.push(new THREE.Vector2((p.outerR + p.innerR) / 2, p.height + 0.028));
  // внутренняя стенка вниз
  pts.push(new THREE.Vector2(p.innerR, p.height));
  pts.push(new THREE.Vector2(p.innerR, p.floor + 0.06));
  pts.push(new THREE.Vector2(p.innerR * 0.75, p.floor));
  pts.push(new THREE.Vector2(0, p.floor));

  const geo = new THREE.LatheGeometry(pts, 72);
  const mesh = new THREE.Mesh(geo, glassMaterial(0xf8fbff, { thickness: 0.08 }));
  mesh.renderOrder = 20;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const group = new THREE.Group();
  group.add(mesh);

  group.userData = { params: p };
  return group;
}

// Слой жидкости одного ингредиента: единичный цилиндр с основанием
// в y=0, масштабируется по высоте. Каждый ингредиент — свой слой,
// чтобы пропорции коктейля были видны визуально.
// Непрозрачный — иначе не виден сквозь transmission-стекло (см. glassMaterial).
export function makeLiquidLayer(type, isBottom) {
  const p = GLASS_PARAMS[type];
  const rTop = p.innerR - 0.015;
  const rBottom = isBottom ? p.innerR * 0.78 : rTop;
  const geo = new THREE.CylinderGeometry(rTop, rBottom, 1, 48);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.3,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.35,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.y = 0.0001;
  mesh.visible = false;
  return mesh;
}

// Глянцевый диск поверхности напитка — ловит блик HDRI, читается как «мокрое»
export function makeSurfaceDisc(type) {
  const p = GLASS_PARAMS[type];
  const geo = new THREE.CircleGeometry(p.innerR - 0.012, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.06,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  return mesh;
}

export function glassInfo(type) {
  return GLASS_PARAMS[type];
}

// ---------- Этикетка ----------

function makeLabelTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  // тонкие рамки
  ctx.strokeStyle = fg;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 18, c.width - 36, c.height - 36);
  ctx.lineWidth = 2;
  ctx.strokeRect(32, 32, c.width - 64, c.height - 64);
  ctx.globalAlpha = 1;
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 84;
  ctx.font = `700 ${size}px Georgia, serif`;
  while (ctx.measureText(text).width > c.width - 110 && size > 30) {
    size -= 4;
    ctx.font = `700 ${size}px Georgia, serif`;
  }
  ctx.fillText(text, c.width / 2, c.height / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function addLabel(group, radius, yCenter, height, v) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 48, 1, true, -Math.PI * 0.72, Math.PI * 1.44);
  const mat = new THREE.MeshStandardMaterial({
    map: makeLabelTexture(v.label, v.labelBg, v.labelFg),
    roughness: 0.85,
    metalness: 0,
  });
  const label = new THREE.Mesh(geo, mat);
  label.position.y = yCenter;
  group.add(label);
}

// Полупрозрачный столб жидкости — только для светлых бутылок с фейк-стеклом
// (сквозь alpha-стекло transparent-жидкость видна, сквозь transmission — нет).
function addBottleLiquid(group, pts, color) {
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.08,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
    envMapIntensity: 0.45,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  const liq = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), mat);
  liq.renderOrder = 8;
  group.add(liq);
}

function addCap(group, radius, yBottom, height, color) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 32);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.35, transparent: true });
  const cap = new THREE.Mesh(geo, mat);
  cap.position.y = yBottom + height / 2;
  group.add(cap);
  group.userData.cap = cap; // крышка «снимается», когда бутылку поднимают
}

// ---------- Сосуды для наливания ----------
// Каждый билдер возвращает Group c userData.mouthHeight (высота горлышка).

function buildSpiritBottle(v) {
  const group = new THREE.Group();
  const pts = [
    new THREE.Vector2(0, 0.02),
    new THREE.Vector2(0.34, 0.02),
    new THREE.Vector2(0.41, 0.1),
    new THREE.Vector2(0.42, 0.55),
    new THREE.Vector2(0.42, 1.72),
    new THREE.Vector2(0.38, 2.0),
    new THREE.Vector2(0.24, 2.28),
    new THREE.Vector2(0.145, 2.5),
    new THREE.Vector2(0.13, 2.9),
    new THREE.Vector2(0.145, 2.96),
    new THREE.Vector2(0.1, 2.97),
    new THREE.Vector2(0.1, 2.9),
  ];
  const clear = isClearTint(v.tint);
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(pts, 56),
    glassMaterial(v.tint, { thickness: 0.06, fake: clear })
  );
  body.renderOrder = 10;
  group.add(body);
  if (clear) {
    addBottleLiquid(group, [
      new THREE.Vector2(0, 0.06),
      new THREE.Vector2(0.31, 0.06),
      new THREE.Vector2(0.39, 0.14),
      new THREE.Vector2(0.39, 1.6),
      new THREE.Vector2(0.34, 1.85),
      new THREE.Vector2(0, 1.85),
    ], v.liquid ?? 0xdfe8f0);
  }
  addLabel(group, 0.425, 1.0, 0.85, v);
  addCap(group, 0.15, 2.86, 0.24, v.capColor);
  group.userData.mouthHeight = 2.96;
  group.userData.mouthR = 0.1;
  return group;
}

function buildSodaBottle(v) {
  const group = new THREE.Group();
  const pts = [
    new THREE.Vector2(0, 0.02),
    new THREE.Vector2(0.3, 0.02),
    new THREE.Vector2(0.38, 0.12),
    new THREE.Vector2(0.39, 0.7),
    new THREE.Vector2(0.34, 1.05),
    new THREE.Vector2(0.37, 1.45),
    new THREE.Vector2(0.36, 1.75),
    new THREE.Vector2(0.22, 2.15),
    new THREE.Vector2(0.12, 2.45),
    new THREE.Vector2(0.11, 2.72),
    new THREE.Vector2(0.13, 2.76),
    new THREE.Vector2(0.09, 2.77),
    new THREE.Vector2(0.09, 2.7),
  ];
  const clear = isClearTint(v.tint);
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(pts, 56),
    glassMaterial(v.tint, { thickness: 0.06, fake: clear })
  );
  body.renderOrder = 10;
  group.add(body);
  if (clear) {
    addBottleLiquid(group, [
      new THREE.Vector2(0, 0.06),
      new THREE.Vector2(0.27, 0.06),
      new THREE.Vector2(0.35, 0.15),
      new THREE.Vector2(0.36, 0.7),
      new THREE.Vector2(0.31, 1.05),
      new THREE.Vector2(0.34, 1.45),
      new THREE.Vector2(0.33, 1.65),
      new THREE.Vector2(0, 1.65),
    ], v.liquid ?? 0xdfe8f0);
  }
  addLabel(group, 0.395, 1.28, 0.62, v);
  addCap(group, 0.13, 2.68, 0.18, v.capColor);
  group.userData.mouthHeight = 2.76;
  group.userData.mouthR = 0.09;
  return group;
}

function buildCarafe(v) {
  const group = new THREE.Group();
  const pts = [
    new THREE.Vector2(0, 0.02),
    new THREE.Vector2(0.42, 0.02),
    new THREE.Vector2(0.55, 0.18),
    new THREE.Vector2(0.58, 0.7),
    new THREE.Vector2(0.5, 1.15),
    new THREE.Vector2(0.32, 1.5),
    new THREE.Vector2(0.23, 1.75),
    new THREE.Vector2(0.22, 2.05),
    new THREE.Vector2(0.3, 2.24),
    new THREE.Vector2(0.26, 2.25),
    new THREE.Vector2(0.19, 2.08),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 56), glassMaterial(0xf4f6f2, { thickness: 0.06 }));
  body.renderOrder = 10;
  group.add(body);

  // Видимая жидкость внутри графина
  if (v.liquid !== undefined) {
    const liqPts = [
      new THREE.Vector2(0, 0.06),
      new THREE.Vector2(0.4, 0.06),
      new THREE.Vector2(0.52, 0.2),
      new THREE.Vector2(0.545, 0.7),
      new THREE.Vector2(0.47, 1.12),
      new THREE.Vector2(0.3, 1.45),
      new THREE.Vector2(0, 1.45),
    ];
    const liq = new THREE.Mesh(
      new THREE.LatheGeometry(liqPts, 48),
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(v.liquid).multiplyScalar(0.55),
        roughness: 0.45,
        clearcoat: 0.2,
        envMapIntensity: 0.3,
      })
    );
    liq.renderOrder = 2;
    group.add(liq);
  }
  group.userData.mouthHeight = 2.24;
  group.userData.mouthR = 0.2;
  return group;
}

export function buildVessel(v) {
  let group;
  if (v.shape === 'carafe') group = buildCarafe(v);
  else if (v.shape === 'soda') group = buildSodaBottle(v);
  else group = buildSpiritBottle(v);
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return group;
}

// ---------- Струя ----------

export function buildStream() {
  const geo = new THREE.CylinderGeometry(0.5, 0.36, 1, 14, 1, true);
  geo.translate(0, -0.5, 0); // верх струи в origin
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.05,
    clearcoat: 1,
    transparent: true,
    opacity: 0.85,
    envMapIntensity: 1.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 15;
  mesh.visible = false;
  return mesh;
}
