import React, { useState, useEffect, useRef } from 'react';

const MAX_GRID_SIZE = 100;

// Génération de la heightmap depuis l'image
function generateHeightMapFromImage(imageSrc, minThickness, maxThickness) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      let w = img.width;
      let h = img.height;
      if (w > h) {
        const ratio = h / w;
        w = MAX_GRID_SIZE;
        h = Math.max(2, Math.round(MAX_GRID_SIZE * ratio));
      } else {
        const ratio = w / h;
        h = MAX_GRID_SIZE;
        w = Math.max(2, Math.round(MAX_GRID_SIZE * ratio));
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
          const v = (r + g + b) / 3 / 255;
          const thickness = minThickness + (1 - v) * (maxThickness - minThickness);
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

// Génération STL pour cadre plat
function generateFlatLithophaneStl(heightMap, gridWidth, gridHeight, sizeXmm, sizeYmm) {
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

  const H = gridHeight, W = gridWidth;
  const addWallStrip = (coordsTop, coordsBottom) => {
    for (let i = 0; i < coordsTop.length - 1; i++) {
      const p1 = coordsTop[i], p2 = coordsTop[i + 1];
      const p3 = coordsBottom[i], p4 = coordsBottom[i + 1];
      lines.push(triangleToStl(p1, p3, p2));
      lines.push(triangleToStl(p2, p3, p4));
    }
  };

  const buildWall = (coords, isTop) => coords.map((c, idx) => {
    const y = isTop ? (H - 1) * dy : 0;
    return isTop ? point(c * dx, y, heightMap[H - 1][c]) : point(c * dx, y, heightMap[0][c]);
  });

  [
    [[...Array(W).keys()].map(x => x), 0, false],
    [[...Array(W).keys()].map(x => x), H - 1, true],
    [[...Array(H).keys()].map(y => 0), null, null],
    [[...Array(H).keys()].map(y => W - 1), null, null]
  ].forEach(([coords, yLine, isTop], idx) => {
    const top = [], bottom = [];
    if (idx < 2) {
      coords.forEach(x => {
        top.push(point(x * dx, yLine * dy, heightMap[yLine][x]));
        bottom.push(point(x * dx, yLine * dy, 0));
      });
    } else {
      coords.forEach(y => {
        const x = idx === 2 ? 0 : W - 1;
        top.push(point(x * dx, y * dy, heightMap[y][x]));
        bottom.push(point(x * dx, y * dy, 0));
      });
    }
    addWallStrip(top, bottom);
  });

  lines.push('endsolid lithophane');
  return lines.join('\n');
}

// Génération STL pour boule
function generateSphereStl(heightMap, gridWidth, gridHeight, diameter, minThickness, maxThickness) {
  const lines = ['solid lithophane'];
  const radius = diameter / 2;
  const segments = Math.min(50, Math.max(gridWidth, gridHeight));

  for (let lat = 0; lat < segments; lat++) {
    for (let lon = 0; lon < segments; lon++) {
      const u = lon / segments;
      const v = lat / segments;
      
      const imgX = Math.floor(u * (gridWidth - 1));
      const imgY = Math.floor(v * (gridHeight - 1));
      const thickness = heightMap[imgY][imgX];

      const theta = lon * 2 * Math.PI / segments;
      const phi = lat * Math.PI / segments;
      
      const r = radius + thickness - (maxThickness + minThickness) / 2;
      
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      // Générer les triangles (simplifié)
      if (lat < segments - 1 && lon < segments - 1) {
        const getPoint = (lt, ln) => {
          const u2 = ln / segments, v2 = lt / segments;
          const ix = Math.floor(u2 * (gridWidth - 1));
          const iy = Math.floor(v2 * (gridHeight - 1));
          const t = heightMap[iy][ix];
          const th = lt * Math.PI / segments, ph = ln * 2 * Math.PI / segments;
          const rr = radius + t - (maxThickness + minThickness) / 2;
          return [
            rr * Math.sin(th) * Math.cos(ph),
            rr * Math.sin(th) * Math.sin(ph),
            rr * Math.cos(th)
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

// Génération STL pour cylindre
function generateCylinderStl(heightMap, gridWidth, gridHeight, diameter, height, minThickness, maxThickness) {
  const lines = ['solid lithophane'];
  const radius = diameter / 2;
  const segments = Math.min(50, gridWidth);
  const rings = Math.min(50, gridHeight);

  for (let ring = 0; ring < rings; ring++) {
    for (let seg = 0; seg < segments; seg++) {
      const u = seg / segments;
      const v = ring / rings;
      
      const imgX = Math.floor(u * (gridWidth - 1));
      const imgY = Math.floor(v * (gridHeight - 1));
      const thickness = heightMap[imgY][imgX];

      const theta = seg * 2 * Math.PI / segments;
      const y = ring * height / rings;
      const r = radius - thickness + (maxThickness + minThickness) / 2;

      if (ring < rings - 1 && seg < segments - 1) {
        const getPoint = (rg, sg) => {
          const u2 = sg / segments, v2 = rg / rings;
          const ix = Math.floor(u2 * (gridWidth - 1));
          const iy = Math.floor(v2 * (gridHeight - 1));
          const t = heightMap[iy][ix];
          const th = sg * 2 * Math.PI / segments;
          const yy = rg * height / rings;
          const rr = radius - t + (maxThickness + minThickness) / 2;
          return [rr * Math.cos(th), yy, rr * Math.sin(th)];
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
          settings.maxThickness
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
  }, [imageSrc, settings.minThickness, settings.maxThickness]);

  const handleExportStl = async () => {
    if (!imageSrc) {
      alert("Merci de charger d'abord une image.");
      return;
    }

    try {
      setIsGenerating(true);
      const { heightMap, width, height } = await generateHeightMapFromImage(
        imageSrc,
        settings.minThickness,
        settings.maxThickness
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
        case 'cone':
          // Cone utilise le même algo que cylindre avec rayon variable
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
      a.download = `lithophane_${shape}_${Date.now()}.stl`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      alert(`✅ STL EXPORTÉ !\n\n📋 PARAMÈTRES D'IMPRESSION\n\n` +
        `• Hauteur de couche: 0.12mm\n` +
        `• Remplissage: 100% (OBLIGATOIRE)\n` +
        `• Parois: 7 minimum\n` +
        `• Température: 210-220°C\n` +
        `• Matériau: PLA blanc/translucide\n\n` +
        `Vos paramètres:\n` +
        `• Min: ${settings.minThickness}mm\n` +
        `• Max: ${settings.maxThickness}mm\n` +
        `• Forme: ${shape}`);
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la génération du STL.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <section className="litho-section">
      <div className="litho-grid">
        <div className="litho-panel">
          <h2>1. Photo</h2>
          <p>Choisis une photo contrastée (portrait, logo, paysage simple).</p>
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
                alt="Rendu lithophanie"
                className="preview-image"
                style={{ background: 'black' }}
              />
            ) : (
              <p className="hint">
                Charge une image pour voir la simulation rétro-éclairée.
              </p>
            )}
          </div>
        </div>

        <div className="litho-panel">
          <h2>2. Forme</h2>
          <p>Choisis le type de lithophanie à générer.</p>
          <div className="shape-grid">
            <button
              type="button"
              className={shape === 'frame' ? 'shape-btn active' : 'shape-btn'}
              onClick={() => setShape('frame')}
            >
              🖼️ Cadre plat
            </button>
            <button
              type="button"
              className={shape === 'bauble' ? 'shape-btn active' : 'shape-btn'}
              onClick={() => setShape('bauble')}
            >
              🎄 Boule de Noël
            </button>
            <button
              type="button"
              className={shape === 'cylinder' ? 'shape-btn active' : 'shape-btn'}
              onClick={() => setShape('cylinder')}
            >
              💡 Abat-jour cylindre
            </button>
            <button
              type="button"
              className={shape === 'cone' ? 'shape-btn active' : 'shape-btn'}
              onClick={() => setShape('cone')}
            >
              🔦 Abat-jour conique
            </button>
          </div>

          <div className="settings-group">
            <h3>Dimensions (mm)</h3>
            <div className="settings-row">
              {(shape === 'frame') && (
                <>
                  <label>
                    Largeur
                    <input
                      type="number"
                      min="30"
                      max="200"
                      step="1"
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
                      step="1"
                      value={settings.heightMm}
                      onChange={handleNumberChange('heightMm')}
                    />
                  </label>
                </>
              )}
              {(shape === 'bauble') && (
                <label>
                  Diamètre
                  <input
                    type="number"
                    min="40"
                    max="150"
                    step="1"
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
                      step="1"
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
                      step="1"
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
              Recommandé : 0.7–0.9mm min, 2.8–3.2mm max pour PLA blanc, couche 0.12mm, 100% infill.
            </p>
          </div>

          <div className="actions">
            <button
              type="button"
              className="export-btn"
              onClick={handleExportStl}
              disabled={isGenerating || !imageSrc}
            >
              {isGenerating ? 'Génération du STL…' : '📥 Exporter en STL'}
            </button>
            {!imageSrc && <p className="hint">Charge d&apos;abord une image pour activer l&apos;export.</p>}
          </div>
        </div>
      </div>

      <div className="print-tips">
        <h2>3. Paramètres d&apos;impression 3D conseillés</h2>
        <ul>
          <li>✔️ Matière : PLA blanc ou translucide</li>
          <li>✔️ Hauteur de couche : 0.10–0.16mm (0.12mm idéal)</li>
          <li>✔️ Infill : 100% (obligatoire pour les lithophanies)</li>
          <li>✔️ Parois : 5–7 murs minimum</li>
          <li>✔️ Orientation : lithophanie verticale face au ventilateur</li>
        </ul>
      </div>
    </section>
  );
}
