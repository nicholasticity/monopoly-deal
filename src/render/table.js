// Static scenery: felt table, wooden rim, and lighting.
import * as THREE from 'three';

const TABLE_W = 50;
const TABLE_D = 36;
const TABLE_CZ = -6.5;

function feltTexture(renderer) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c6a43';
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i] += n * 0.6;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.7;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 4.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function vignetteTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 30, 128, 128, 180);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function woodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#5a3317';
  ctx.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 70; i++) {
    const y = Math.random() * 64;
    ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '30,14,4' : '120,72,36'},${0.15 + Math.random() * 0.25})`;
    ctx.lineWidth = 0.5 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.08, 0.08);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Wooden rim: an extruded rounded frame around a w × d felt.
function rimGeometry(w, d, rim) {
  const outer = new THREE.Shape();
  const ow = w / 2 + rim, od = d / 2 + rim, r = 2.2;
  outer.moveTo(-ow + r, -od);
  outer.lineTo(ow - r, -od);
  outer.quadraticCurveTo(ow, -od, ow, -od + r);
  outer.lineTo(ow, od - r);
  outer.quadraticCurveTo(ow, od, ow - r, od);
  outer.lineTo(-ow + r, od);
  outer.quadraticCurveTo(-ow, od, -ow, od - r);
  outer.lineTo(-ow, -od + r);
  outer.quadraticCurveTo(-ow, -od, -ow + r, -od);
  const hole = new THREE.Path();
  const iw = w / 2, id = d / 2;
  hole.moveTo(-iw, -id);
  hole.lineTo(-iw, id);
  hole.lineTo(iw, id);
  hole.lineTo(iw, -id);
  hole.lineTo(-iw, -id);
  outer.holes.push(hole);
  return new THREE.ExtrudeGeometry(outer, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 3 });
}

// Returns setSize(w, d, cz), which reshapes the table (felt w × d, centred on z = cz)
// for the current layout.
export function buildTable(scene, renderer) {
  const feltMap = feltTexture(renderer);
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: feltMap, roughness: 0.95 }));
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: vignetteTexture(), transparent: true, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.002;
  scene.add(glow);

  const rim = 1.6;
  const rimMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0.05 }));
  rimMesh.rotation.x = -Math.PI / 2;
  rimMesh.position.y = -0.35;
  rimMesh.castShadow = rimMesh.receiveShadow = true;
  scene.add(rimMesh);

  const base = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ color: 0x2b170a, roughness: 0.8 }));
  base.position.y = -1.36;
  scene.add(base);

  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x20301f, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.near = 5;
  sc.far = 80;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);

  let current = '';
  const setSize = (w, d, cz) => {
    const key = `${w}:${d}:${cz}`;
    if (key === current) return;
    current = key;
    felt.scale.set(w, d, 1);
    glow.scale.set(w, d, 1);
    felt.position.z = glow.position.z = rimMesh.position.z = base.position.z = cz;
    feltMap.repeat.set((6 * w) / TABLE_W, (4.5 * d) / TABLE_D);
    rimMesh.geometry.dispose();
    rimMesh.geometry = rimGeometry(w, d, rim);
    base.scale.set(w + rim * 2, 1, d + rim * 2);
    sun.position.set(-10, 34, cz + 20.5);
    sun.target.position.set(0, 0, cz + 1.5);
    sc.left = -(w / 2 + 5);
    sc.right = w / 2 + 5;
    sc.top = d / 2 + 8;
    sc.bottom = -(d / 2 + 8);
    sc.updateProjectionMatrix();
  };
  setSize(TABLE_W, TABLE_D, TABLE_CZ);
  return { setSize };
}
