import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeToonBackdrop, toonGradient } from './toon.js';

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

  // HDRI — только отражения в стекле. Видимый фон — Cycles-рендер того же
  // бара (blender --backdrop): полки с бутылками, DOF уже запечён.
  new RGBELoader().load('hdri/bar.hdr', (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = tex;
    scene.environmentIntensity = 0.5;
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
  // Барная стойка: неглубокая, задний край виден на фоне бара
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(26, 0.5, 7),
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

  // Задник: Cycles-кадр бара той же камерой (blender --backdrop) —
  // стол в текстуре бесшовно продолжает realtime-стол, боке запечён
  const backdropTex = texLoader.load('textures/backdrop.webp');
  backdropTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = backdropTex;

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

  // Переключение окружения: реализм (Cycles-задник, PBR-стол, bloom)
  // или мультяшный стиль (рисованный задник, плоский стол, без bloom)
  const woodMaterial = table.material;
  let toonBackdrop = null;
  let toonTableMat = null;
  function applyStyle(style) {
    if (style === 'toon') {
      toonBackdrop = toonBackdrop || makeToonBackdrop();
      toonTableMat = toonTableMat || new THREE.MeshToonMaterial({
        color: 0xc98f55, // медовое дерево
        gradientMap: toonGradient(),
      });
      scene.background = toonBackdrop;
      table.material = toonTableMat;
      bloom.enabled = false;
      // мягкий дневной свет
      key.intensity = 1.0;
      fill.intensity = 0.6;
      rim.intensity = 0.15;
    } else {
      scene.background = backdropTex;
      table.material = woodMaterial;
      bloom.enabled = true;
      key.intensity = 1.3;
      fill.intensity = 0.25;
      rim.intensity = 0.4;
    }
  }

  return { renderer, scene, camera, makeContactShadow, makeCaustic, composer, applyStyle };
}
