import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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

// Пятно «каустики» — светлый градиент, аддитивно подсвечивает стол под стаканом
function makeCausticTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 120);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // 1.5 вместо 2: transmission + постобработка дороги на ретине
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // transmission-проход в полразрешения: преломление чуть мягче, но вдвое дешевле
  renderer.transmissionResolutionScale = 0.5;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // HDRI бара: окружение (отражения в стекле) + размытый фон вместо стены
  new RGBELoader().load('hdri/bar.hdr', (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = tex;
    scene.background = tex;
    scene.backgroundBlurriness = 0.12;
    scene.backgroundIntensity = 0.35;
    scene.environmentIntensity = 0.5;
    scene.backgroundRotation = new THREE.Euler(0, Math.PI * 1.0, 0);
    scene.environmentRotation = new THREE.Euler(0, Math.PI * 1.0, 0);
  });

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 3, 9.5);
  camera.lookAt(0, 1.35, 0);

  // Тёплый ключевой свет сверху-слева, как лампа над баром
  // (HDRI берёт на себя часть освещения, поэтому интенсивности умеренные)
  const key = new THREE.DirectionalLight(0xffdcae, 1.3);
  key.position.set(-3.5, 7.5, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.far = 25;
  key.shadow.bias = -0.0004;
  key.shadow.radius = 6;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x9fb6ff, 0.4);
  rim.position.set(4, 4, -5);
  scene.add(rim);

  const fill = new THREE.AmbientLight(0x8a6a4a, 0.25);
  scene.add(fill);

  // Стол — PBR-орех (ambientCG Wood066)
  const texLoader = new THREE.TextureLoader();
  const woodColor = texLoader.load('textures/wood_color.jpg');
  woodColor.colorSpace = THREE.SRGBColorSpace;
  const woodNormal = texLoader.load('textures/wood_normal.jpg');
  const woodRough = texLoader.load('textures/wood_rough.jpg');
  [woodColor, woodNormal, woodRough].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 1.5);
    t.anisotropy = 8;
  });
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(26, 0.5, 12),
    new THREE.MeshStandardMaterial({
      map: woodColor,
      normalMap: woodNormal,
      roughnessMap: woodRough,
      metalness: 0.05,
    })
  );
  table.position.y = -0.25;
  table.receiveShadow = true;
  scene.add(table);

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

  const causticTex = makeCausticTexture();
  function makeCaustic(scale = 1) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6 * scale, 2.6 * scale),
      new THREE.MeshBasicMaterial({
        map: causticTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.006;
    m.renderOrder = 2;
    return m;
  }

  // Постобработка: мягкий bloom на бликах. Глубину кадра даёт размытый
  // HDRI-фон + CSS-виньетка — BokehPass не окупал свои ~4 fps.
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      samples: 4,
      type: THREE.HalfFloatType,
    })
  );
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.07, 0.3, 1.0
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // отладочный хук (безвреден в проде)
  window.__post = { bloom, renderer };

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, makeContactShadow, makeCaustic, composer };
}
