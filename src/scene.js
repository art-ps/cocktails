import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

function makeWoodTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext('2d');
  const base = ctx.createLinearGradient(0, 0, 0, c.height);
  base.addColorStop(0, '#5a3a20');
  base.addColorStop(1, '#4a2e17');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, c.width, c.height);

  // Доски и волокна
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const plankH = c.height / 6;
  for (let p = 0; p < 6; p++) {
    const y0 = p * plankH;
    const tone = 0.85 + rand() * 0.3;
    ctx.fillStyle = `rgba(${Math.round(90 * tone)}, ${Math.round(58 * tone)}, ${Math.round(30 * tone)}, 0.5)`;
    ctx.fillRect(0, y0, c.width, plankH);
    // волокна
    for (let i = 0; i < 70; i++) {
      const y = y0 + rand() * plankH;
      const alpha = 0.04 + rand() * 0.08;
      ctx.strokeStyle = rand() > 0.5 ? `rgba(30,16,6,${alpha})` : `rgba(200,150,90,${alpha * 0.7})`;
      ctx.lineWidth = 0.6 + rand() * 1.8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= c.width; x += 64) {
        ctx.lineTo(x, y + Math.sin(x * 0.01 + rand() * 6) * 3 + (rand() - 0.5) * 4);
      }
      ctx.stroke();
    }
    // щель между досками
    ctx.fillStyle = 'rgba(15,8,3,0.55)';
    ctx.fillRect(0, y0 + plankH - 2, c.width, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = 8;
  return tex;
}

function makeContactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 3, 9.5);
  camera.lookAt(0, 1.35, 0);

  // Тёплый ключевой свет сверху-слева, как лампа над баром
  const key = new THREE.DirectionalLight(0xffdcae, 2.6);
  key.position.set(-3.5, 7.5, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.far = 25;
  key.shadow.bias = -0.0004;
  key.shadow.radius = 6;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x9fb6ff, 0.7);
  rim.position.set(4, 4, -5);
  scene.add(rim);

  const fill = new THREE.AmbientLight(0x8a6a4a, 0.55);
  scene.add(fill);

  // Стол
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(26, 0.5, 12),
    new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.55, metalness: 0.05 })
  );
  table.position.y = -0.25;
  table.receiveShadow = true;
  scene.add(table);

  // Задник — размытая стена бара
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 24),
    new THREE.MeshStandardMaterial({ color: 0x2e1d12, roughness: 1 })
  );
  wall.position.set(0, 8, -7.5);
  scene.add(wall);

  const shadowTex = makeContactShadowTexture();
  function makeContactShadow(scale = 1) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2 * scale, 2.2 * scale),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.005;
    m.renderOrder = 1;
    return m;
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, makeContactShadow };
}
