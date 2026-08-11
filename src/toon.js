import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Мультяшный стиль: ступенчатый toon-шейдинг, чёрные контуры (inverted hull),
// рисованный canvas-задник. Геометрия и анимация — те же, что в реализме.
// ---------------------------------------------------------------------------

let _gradient;
export function toonGradient() {
  if (_gradient) return _gradient;
  const data = new Uint8Array([70, 140, 210, 255]);
  _gradient = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  _gradient.minFilter = THREE.NearestFilter;
  _gradient.magFilter = THREE.NearestFilter;
  _gradient.needsUpdate = true;
  return _gradient;
}

const OUTLINE_COLOR = 0x241a30;

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
      outline.scale.setScalar(1.035);
      outline.renderOrder = (mesh.renderOrder || 0) - 1;
      mesh.add(outline);
    }
  });
}

// ---------------------------------------------------------------------------
// Рисованный задник: стена, полки с мультяшными бутылками, лампы
// ---------------------------------------------------------------------------

export function makeToonBackdrop() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const ctx = c.getContext('2d');

  let seed = 13;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  // стена
  const wallGrad = ctx.createLinearGradient(0, 0, 0, c.height);
  wallGrad.addColorStop(0, '#2c2144');
  wallGrad.addColorStop(1, '#1a1430');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, c.width, c.height);

  const PALETTE = ['#e8734a', '#4aa76b', '#e8b84a', '#b4543f', '#5a7fc9', '#8a5fb0', '#d9dce6'];

  function bottle(x, baseY, w, h, color) {
    const neckW = w * 0.36;
    const neckH = h * 0.3;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#241a30';
    ctx.lineWidth = 5;
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
    ctx.fillStyle = '#3a2a20';
    ctx.fillRect(x - neckW / 2 - 2, baseY - h - 10, neckW + 4, 12);
    // блик
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x - w / 2 + w * 0.14, baseY - h + neckH + w * 0.3, w * 0.13, h - neckH - w * 0.3 - 8);
  }

  function shelf(y) {
    // доска
    ctx.fillStyle = '#6b4a2f';
    ctx.strokeStyle = '#241a30';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.rect(60, y, c.width - 120, 26);
    ctx.fill();
    ctx.stroke();
    // бутылки на доске
    let x = 140;
    while (x < c.width - 140) {
      const w = 46 + rand() * 30;
      const h = 130 + rand() * 90;
      bottle(x, y - 2, w, h, PALETTE[Math.floor(rand() * PALETTE.length)]);
      x += w + 40 + rand() * 50;
    }
  }

  shelf(400);
  shelf(700);

  // лампы: тёплые круги со свечением
  [0.22, 0.5, 0.78].forEach((fx) => {
    const x = c.width * fx;
    const y = 130;
    const glow = ctx.createRadialGradient(x, y, 10, x, y, 130);
    glow.addColorStop(0, 'rgba(255,196,110,0.5)');
    glow.addColorStop(1, 'rgba(255,196,110,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 130, y - 130, 260, 260);
    ctx.fillStyle = '#ffd98a';
    ctx.strokeStyle = '#241a30';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // шнур
    ctx.strokeStyle = '#241a30';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, y - 26);
    ctx.stroke();
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
