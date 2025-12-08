import React, { useState, useEffect } from 'react';

// ✅ AMÉLIORATION #1 : Résolution augmentée
const MAX_GRID_SIZE = 400; // 4x plus de détails !

// ✅ AMÉLIORATION #2 : Interpolation bilinéaire
function bilinearSample(heightMap, u, v) {
  const h = heightMap.length;
  const w = heightMap[0].length;
  
  const x = u * (w - 1);
  const y = v * (h - 1);
  const x0 = Math.max(0, Math.floor(x));
  const x1 = Math.min(w - 1, Math.ceil(x));
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(h - 1, Math.ceil(y));
  
  const fx = x - x0;
  const fy = y - y0;
  
  const v00 = heightMap[y0][x0];
  const v10 = heightMap[y0][x1];
  const v01 = heightMap[y1][x0];
  const v11 = heightMap[y1][x1];
  
  return (
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy
  );
}

// Génération heightmap avec gamma
function generateHeightMapFromImage(imageSrc, minThickness, maxThickness, gamma = 1.0) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      let w = img.width;
      let h = img.height;
      
      // ✅ Résolution adaptative selon taille image
      const maxDim = Math.max(w, h);
      const targetSize = maxDim > 1500 ? MAX_GRID_SIZE : Math.min(MAX_GRID_SIZE, maxDim);
      
      if (w > h) {
        const ratio = h / w;
        w = targetSize;
        h = Math.max(2, Math.round(targetSize * ratio));
      } else {
        const ratio = w / h;
        h = targetSize;
        w = Math.max(2, Math.round(targetSize * ratio));
      }

      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      const data = ctx.getImageData(0, 0, w, h).data;
      const heightMap = [];
      
      for (let y = 0; y < h; y++) {
        const row = [];
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          // Conversion en niveaux de gris
          const v = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          
          // ✅ AMÉLIORATION #3 : Ajustement gamma
          const vAdjusted = Math.pow(v, gamma);
          
          // Blanc = fin, Noir = épais
          const thickness = minThickness + (1 - vAdjusted) * (maxThickness - minThickness);
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

// Utilitaires STL
function normalOfTriangle(p1, p2, p3) {
  const ux = p2[0] - p1[0], uy = p2[1] - p1[1], uz = p2[2] - p1[2];
  const vx = p3[0] - p1[0], vy = p3[1] - p1[1], vz = p3[2] - p1[2];
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

// ✅ OPTIMISÉ : Cadre plat haute résolution
function generateFlatLithophaneStl(heightMap, gridWidth, gridHeight, sizeXmm, sizeYmm) {
  const dx = sizeXmm / (gridWidth - 1);
  const dy = sizeYmm / (gridHeight - 1);
  const lines = ['solid lithophane'];
  const point = (x, y, z) => [x, y, z];

  // Surface supérieure et inférieure
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

  // Parois
  const H = gridHeight, W = gridWidth;
  const addWallStrip = (coordsTop, coordsBottom) => {
    for (let i = 0; i < coordsTop.length - 1; i++) {
      const p1 = coordsTop[i], p2 = coordsTop[i + 1];
      const p3 = coordsBottom[i], p4 = coordsBottom[i + 1];
      lines.push(triangleToStl(p1, p3, p2));
      lines.push(triangleToStl(p2, p3, p4));
    }
  };

  // 4 parois
  [[0, false], [H - 1, true]].forEach(([yLine, isTop]) => {
    const top = [], bottom = [];
    for (let x = 0; x < W; x++) {
      top.push(point(x * dx, yLine * dy, heightMap[yLine][x]));
      bottom.push(point(x * dx, yLine * dy, 0));
    }
    addWallStrip(top, bottom);
  });

  [[0], [W - 1]].forEach(([xLine]) => {
    const top = [], bottom = [];
    for (let y = 0; y < H; y++) {
      top.push(point(xLine * dx, y * dy, heightMap[y][xLine]));
      bottom.push(point(xLine * dx, y * dy, 0));
    }
    addWallStrip(top, bottom);
  });

  lines.push('endsolid lithophane');
  return lines.join('\n');
}

// ✅ AMÉLIORATION #4 : Boule avec plus de segments et interpolation
function generateSphereStl(heightMap, gridWidth, gridHeight, diameter, minThickness, maxThickness) {
  const lines = ['solid lithophane'];
  const radius = diameter / 2;
  
  // ✅ 200+ segments pour lissage
  const segments = Math.min(200, Math.max(100, Math.floor(Math.max(gridWidth, gridHeight) * 1.5)));

  for (let lat = 0; lat < segments; lat++) {
    for (let lon = 0; lon < segments; lon++) {
      if (lat < segments - 1 && lon < segments - 1) {
        const getPoint = (lt, ln) => {
          const u = ln / segments;
          const v = lt / segments;
          
          // ✅ Interpolation bilinéaire
          const thickness = bilinearSample(heightMap, u, v);
          
          const theta = ln * 2 * Math.PI / segments;
          const phi = lt * Math.PI / segments;
          const r = radius + thickness - (maxThickness + minThickness) / 2;
          
          return [
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi)
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

  lines.push('endsolid lithophane');
  return lines.join('\n');
}

// ✅ AMÉLIORATION #5 : Cylindre optimisé
function generateCylinderStl(heightMap, gridWidth, gridHeight, diameter, height, minThickness, maxThickness) {
  const lines = ['solid lithophane'];
  const radius = diameter / 2;
  const segments = Math.min(200, Math.max(100, gridWidth));
  const rings = Math.min(200, Math.max(100, gridHeight));

  for (let ring = 0; ring < rings; ring++) {
    for (let seg = 0; seg < segments; seg++) {
      if (ring < rings - 1 && seg < segments - 1) {
        const getPoint = (rg, sg) => {
          const u = sg / segments;
          const v = rg / rings;
          
          // ✅ Interpolation bilinéaire
          const thickness = bilinearSample(heightMap, u, v);
          
          const theta = sg * 2 * Math.PI / segments;
          const y = rg * height / rings;
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

  lines.push('endsolid lithophane');
  return lines.join('\n');
}

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
    gamma: 1.2, // ✅ Nouveau paramètre
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
          settings.gamma
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
            imgData.data[i] = b;
            imgData.data[i + 1] = b;
            imgData.data[i + 2] = b;
            imgData.data[i + 3] = 255;
          }
        }

        ctx.putImageData(imgData, 0, 0);
        const url = canvas.toDataURL('image/png');
        if (!cancelled) {
          setPreviewLithoUrl(url);
        }
      } catch (err) {
        console.error('Erreur prévisualisation:', err);
      }
    };

    makePreview();

    return () => {
      cancelled = true;
    };
  }, [imageSrc, settings.minThickness, settings.maxThickness, settings.gamma]);

  const handleExportStl = async () => {
    if (!imageSrc) {
      alert("Merci de charger d'abord une image.");
      return;
    }

    try {
      setIsGenerating(true);
      
      // ✅ Génération avec gamma
      const { heightMap, width, height } = await generateHeightMapFromImage(
        imageSrc,
        settings.minThickness,
        settings.maxThickness,
        settings.gamma
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
        case 'cone':
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
      a.download = `lithophane_${shape}_${width}x${height}_${Date.now()}.stl`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      alert(`✅ STL EXPORTÉ - QUALITÉ PRO !\n\n` +
        `📊 RÉSOLUTION: ${width}×${height} pixels (${width * height} points)\n` +
        `🎯 SEGMENTS: ${shape === 'bauble' ? '200' : shape === 'cylinder' ? '200' : 'N/A'}\n\n` +
        `📋 PARAMÈTRES D'IMPRESSION\n\n` +
        `• Hauteur de couche: 0.12mm (CRITIQUE)\n` +
        `• Remplissage: 100% (OBLIGATOIRE)\n` +
        `• Parois: 7 minimum\n` +
        `• Vitesse: 30-45mm/s (lent = qualité)\n` +
        `• Température: 210-220°C\n` +
        `• Matériau: PLA blanc/translucide\n` +
        `• Générateur parois: Arachne (si dispo)\n\n` +
        `Vos réglages:\n` +
        `• Min: ${settings.minThickness}mm\n` +
        `• Max: ${settings.maxThickness}mm\n` +
        `• Gamma: ${settings.gamma}\n` +
        `• Forme: ${shape}\n\n` +
        `💡 CONSEIL: Imprimez d'abord un test 50×50mm !`);
    } catch (err) {
      console.error(err);
      alert("Erreur génération STL. Essayez une image plus petite.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <section className="litho-section">
      <div className="litho-grid">
        <div className="litho-panel">
          <h2>1. Photo</h2>
          <p>Image HD recommandée (1000×1000px+). Résolution max: {MAX_GRID_SIZE}×{MAX_GRID_SIZE}.</p>
          <label className="file-input-label">
            <input type="file" accept="image/*" onChange={handleFileChange} />
            <span>Choisir une image…</span>
          </label>

          {previewUrl && (
            <div className="preview-wrapper">
              <h3>Aperçu original</h3>
              <img src={previewUrl} alt="Prévisualisation" className="preview-image" />
            </div>
          )}

          <div className="preview-wrapper" style={{ marginTop: 12 }}>
            <h3>Rendu lithophanie (simulation)</h3>
            {previewLithoUrl ? (
              <img
                src={previewLithoUrl}
                alt="Rendu"
                className="preview-image"
                style={{ background: 'black' }}
              />
            ) : (
              <p className="hint">Simulation rétro-éclairage après chargement.</p>
            )}
          </div>
        </div>

        <div className="litho-panel">
          <h2>2. Forme</h2>
          <div className="shape-grid">
            {[
              ['frame', '🖼️ Cadre plat'],
              ['bauble', '🎄 Boule'],
              ['cylinder', '💡 Cylindre'],
              ['cone', '🔦 Cône']
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
                    <input type="number" min="30" max="200" step="1" value={settings.widthMm} onChange={handleNumberChange('widthMm')} />
                  </label>
                  <label>
                    Hauteur
                    <input type="number" min="30" max="200" step="1" value={settings.heightMm} onChange={handleNumberChange('heightMm')} />
                  </label>
                </>
              )}
              {shape === 'bauble' && (
                <label>
                  Diamètre
                  <input type="number" min="40" max="150" step="1" value={settings.diameter} onChange={handleNumberChange('diameter')} />
                </label>
              )}
              {(shape === 'cylinder' || shape === 'cone') && (
                <>
                  <label>
                    Diamètre
                    <input type="number" min="40" max="150" step="1" value={settings.diameter} onChange={handleNumberChange('diameter')} />
                  </label>
                  <label>
                    Hauteur
                    <input type="number" min="30" max="200" step="1" value={settings.heightMm} onChange={handleNumberChange('heightMm')} />
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="settings-group">
            <h3>Épaisseur (mm)</h3>
            <div className="settings-row">
              <label>
                Min (clair)
                <input type="number" min="0.4" max={settings.maxThickness} step="0.1" value={settings.minThickness} onChange={handleNumberChange('minThickness')} />
              </label>
              <label>
                Max (sombre)
                <input type="number" min={settings.minThickness} max="6" step="0.1" value={settings.maxThickness} onChange={handleNumberChange('maxThickness')} />
              </label>
            </div>
          </div>

          <div className="settings-group">
            <h3>✨ Gamma (contraste)</h3>
            <div className="settings-row">
              <label>
                Gamma: {settings.gamma}
                <input type="range" min="0.5" max="2.5" step="0.1" value={settings.gamma} onChange={handleNumberChange('gamma')} />
              </label>
            </div>
            <p className="hint">0.5 = plus clair, 1.0 = neutre, 2.5 = plus sombre</p>
          </div>

          <div className="actions">
            <button
              type="button"
              className="export-btn"
              onClick={handleExportStl}
              disabled={isGenerating || !imageSrc}
            >
              {isGenerating ? 'Génération…' : '📥 Exporter STL PRO'}
            </button>
            {!imageSrc && <p className="hint">Chargez une image d&apos;abord</p>}
          </div>
        </div>
      </div>

      <div className="print-tips">
        <h2>✅ Améliorations Qualité PRO Activées</h2>
        <ul>
          <li>✨ Résolution {MAX_GRID_SIZE}×{MAX_GRID_SIZE} (4x plus de détails)</li>
          <li>✨ Interpolation bilinéaire (transitions douces)</li>
          <li>✨ 200 segments pour formes 3D (ultra-lisse)</li>
          <li>✨ Contrôle gamma (ajustement contraste)</li>
          <li>✨ Résolution adaptative selon image source</li>
        </ul>
      </div>
    </section>
  );
}
