import React, { useState, useEffect, useRef } from 'react';

// ========================================
// CONFIGURATION PRO
// ========================================

const RESOLUTION_CONFIG = {
  low: 400,
  medium: 600,
  high: 800,
  ultra: 1000
};

// ========================================
// INTERPOLATION BICUBIQUE
// ========================================

function cubicInterpolate(p0, p1, p2, p3, x) {
  return p1 + 0.5 * x * (p2 - p0 +
    x * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 +
    x * (3.0 * (p1 - p2) + p3 - p0)));
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
// ========================================

// CLAHE (Contrast Limited Adaptive Histogram Equalization)
function applyCLAHE(imageData, clipLimit = 2.0, tileSize = 16) {
  const width = imageData.width;
  const height = imageData.height;
  const result = new Uint8ClampedArray(imageData.data);
  
  const tilesX = Math.ceil(width / tileSize);
  const tilesY = Math.ceil(height / tileSize);
  
  // Calculer CDFs pour chaque tuile
  const cdfs = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const hist = new Array(256).fill(0);
      
      // Histogramme de la tuile
      for (let y = ty * tileSize; y < Math.min((ty + 1) * tileSize, height); y++) {
        for (let x = tx * tileSize; x < Math.min((tx + 1) * tileSize, width); x++) {
          const i = (y * width + x) * 4;
          const gray = Math.round((imageData.data[i] + imageData.data[i+1] + imageData.data[i+2]) / 3);
          hist[gray]++;
        }
      }
      
      // Appliquer clip limit
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
      
      // CDF
      const cdf = [hist[0]];
      for (let i = 1; i < 256; i++) {
        cdf[i] = cdf[i-1] + hist[i];
      }
      
      // Normaliser
      const cdfMin = cdf.find(v => v > 0) || 0;
      const cdfMax = cdf[255];
      const normCdf = cdf.map(v => ((v - cdfMin) / (cdfMax - cdfMin || 1)) * 255);
      
      cdfs.push(normCdf);
    }
  }
  
  // Appliquer avec interpolation bilinéaire entre tuiles
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const gray = Math.round((imageData.data[i] + imageData.data[i+1] + imageData.data[i+2]) / 3);
      
      const tx = x / tileSize;
      const ty = y / tileSize;
      const tx0 = Math.floor(tx), tx1 = Math.min(tilesX - 1, tx0 + 1);
      const ty0 = Math.floor(ty), ty1 = Math.min(tilesY - 1, ty0 + 1);
      const fx = tx - tx0, fy = ty - ty0;
      
      const v00 = cdfs[ty0 * tilesX + tx0][gray];
      const v10 = cdfs[ty0 * tilesX + tx1][gray];
      const v01 = cdfs[ty1 * tilesX + tx0][gra]()*]()

