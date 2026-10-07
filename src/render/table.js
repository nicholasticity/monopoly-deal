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

export function buildTable(scene, renderer) {
  const felt = new THREE.Mesh(
    new THREE.PlaneGeometry(TABLE_W, TABLE_D),
    new THREE.MeshStandardMaterial({ map: feltTexture(renderer), roughness: 0.95 }),
  );
  felt.rotation.x = -Math.PI / 2;
  felt.position.z = TABLE_CZ;
  felt.receiveShadow = true;
  scene.add(felt);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(TABLE_W, TABLE_D),
    new THREE.MeshBasicMaterial({ map: vignetteTexture(), transparent: true, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, 0.002, TABLE_CZ);
  scene.add(glow);

  // Wooden rim: an extruded rounded frame around the felt.
  const rim = 1.6;
  const outer = new THREE.Shape();
  const ow = TABLE_W / 2 + rim, od = TABLE_D / 2 + rim, r = 2.2;
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
  const iw = TABLE_W / 2, id = TABLE_D / 2;
  hole.moveTo(-iw, -id);
  hole.lineTo(-iw, id);
  hole.lineTo(iw, id);
  hole.lineTo(iw, -id);
  hole.lineTo(-iw, -id);
  outer.holes.push(hole);
  const rimGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 3 });
  const rimMesh = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0.05 }));
  rimMesh.rotation.x = -Math.PI / 2;
  rimMesh.position.set(0, -0.35, TABLE_CZ);
  rimMesh.castShadow = rimMesh.receiveShadow = true;
  scene.add(rimMesh);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_W + rim * 2, 2, TABLE_D + rim * 2),
    new THREE.MeshStandardMaterial({ color: 0x2b170a, roughness: 0.8 }),
  );
  base.position.set(0, -1.36, TABLE_CZ);
  scene.add(base);

  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x20301f, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(-10, 34, 14);
  sun.target.position.set(0, 0, -5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -30; sc.right = 30; sc.top = 26; sc.bottom = -26; sc.near = 5; sc.far = 80;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
}
