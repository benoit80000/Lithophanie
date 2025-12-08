import React, { useState, useEffect } from 'react';

// ========================================
// CONFIGURATION PRO / RESOLUTION
// ========================================

const RESOLUTION_CONFIG = {
  low: 400,      // Images < 500px
  medium: 800,   // 500–1500 px
  high: 1200,    // 1500–3000 px
  ultra: 2000,   // > 3000 px
};

function getOptimalResolution(imageWidth, imageHeight) {
  const maxDim = Math.max(imageWidth, imageHeight);

  if (maxDim < 500) return RESOLUTION_CONFIG.low;
  if (maxDim < 1500) return RESOLUTION_CONFIG.medium;
  if (maxDim < 3000) return RESOLUTION_CONFIG.high;
  return RESOLUTION_CONFIG.ultra;
}

function canHandleResolution(width, height) {
  const pixels = width * height;
  const memoryMB = (pixels * 32) / (1024 * 1024); // estimation Float32
  return memoryMB < 500; // limite de sécurité ~500 Mo
}

// ========================================
// INTERPOLATION BICUBIQUE
// ========================================

function cubicInterpolate(p0, p1, p2, p3, x) {
  return (
    p1 +
    0.5 *
      x *
      (p2 -
        p0 +
        x *
          (2.0 * p0 -
            5.0 * p1 +
            4.0 * p2 -
            p3 +
            x * (3.0 * (p1 - p2) + p3 - p0)))
  );
}

function bicubicSample(heightMap, u, v) {
  const h = heightMap.length;
  const w = heightMap[0].length;

  const x = u * (w - 1);
  const y = v * (h - 1);
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;

  const arr = [];
  for (let j = -1; j <= 2; j++) {
    const yy = Math.max(0, Math.min(h - 1, yi + j));
    const row = [];
    for (let i = -1; i <= 2; i++) {
      const xx = Math.max(0, Math.min(w - 1, xi + i));
      row.push(heightMap[yy][xx]);
    }
    arr.push(cubicInterpolate(row[0], row[1], row[2], row[3], fx));
  }

  return cubicInterpolate(arr[0], arr[1], arr[2], arr[3], fy);
}

// ========================================
// PRÉTRAITEMENT IMAGE
// (CLAHE, unsharp, médian, gamma profiles)
// ========================================

function applyCLAHE(imageData, clipLimit = 2.0, tileSize = 16) {
  const width = imageData.width;
  const height = imageData.height;
  const result = new Uint8ClampedArray(imageData.data);

  const tilesX = Math.ceil(width / tileSize);
  const tilesY = Math.ceil(height / tileSize);

  const cdfs = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const hist = new Array(256).fill(0);

      for (let y = ty * tileSize; y < Math.min((ty + 1) * tileSize, height); y++) {
        for (let x = tx * tileSize; x < Math.min((tx + 1) * tileSize, width); x++) {
          const i = (y * width + x) * 4;
          const gray = Math.round(
            (imageData.data[i] +
              imageData.data[i + 1] +
              imageData.data[i + 2]) /
              3
          );
          hist[gray]++;
        }
      }

      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > clipLimit) {
          excess += hist[i] - clipLimit;
          hist[i] = clipLimit;
        }
      }
      const redistribute = excess / 256;
      for (let i = 0; i < 256; i++) {
        hist[i] += redistribute;
      }

      const cdf = [hist[0]];
      for (let i = 1; i < 256; i++) {
        cdf[i] = cdf[i - 1] + hist[i];
      }

      const cdfMin = cdf.find((v) => v > 0) || 0;
      const cdfMax = cdf[255];
      const normCdf = cdf.map(
        (v) => ((v - cdfMin) / (cdfMax - cdfMin || 1)) * 255
      );

      cdfs.push(normCdf);
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const gray = Math.round(
        (imageData.data[i] +
          imageData.data[i + 1] +
          imageData.data[i + 2]) /
          3
      );

      const tx = x / tileSize;
      const ty = y / tileSize;
      const tx0 = Math.floor(tx),
        tx1 = Math.min(tilesX - 1, tx0 + 1);
      const ty0 = Math.floor(ty),
        ty1 = Math.min(tilesY - 1, ty0 + 1);
      const fx = tx - tx0,
        fy = ty - ty0;

      const v00 = cdfs[ty0 * tilesX + tx0][gray];
      const v10 = cdfs[ty0 * tilesX + tx1][gray];
      const v01 = cdfs[ty1 * tilesX + tx0][gray];
      const v11 = cdfs[ty1 * tilesX + tx1][gray];

      const value = Math.round(
        v00 * (1 - fx) * (1 - fy) +
          v10 * fx * (1 - fy) +
          v01 * (1 - fx) * fy +
          v11 * fx * fy
      );

      result[i] = result[i + 1] = result[i + 2] = value;
      result[i + 3] = 255;
    }
  }

  return new ImageData(result, width, height);
}

function createGaussianKernel(radius) {
  const size = Math.ceil(radius * 3) * 2 + 1;
  const kernel = [];
  const sigma = radius / 3;
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const x = i - Math.floor(size / 2);
    const value = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel.push(value);
    sum += value;
  }

  return kernel.map((v) => v / sum);
}

function unsharpMask(imageData, amount = 1.5, radius = 1.0) {
  const width = imageData.width;
  const height = imageData.height;

  const kernel = createGaussianKernel(radius);
  const blurred = new Uint8ClampedArray(imageData.data);

  // Blur horizontal (simple)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0,
        wsum = 0;
      for (let k = 0; k < kernel.length; k++) {
        const xx = Math.max(
          0,
          Math.min(width - 1, x + k - Math.floor(kernel.length / 2))
        );
        const i = (y * width + xx) * 4;
        sum += imageData.data[i] * kernel[k];
        wsum += kernel[k];
      }
      const i = (y * width + x) * 4;
      const v = sum / wsum;
      blurred[i] = blurred[i + 1] = blurred[i + 2] = v;
    }
  }

  const result = new Uint8ClampedArray(imageData.data);

  for (let i = 0; i < imageData.data.length; i += 4) {
    const original = imageData.data[i];
    const blur = blurred[i];
    const mask = original - blur;
    const sharpened = original + mask * amount;
    const s = Math.max(0, Math.min(255, sharpened));
    result[i] = result[i + 1] = result[i + 2] = s;
    result[i + 3] = 255;
  }

  return new ImageData(result, width, height);
}

// Filtre médian (réduction de bruit)
function medianFilter(imageData, kernelSize = 3) {
  const width = imageData.width;
  const height = imageData.height;
  const result = new ImageData(width, height);
  const half = Math.floor(kernelSize / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const values = [];
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const xx = Math.max(0, Math.min(width - 1, x + kx));
          const yy = Math.max(0, Math.min(height - 1, y + ky));
          const i = (yy * width + xx) * 4;
          values.push(imageData.data[i]);
        }
      }
      values.sort((a, b) => a - b);
      const median = values[Math.floor(values.length / 2)];
      const i = (y * width + x) * 4;
      result.data[i] = result.data[i + 1] = result.data[i + 2] = median;
      result.data[i + 3] = 255;
    }
  }

  return result;
}

// Profils de prétraitement
const PREPROCESS_PROFILES = {
  none: [],
  basic: ['denoise', 'sharpen'],
  portrait: ['denoise', 'clahe', 'sharpen', 'gamma'],
  technical: ['denoise', 'sharpen', 'gamma'],
};

function applyGamma(imageData, gamma) {
  if (gamma === 1) return imageData;
  const width = imageData.width;
  const height = imageData.height;
  const result = new ImageData(width, height);

  const inv = 1 / gamma;

  for (let i = 0; i < imageData.data.length; i += 4) {
    const v = imageData.data[i] / 255;
    const g = Math.pow(v, inv) * 255;
    const gg = Math.max(0, Math.min(255, g));
    result.data[i] = result.data[i + 1] = result.data[i + 2] = gg;
    result.data[i + 3] = 255;
  }

  return result;
}

function preprocessImage(imageData, profile, gamma) {
  let result = imageData;
  const steps = PREPROCESS_PROFILES[profile] || [];

  for (const step of steps) {
    switch (step) {
      case 'denoise':
        result = medianFilter(result, 3);
        break;
      case 'clahe':
        result = applyCLAHE(result, 2.0, 8);
        break;
      case 'sharpen':
        result = unsharpMask(result, 1.5, 1.0);
        break;
      case 'gamma':
        result = applyGamma(result, gamma);
        break;
      default:
        break;
    }
  }

  return result;
}

// ========================================
// GÉNÉRATION HEIGHTMAP (avec prétraitement)
// ========================================

function generateHeightMapFromImage(imageSrc, minThickness, maxThickness, settings) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      const optimal = getOptimalResolution(w, h);

      if (w > h) {
        const ratio = h / w;
        w = optimal;
        h = Math.max(2, Math.round(optimal * ratio));
      } else {
        const ratio = w / h;
        h = optimal;
        w = Math.max(2, Math.round(optimal * ratio));
      }

      if (!canHandleResolution(w, h)) {
        console.warn('Résolution trop grande, réduction forcée');
        w = 800;
        h = 800;
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      let imageData = ctx.getImageData(0, 0, w, h);

      // Profil de prétraitement avancé
      imageData = preprocessImage(
        imageData,
        settings.preprocessProfile || 'portrait',
        settings.gamma
      );

      const data = imageData.data;
      const heightMap = [];

      for (let y = 0; y < h; y++) {
        const row = [];
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          const v = (r * 0.299 + g * 0.587 + b * 0.114) / 255;

          // On applique encore le gamma de mapping épaisseur (fine-tuning)
          const vAdjusted = Math.pow(v, settings.gamma);

          const thickness =
            minThickness + (1 - vAdjusted) * (maxThickness - minThickness);
          row.push(thickness);
        }
        heightMap.push(row);
      }

      resolve({ heightMap, width: w, height: h });
    };
    img.onerror = reject;
    img.src = imageSrc;
  });
}

// ========================================
// STL UTILS
// ========================================

function normalOfTriangle(p1, p2, p3) {
  const ux = p2[0] - p1[0],
    uy = p2[1] - p1[1],
    uz = p2[2] - p1[2];
  const vx = p3[0] - p1[0],
    vy = p3[1] - p1[1],
    vz = p3[2] - p1[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / length, ny / length, nz / length];
}

function triangleToStl(p1, p2, p3) {
  const n = normalOfTriangle(p1, p2, p3);
  return [
    `  facet normal ${n[0].toFixed(6)} ${n[1].toFixed(6)} ${n[2].toFixed(6)}`,
    '    outer loop',
    `      vertex ${p1[0].toFixed(6)} ${p1[1].toFixed(6)} ${p1[2].toFixed(6)}`,
    `      vertex ${p2[0].toFixed(6)} ${p2[1].toFixed(6)} ${p2[2].toFixed(6)}`,
    `      vertex ${p3[0].toFixed(6)} ${p3[1].toFixed(6)} ${p3[2].toFixed(6)}`,
    '    endloop',
    '  endfacet',
  ].join('\n');
}

// ========================================
// GÉNÉRATION STL (cadre / sphère / cylindre)
// ========================================

function generateFlatLithophaneStl(
  heightMap,
  gridWidth,
  gridHeight,
  sizeXmm,
  sizeYmm
) {
  const dx = sizeXmm / (gridWidth - 1);
  const dy = sizeYmm / (gridHeight - 1);
  const lines = ['solid lithophane'];
  const point = (x, y, z) => [x, y, z];

  for (let y = 0; y < gridHeight - 1; y++) {
    for (let x = 0; x < gridWidth - 1; x++) {
      const z1 = heightMap[y][x];
      const z2 = heightMap[y][x + 1];
      const z3 = heightMap[y + 1][x];
      const z4 = heightMap[y + 1][x + 1];

      const p1 = point(x * dx, y * dy, z1);
      const p2 = point((x + 1) * dx, y * dy, z2);
      const p3 = point(x * dx, (y + 1) * dy, z3);
      const p4 = point((x + 1) * dx, (y + 1) * dy, z4);

      lines.push(triangleToStl(p1, p2, p3));
      lines.push(triangleToStl(p2, p4, p3));

      const b1 = point(x * dx, y * dy, 0);
      const b2 = point((x + 1) * dx, y * dy, 0);
      const b3 = point(x * dx, (y + 1) * dy, 0);
      const b4 = point((x + 1) * dx, (y + 1) * dy, 0);

      lines.push(triangleToStl(b3, b2, b1));
      lines.push(triangleToStl(b3, b4, b2));
    }
  }

  const H = gridHeight,
    W = gridWidth;
  const addWallStrip = (coordsTop, coordsBottom) => {
    for (let i = 0; i < coordsTop.length - 1; i++) {
      const p1 = coordsTop[i],
        p2 = coordsTop[i + 1];
      const p3 = coordsBottom[i],
        p4 = coordsBottom[i + 1];
      lines.push(triangleToStl(p1, p3, p2));
      lines.push(triangleToStl(p2, p3, p4));
    }
  };

  [0, H - 1].forEach((yLine) => {
    const top = [],
      bottom = [];
    for (let x = 0; x < W; x++) {
      top.push(point(x * dx, yLine * dy, heightMap[yLine][x]));
      bottom.push(point(x * dx, yLine * dy, 0));
    }
    addWallStrip(top, bottom);
  });

  [0, W - 1].forEach((xLine) => {
    const top = [],
      bottom = [];
    for (let y = 0; y < H; y++) {
      top.push(point(xLine * dx, y * dy, heightMap[y][xLine]));
      bottom.push(point(xLine * dx, y * dy, 0));
    }
    addWallStrip(top, bottom);
  });

  lines.push('endsolid lithophane');
  return lines.join('\n');
}

function generateSphereStl(
  heightMap,
  gridWidth,
  gridHeight,
  diameter,
  minThickness,
  maxThickness
) {
  const lines = ['solid lithophane_sphere'];
  const radius = diameter / 2;
  const segments = Math.min(
    250,
    Math.max(150, Math.floor(Math.max(gridWidth, gridHeight) * 1.2))
  );

  for (let lat = 0; lat < segments; lat++) {
    for (let lon = 0; lon < segments; lon++) {
      if (lat < segments - 1 && lon < segments - 1) {
        const getPoint = (lt, ln) => {
          const u = ln / segments;
          const v = lt / segments;
          const thickness = bicubicSample(heightMap, u, v);
          const theta = (ln * 2 * Math.PI) / segments;
          const phi = (lt * Math.PI) / segments;
          const r = radius + thickness - (maxThickness + minThickness) / 2;
          return [
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi),
          ];
        };

        const p1 = getPoint(lat, lon);
        const p2 = getPoint(lat, lon + 1);
        const p3 = getPoint(lat + 1, lon);
        const p4 = getPoint(lat + 1, lon + 1);

        lines.push(triangleToStl(p1, p2, p3));
        lines.push(triangleToStl(p2, p4, p3));
      }
    }
  }

  lines.push('endsolid lithophane_sphere');
  return lines.join('\n');
}

function generateCylinderStl(
  heightMap,
  gridWidth,
  gridHeight,
  diameter,
  height,
  minThickness,
  maxThickness
) {
  const lines = ['solid lithophane_cylinder'];
  const radius = diameter / 2;
  const segments = Math.min(250, Math.max(150, gridWidth));
  const rings = Math.min(250, Math.max(150, gridHeight));

  for (let ring = 0; ring < rings; ring++) {
    for (let seg = 0; seg < segments; seg++) {
      if (ring < rings - 1 && seg < segments - 1) {
        const getPoint = (rg, sg) => {
          const u = sg / segments;
          const v = rg / rings;
          const thickness = bicubicSample(heightMap, u, v);
          const theta = (sg * 2 * Math.PI) / segments;
          const y = (rg * height) / rings;
          const r = radius - thickness + (maxThickness + minThickness) / 2;
          return [r * Math.cos(theta), y, r * Math.sin(theta)];
        };

        const p1 = getPoint(ring, seg);
        const p2 = getPoint(ring, seg + 1);
        const p3 = getPoint(ring + 1, seg);
        const p4 = getPoint(ring + 1, seg + 1);

        lines.push(triangleToStl(p1, p2, p3));
        lines.push(triangleToStl(p2, p4, p3));
      }
    }
  }

  lines.push('endsolid lithophane_cylinder');
  return lines.join('\n');
}

// ========================================
// COMPOSANT PRINCIPAL
// ========================================

export default function LithophaneMaker() {
  const [imageSrc, setImageSrc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLithoUrl, setPreviewLithoUrl] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [shape, setShape] = useState('frame');
  const [settings, setSettings] = useState({
    widthMm: 80,
    heightMm: 80,
    diameter: 80,
    minThickness: 0.8,
    maxThickness: 3.0,
    gamma: 1.2,
    preprocessProfile: 'portrait', // <- nouveauté
  });

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result;
      setImageSrc(src);
      setPreviewUrl(src);
    };
    reader.readAsDataURL(file);
  };

  const handleNumberChange = (key) => (e) => {
    const value = parseFloat(e.target.value) || 0;
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleProfileChange = (e) => {
    setSettings((prev) => ({ ...prev, preprocessProfile: e.target.value }));
  };

  // Prévisualisation "lithophanie"
  useEffect(() => {
    if (!imageSrc) {
      setPreviewLithoUrl(null);
      return;
    }

    let cancelled = false;

    const makePreview = async () => {
      try {
        const { heightMap, width, height } = await generateHeightMapFromImage(
          imageSrc,
          settings.minThickness,
          settings.maxThickness,
          settings
        );

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(width, height);

        const minT = settings.minThickness;
        const maxT = settings.maxThickness;
        const range = Math.max(0.0001, maxT - minT);

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const t = heightMap[y][x];
            const tNorm = (t - minT) / range;
            const brightness = 1 - tNorm;
            const b = Math.round(255 * brightness);
            const i = (y * width + x) * 4;
            imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = b;
            imgData.data[i + 3] = 255;
          }
        }

        ctx.putImageData(imgData, 0, 0);
        const url = canvas.toDataURL('image/png');
        if (!cancelled) {
          setPreviewLithoUrl(url);
        }
      } catch (err) {
        console.error('Erreur preview lithophanie :', err);
      }
    };

    makePreview();

    return () => {
      cancelled = true;
    };
  }, [imageSrc, settings]);

  const handleExportStl = async () => {
    if (!imageSrc) {
      alert("Chargez une image d'abord");
      return;
    }

    try {
      setIsGenerating(true);

      const { heightMap, width, height } = await generateHeightMapFromImage(
        imageSrc,
        settings.minThickness,
        settings.maxThickness,
        settings
      );

      let stl;
      switch (shape) {
        case 'frame':
          stl = generateFlatLithophaneStl(
            heightMap,
            width,
            height,
            settings.widthMm,
            settings.heightMm
          );
          break;
        case 'bauble':
          stl = generateSphereStl(
            heightMap,
            width,
            height,
            settings.diameter,
            settings.minThickness,
            settings.maxThickness
          );
          break;
        case 'cylinder':
        case 'cone': // pour l’instant même géométrie de base
          stl = generateCylinderStl(
            heightMap,
            width,
            height,
            settings.diameter,
            settings.heightMm,
            settings.minThickness,
            settings.maxThickness
          );
          break;
        default:
          stl = generateFlatLithophaneStl(
            heightMap,
            width,
            height,
            settings.widthMm,
            settings.heightMm
          );
      }

      const blob = new Blob([stl], { type: 'model/stl' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lithophane_${shape}_${width}x${height}.stl`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      alert(
        `🎉 STL ULTRA PRO EXPORTÉ !\n\n` +
          `📊 RÉSOLUTION: ${width}×${height} (${width * height} points)\n` +
          `✨ Profil: ${settings.preprocessProfile}\n` +
          `• Min: ${settings.minThickness}mm\n` +
          `• Max: ${settings.maxThickness}mm\n` +
          `• Gamma: ${settings.gamma}\n\n` +
          `🖨️ IMPRESSION: 0.12mm, 100% infill, PLA blanc ou translucide.`
      );
    } catch (err) {
      console.error(err);
      alert('Erreur génération STL');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <section className="litho-section">
      <div className="litho-grid">
        {/* PANEL GAUCHE : IMAGE + PRÉVISU */}
        <div className="litho-panel">
          <h2>1. Photo</h2>
          <p>Résolution traitée automatiquement (jusqu&apos;à ~2000×2000 px)</p>
          <label className="file-input-label">
            <input type="file" accept="image/*" onChange={handleFileChange} />
            <span>Choisir une image…</span>
          </label>

          {previewUrl && (
            <div className="preview-wrapper">
              <h3>Original</h3>
              <img src={previewUrl} alt="Preview" className="preview-image" />
            </div>
          )}

          <div className="preview-wrapper" style={{ marginTop: 12 }}>
            <h3>Simulation lithophanie (LED derrière)</h3>
            {previewLithoUrl ? (
              <img
                src={previewLithoUrl}
                alt="Litho"
                className="preview-image"
                style={{ background: 'black' }}
              />
            ) : (
              <p className="hint">
                Chargez une image pour voir la simulation de la lithophanie.
              </p>
            )}
          </div>
        </div>

        {/* PANEL DROIT : PARAMS + EXPORT */}
        <div className="litho-panel">
          <h2>2. Forme & Paramètres</h2>

          <div className="shape-grid">
            {[
              ['frame', '🖼️ Cadre plat'],
              ['bauble', '🎄 Boule'],
              ['cylinder', '💡 Cylindre'],
              ['cone', '🔦 Cône'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={shape === id ? 'shape-btn active' : 'shape-btn'}
                onClick={() => setShape(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="settings-group">
            <h3>Dimensions (mm)</h3>
            <div className="settings-row">
              {shape === 'frame' && (
                <>
                  <label>
                    Largeur
                    <input
                      type="number"
                      min="30"
                      max="200"
                      value={settings.widthMm}
                      onChange={handleNumberChange('widthMm')}
                    />
                  </label>
                  <label>
                    Hauteur
                    <input
                      type="number"
                      min="30"
                      max="200"
                      value={settings.heightMm}
                      onChange={handleNumberChange('heightMm')}
                    />
                  </label>
                </>
              )}

              {shape === 'bauble' && (
                <label>
                  Diamètre
                  <input
                    type="number"
                    min="40"
                    max="150"
                    value={settings.diameter}
                    onChange={handleNumberChange('diameter')}
                  />
                </label>
              )}

              {(shape === 'cylinder' || shape === 'cone') && (
                <>
                  <label>
                    Diamètre
                    <input
                      type="number"
                      min="40"
                      max="150"
                      value={settings.diameter}
                      onChange={handleNumberChange('diameter')}
                    />
                  </label>
                  <label>
                    Hauteur
                    <input
                      type="number"
                      min="30"
                      max="200"
                      value={settings.heightMm}
                      onChange={handleNumberChange('heightMm')}
                    />
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="settings-group">
            <h3>Épaisseur (mm)</h3>
            <div className="settings-row">
              <label>
                Min (zones claires)
                <input
                  type="number"
                  min="0.4"
                  max={settings.maxThickness}
                  step="0.1"
                  value={settings.minThickness}
                  onChange={handleNumberChange('minThickness')}
                />
              </label>
              <label>
                Max (zones sombres)
                <input
                  type="number"
                  min={settings.minThickness}
                  max="6"
                  step="0.1"
                  value={settings.maxThickness}
                  onChange={handleNumberChange('maxThickness')}
                />
              </label>
            </div>
            <p className="hint">
              Reco PLA blanc : 0.7–0.9 mm min, 2.8–3.2 mm max, couche 0.12 mm, 100% infill.
            </p>
          </div>

          <div className="settings-group">
            <h3>✨ Qualité / Prétraitement</h3>
            <div className="settings-row">
              <label>
                Profil de traitement
                <select
                  value={settings.preprocessProfile}
                  onChange={handleProfileChange}
                >
                  <option value="none">Aucun (brut)</option>
                  <option value="basic">Basique (denoise + netteté)</option>
                  <option value="portrait">Portrait (recommandé)</option>
                  <option value="technical">Technique / lignes</option>
                </select>
              </label>
            </div>
            <div className="settings-row" style={{ marginTop: 8 }}>
              <label>
                Gamma : {settings.gamma.toFixed(1)}
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.1"
                  value={settings.gamma}
                  onChange={handleNumberChange('gamma')}
                />
              </label>
            </div>
          </div>

          <div className="actions">
            <button
              type="button"
              className="export-btn"
              onClick={handleExportStl}
              disabled={isGenerating || !imageSrc}
            >
              {isGenerating ? 'Génération STL ULTRA…' : '📥 Export STL ULTRA PRO'}
            </button>
            {!imageSrc && (
              <p className="hint">
                Chargez d&apos;abord une image pour activer l&apos;export.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="print-tips">
        <h2>3. Paramètres d&apos;impression conseillés</h2>
        <ul>
          <li>✔️ PLA blanc / translucide</li>
          <li>✔️ Hauteur de couche : 0.10–0.16 mm (0.12 mm idéal)</li>
          <li>✔️ Infill : 100% (obligatoire en lithophanie)</li>
          <li>✔️ 5–7 murs minimum</li>
          <li>✔️ Orientation verticale, face au ventilateur</li>
        </ul>
      </div>
    </section>
  );
}
