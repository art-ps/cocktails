// Скраббинг пре-рендеренной последовательности кадров (режим «как видео»).
// Кадры рендерятся Blender-скриптами из blender/ в public/frames/<id>/.

export class FrameSequence {
  constructor({ base, count, pad = 4, ext = '.webp' }) {
    this.base = base;
    this.count = count;
    this.pad = pad;
    this.ext = ext;
    this.images = new Array(count).fill(null); // null | 'loading' | HTMLImageElement | 'error'
    this.loadedCount = 0;
  }

  url(i) {
    return this.base + String(i + 1).padStart(this.pad, '0') + this.ext;
  }

  load(i) {
    if (this.images[i] instanceof Image || this.images[i] === 'loading') return;
    this.images[i] = 'loading';
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      this.images[i] = img;
      this.loadedCount++;
      this.onProgress?.(this.loadedCount / this.count);
    };
    img.onerror = () => {
      this.images[i] = 'error';
    };
    img.src = this.url(i);
  }

  // Проверяем, что последовательность вообще существует
  probe() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = this.url(0);
    });
  }

  // Грузим всё с ограниченной параллельностью
  preloadAll(concurrency = 10) {
    let next = 0;
    const pump = () => {
      while (next < this.count) {
        const inFlight = this.images.filter((x) => x === 'loading').length;
        if (inFlight >= concurrency) break;
        this.load(next++);
      }
      if (next < this.count) setTimeout(pump, 60);
    };
    pump();
  }

  // Ближайший загруженный кадр к прогрессу p
  nearest(p) {
    const target = Math.max(0, Math.min(this.count - 1, Math.round(p * (this.count - 1))));
    if (this.images[target] instanceof Image) return this.images[target];
    for (let d = 1; d < this.count; d++) {
      const lo = target - d;
      const hi = target + d;
      if (lo >= 0 && this.images[lo] instanceof Image) return this.images[lo];
      if (hi < this.count && this.images[hi] instanceof Image) return this.images[hi];
    }
    return null;
  }
}

export function drawCover(ctx, img, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
