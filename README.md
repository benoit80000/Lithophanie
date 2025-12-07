# Lithophane Maker Pro (version simplifiée)

Application Next.js permettant de créer une **lithophanie plate** à partir d'une photo et
d'exporter directement un fichier **STL** prêt pour le slicer (Cura, PrusaSlicer, Bambu Studio, etc.).

> Cette version génère un **cadre plat**. Les formes boule / abat‑jour sont présentes dans l'UI
> mais pour l'instant l'export STL reste une plaque plate (lithophanie classique).

## 🚀 Installation

```bash
npm install
npm run dev
```

Puis ouvre http://localhost:3000 dans ton navigateur.

## 🧱 Fonctionnement

1. Charge une image (portrait, logo, paysage simple).
2. Choisis la forme souhaitée (cadre / boule / abat‑jour).
3. Règle :
   - largeur & hauteur en mm
   - épaisseur min (zones claires)
   - épaisseur max (zones sombres)
4. Clique sur **Exporter en STL** :
   - un fichier `lithophane_<forme>.stl` est généré et téléchargé
   - tout est calculé **côté navigateur** (aucune donnée envoyée sur un serveur)

## 🖨️ Paramètres d'impression conseillés

- Matière : PLA blanc ou translucide
- Hauteur de couche : 0.10–0.16 mm (0.12 mm idéal)
- Infill : 100 %
- Parois : 5–7 murs
- Orientation : lithophanie **verticale** face au ventilateur

## ⚙️ Technique

- Next.js 14 (pages router)
- React 18
- Génération STL :
  - conversion de l'image en niveaux de gris
  - réduction à une grille max 100×100
  - création d'un maillage (triangles) avec :
    - surface supérieure (relief)
    - surface inférieure (z = 0)
    - parois tout autour

Tu peux maintenant pousser ce projet sur GitHub, le déployer sur Vercel
et l'améliorer (nouvelles formes, prévisualisation 3D avec Three.js, etc.).