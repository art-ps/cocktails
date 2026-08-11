import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Мультяшный стиль: ступенчатый toon-шейдинг, чёрные контуры (inverted hull),
// рисованный canvas-задник. Геометрия и анимация — те же, что в реализме.
// ---------------------------------------------------------------------------

let _gradient;
export function toonGradient() {
  if (_gradient) return _gradient;
  // мягкие светлые ступени: тени тёплые, не чёрные — дневной «гибли»-свет
  const data = new Uint8Array([130, 170, 205, 235, 255]);
  _gradient = new THREE.DataTexture(data, 5, 1, THREE.RedFormat);
  _gradient.minFilter = THREE.NearestFilter;
  _gradient.magFilter = THREE.NearestFilter;
  _gradient.needsUpdate = true;
  return _gradient;
}

const OUTLINE_COLOR = 0x5a4330; // тёплый коричневый, не чёрный

function outlineMaterial() {
  return new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
}

// Заменяет материалы группы на toon-эквиваленты и добавляет контуры.
export function applyToonStyle(root) {
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && !o.userData.outline && !o.userData.noToon) meshes.push(o);
  });
  meshes.forEach((mesh) => {
    const src = mesh.material;
    let mat;
    if (src.transmission > 0) {
      const c = src.color;
      const lum = c.r * 0.3 + c.g * 0.6 + c.b * 0.1;
      if (lum > 0.7) {
        // светлое стекло (стакан): мультяшное — белёсое, полупрозрачное
        mat = new THREE.MeshToonMaterial({
          color: 0xd6e9f8,
          gradientMap: toonGradient(),
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        });
      } else {
        // тонированные бутылки: плоский непрозрачный цвет, как на рисованном фоне
        mat = new THREE.MeshToonMaterial({
          color: c.clone(),
          gradientMap: toonGradient(),
        });
      }
    } else {
      mat = new THREE.MeshToonMaterial({
        color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
        gradientMap: toonGradient(),
      });
      if (src.map) mat.map = src.map;
      if (src.transparent) {
        mat.transparent = true;
        mat.opacity = src.opacity ?? 1;
        mat.depthWrite = src.depthWrite;
      }
    }
    mesh.material = mat;
    src.dispose?.();

    // Контур только у непрозрачных: BackSide-оболочка видна СКВОЗЬ
    // прозрачное стекло и превращает его в глухой тёмный силуэт
    if (!mesh.userData.animOpacity && !mesh.userData.noOutline && !mat.transparent) {
      const outline = new THREE.Mesh(mesh.geometry, outlineMaterial());
      outline.userData.outline = true;
      outline.scale.setScalar(1.022);
      outline.renderOrder = (mesh.renderOrder || 0) - 1;
      mesh.add(outline);
    }
  });
}

// ---------------------------------------------------------------------------
// Рисованный задник в духе Гибли: кремовая стена, окно с небом и облаками,
// деревянные полки с пастельными бутылками, растение в горшке
// ---------------------------------------------------------------------------

export function makeToonBackdrop() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const ctx = c.getContext('2d');

  let seed = 21;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const INK = '#6b4f35'; // тёплый контур
  const WOOD = '#b98a5a';
  const WOOD_DARK = '#8f6a42';

  // стена: тёплый крем с мягким градиентом
  const wallGrad = ctx.createLinearGradient(0, 0, 0, c.height);
  wallGrad.addColorStop(0, '#f7e7c3');
  wallGrad.addColorStop(1, '#e9cf9d');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, c.width, c.height);

  // ---------- окно с небом и облаками ----------
  const win = { x: 760, y: 90, w: 530, h: 470 };
  // небо
  const sky = ctx.createLinearGradient(0, win.y, 0, win.y + win.h);
  sky.addColorStop(0, '#7fbde4');
  sky.addColorStop(1, '#cdeaf6');
  ctx.fillStyle = sky;
  ctx.fillRect(win.x, win.y, win.w, win.h);

  // пухлые кучевые облака
  function cloud(cx, cy, s) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(win.x, win.y, win.w, win.h);
    ctx.clip();
    const lobes = [
      [0, 0, 1], [-1.1, 0.25, 0.72], [1.1, 0.25, 0.78], [-0.55, -0.5, 0.7], [0.6, -0.45, 0.66],
    ];
    ctx.fillStyle = '#fdfdfa';
    ctx.beginPath();
    lobes.forEach(([dx, dy, ds]) => {
      ctx.moveTo(cx + dx * s + s * ds, cy + dy * s);
      ctx.arc(cx + dx * s, cy + dy * s, s * ds, 0, Math.PI * 2);
    });
    ctx.fill();
    // тёплая тень снизу
    ctx.fillStyle = 'rgba(214,196,170,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + s * 0.62, s * 1.7, s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  cloud(win.x + 150, win.y + 150, 56);
  cloud(win.x + 400, win.y + 90, 40);
  cloud(win.x + 330, win.y + 300, 70);

  // зелёные холмы внизу окна
  ctx.save();
  ctx.beginPath();
  ctx.rect(win.x, win.y, win.w, win.h);
  ctx.clip();
  ctx.fillStyle = '#9fc177';
  ctx.beginPath();
  ctx.ellipse(win.x + 130, win.y + win.h + 40, 330, 120, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#83a95f';
  ctx.beginPath();
  ctx.ellipse(win.x + 470, win.y + win.h + 60, 380, 150, 0, Math.PI, 0);
  ctx.fill();
  ctx.restore();

  // рама
  ctx.strokeStyle = INK;
  ctx.fillStyle = WOOD;
  ctx.lineWidth = 6;
  ctx.strokeRect(win.x, win.y, win.w, win.h);
  ctx.fillRect(win.x - 22, win.y - 22, win.w + 44, 16);
  ctx.strokeRect(win.x - 22, win.y - 22, win.w + 44, 16);
  ctx.fillRect(win.x - 22, win.y + win.h + 6, win.w + 44, 20);
  ctx.strokeRect(win.x - 22, win.y + win.h + 6, win.w + 44, 20);
  ctx.fillRect(win.x - 16, win.y - 6, 12, win.h + 12);
  ctx.strokeRect(win.x - 16, win.y - 6, 12, win.h + 12);
  ctx.fillRect(win.x + win.w + 4, win.y - 6, 12, win.h + 12);
  ctx.strokeRect(win.x + win.w + 4, win.y - 6, 12, win.h + 12);
  // перекладина
  ctx.fillRect(win.x, win.y + win.h / 2 - 6, win.w, 12);
  ctx.strokeRect(win.x, win.y + win.h / 2 - 6, win.w, 12);

  // ---------- бутылки ----------
  const PALETTE = ['#c96f4a', '#8aa964', '#e0b464', '#a45a48', '#7f9fc4', '#c4a5c9', '#efe6d2'];

  function bottle(x, baseY, w, h, color) {
    const neckW = w * 0.36;
    const neckH = h * 0.3;
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, baseY);
    ctx.lineTo(x - w / 2, baseY - h + neckH + w * 0.3);
    ctx.quadraticCurveTo(x - w / 2, baseY - h + neckH, x - neckW / 2, baseY - h + neckH * 0.7);
    ctx.lineTo(x - neckW / 2, baseY - h);
    ctx.lineTo(x + neckW / 2, baseY - h);
    ctx.lineTo(x + neckW / 2, baseY - h + neckH * 0.7);
    ctx.quadraticCurveTo(x + w / 2, baseY - h + neckH, x + w / 2, baseY - h + neckH + w * 0.3);
    ctx.lineTo(x + w / 2, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // пробка
    ctx.fillStyle = '#7d5a3a';
    ctx.fillRect(x - neckW / 2 - 2, baseY - h - 9, neckW + 4, 11);
    ctx.strokeRect(x - neckW / 2 - 2, baseY - h - 9, neckW + 4, 11);
    // мягкий блик
    ctx.fillStyle = 'rgba(255,252,240,0.45)';
    ctx.beginPath();
    ctx.ellipse(x - w * 0.24, baseY - (h - neckH) * 0.45, w * 0.07, (h - neckH) * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function shelf(x0, x1, y) {
    ctx.fillStyle = WOOD;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.rect(x0, y, x1 - x0, 24);
    ctx.fill();
    ctx.stroke();
    // кронштейны
    [x0 + 30, x1 - 44].forEach((bx) => {
      ctx.fillStyle = WOOD_DARK;
      ctx.fillRect(bx, y + 24, 14, 26);
      ctx.strokeRect(bx, y + 24, 14, 26);
    });
    let x = x0 + 70;
    while (x < x1 - 70) {
      const w = 44 + rand() * 28;
      const h = 120 + rand() * 80;
      bottle(x, y - 2, w, h, PALETTE[Math.floor(rand() * PALETTE.length)]);
      x += w + 38 + rand() * 46;
    }
  }

  // полки слева и справа от окна, два яруса
  shelf(90, 660, 330);
  shelf(90, 660, 640);
  shelf(1390, 1960, 330);
  shelf(1390, 1960, 640);

  // ---------- растение на правой полке ----------
  const px = 1500;
  const py = 320;
  ctx.fillStyle = '#b56a4a';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(px - 34, py - 60);
  ctx.lineTo(px + 34, py - 60);
  ctx.lineTo(px + 24, py);
  ctx.lineTo(px - 24, py);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#7da45c';
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i - 3) * 0.42;
    const lx = px + Math.cos(a) * 52;
    const ly = py - 66 + Math.sin(a) * 58;
    ctx.beginPath();
    ctx.ellipse(lx, ly, 16, 34, a + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // мягкий солнечный отсвет от окна на стене
  const glow = ctx.createRadialGradient(
    win.x + win.w / 2, win.y + win.h / 2, 200,
    win.x + win.w / 2, win.y + win.h / 2, 900
  );
  glow.addColorStop(0, 'rgba(255,240,200,0.35)');
  glow.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, c.width, c.height);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
