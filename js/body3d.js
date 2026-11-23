// Mannequin 3D stylisé construit à partir des mensurations (three.js, chargé à la demande).
// Tronc et membres sont des surfaces de révolution dont les rayons suivent les tours mesurés.
// En comparaison, l'ancien corps (vert translucide, à gauche) tourne à côté de l'actuel.

import { bodyDims } from './body.js';

let THREE = null;

/** Profil (rayon, hauteur) lissé → surface de révolution, aplatie en profondeur si `depth` < 1. */
function lathe(points, depth = 1, segments = 40) {
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y)));
  const geo = new THREE.LatheGeometry(curve.getPoints(48), segments);
  geo.scale(1, 1, depth);
  geo.computeVertexNormals();
  return geo;
}

/** Construit le mannequin (THREE.Group) ; origine au sol, entre les pieds. */
function buildBody(dims, material) {
  const g = new THREE.Group();
  const { y, torso, arm, leg, height: H } = dims;
  const add = (geo, x = 0, yy = 0, z = 0) => { const m = new THREE.Mesh(geo, material); m.position.set(x, yy, z); g.add(m); return m; };

  // Tronc : de l'entrejambe au cou.
  add(lathe([
    [torso.hips * 0.55, y.crotch - 0.01],
    [torso.hips * 0.92, y.crotch + 0.03 * H],
    [torso.hips, y.hips],
    [torso.waist, y.waist],
    [torso.chest, y.chest],
    [Math.max(torso.chest, torso.shoulders * 0.8), y.chest + 0.045 * H],
    [torso.shoulders * 0.86, y.shoulders - 0.02 * H],
    [torso.shoulders * 0.55, y.shoulders + 0.012 * H],
    [dims.neck * 1.1, y.neck],
  ], dims.depth));

  // Cou et tête.
  add(lathe([[dims.neck, y.neck - 0.02 * H], [dims.neck * 0.95, y.head - dims.head * 0.7]]));
  const head = add(new THREE.SphereGeometry(dims.head, 32, 24), 0, y.head, 0.004 * H);
  head.scale.set(0.82, 1.08, 0.95);

  // Jambes (écartées de la moitié de la largeur des hanches).
  const legX = torso.hips * 0.5;
  for (const side of [-1, 1]) {
    add(lathe([
      [leg.thigh * 0.95, y.crotch + 0.02 * H],
      [leg.thigh, y.thigh],
      [leg.knee, y.knee],
      [leg.calf, y.calf],
      [leg.ankle, y.ankle + 0.01 * H],
      [leg.ankle * 0.9, 0.012 * H],
    ]), side * legX, 0, 0);
    const foot = add(new THREE.SphereGeometry(leg.ankle * 1.3, 16, 12), side * legX, 0.015 * H, 0.03 * H);
    foot.scale.set(0.9, 0.45, 2.1);
  }

  // Bras : légèrement écartés du corps.
  const armX = torso.shoulders * 0.82;
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * armX, y.shoulders - 0.01 * H, 0);
    pivot.rotation.z = side * 0.1;
    const len = y.shoulders - y.wrist;
    const m = new THREE.Mesh(lathe([
      [arm.upper * 1.05, 0],
      [arm.upper, -0.2 * len],
      [arm.upper * 0.85, -0.45 * len],
      [arm.fore, -0.6 * len],
      [arm.wrist, -0.98 * len],
    ]), material);
    pivot.add(m);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(arm.wrist * 1.4, 16, 12), material);
    hand.position.y = -len - arm.wrist;
    hand.scale.set(0.7, 1.4, 1);
    pivot.add(hand);
    const deltoid = new THREE.Mesh(new THREE.SphereGeometry(arm.upper * 1.15, 20, 16), material);
    deltoid.position.y = -0.02 * H;
    pivot.add(deltoid);
    g.add(pivot);
  }
  return g;
}

/**
 * Crée la vue 3D dans `container`. Retourne { update(current, previous, profile), dispose() }.
 * `current` / `previous` : valeurs de mesures (objets { weight, waist, ... }), previous peut être null.
 */
export async function createBodyView(container) {
  THREE ??= await import('../vendor/three/three.module.js');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1b1f27, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.5, 2.5, 2.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa3e635, 1.2);
  rim.position.set(-2, 1.5, -2);
  scene.add(rim);

  const skin = new THREE.MeshStandardMaterial({ color: 0xc9d0da, roughness: 0.55, metalness: 0.05 });
  const ghost = new THREE.MeshStandardMaterial({ color: 0xa3e635, roughness: 0.6, transparent: true, opacity: 0.55 });
  const floorGeo = new THREE.CircleGeometry(0.42, 48);
  const floorMat = new THREE.MeshBasicMaterial({ color: 0x1b1f27 });
  const stage = new THREE.Group();
  scene.add(stage);

  let tables = [];  // un plateau tournant par mannequin
  let height = 1.75;
  let angle = 0.5, spinning = true, dragging = null, frame = 0;

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Recule la caméra pour que tout tienne en hauteur et en largeur (deux mannequins côte à côte).
    const halfH = height * 0.6, halfW = (tables.length > 1 ? 0.95 : 0.45) * (height / 1.75);
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const dist = Math.max(halfH / tan, halfW / (tan * camera.aspect));
    camera.position.set(0, height * 0.52, dist);
    camera.lookAt(0, height * 0.5, 0);
    camera.updateProjectionMatrix();
  }

  function render() {
    frame = 0;
    if (!container.isConnected) return;
    if (spinning && !dragging) angle += 0.006;
    for (const t of tables) t.rotation.y = angle;
    renderer.render(scene, camera);
    if (spinning || dragging) frame = requestAnimationFrame(render);
  }
  const kick = () => { if (!frame) frame = requestAnimationFrame(render); };

  const el = renderer.domElement;
  el.style.touchAction = 'pan-y';
  el.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, angle }; spinning = false; el.setPointerCapture(e.pointerId); kick(); });
  el.addEventListener('pointermove', (e) => { if (dragging) { angle = dragging.angle + (e.clientX - dragging.x) * 0.012; kick(); } });
  const stop = () => { dragging = null; };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('dblclick', () => { spinning = !spinning; kick(); });
  const ro = new ResizeObserver(() => { resize(); kick(); });
  ro.observe(container);

  return {
    update(current, previous, profile) {
      for (const t of tables) {
        stage.remove(t);
        t.traverse((o) => { if (o.geometry !== floorGeo) o.geometry?.dispose(); });
      }
      tables = [];
      const now = bodyDims(current, profile);
      height = now.height;
      const table = (dims, material, x) => {
        const t = new THREE.Group();
        t.position.x = x;
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        t.add(floor, buildBody(dims, material));
        stage.add(t);
        tables.push(t);
      };
      if (previous) {
        const gap = 0.5 * (height / 1.75);
        table(bodyDims(previous, profile), ghost, -gap);
        table(now, skin, gap);
      } else {
        table(now, skin, 0);
      }
      resize();
      kick();
    },
    setSpin(on) { spinning = on; kick(); },
    dispose() { cancelAnimationFrame(frame); ro.disconnect(); renderer.dispose(); el.remove(); },
  };
}
