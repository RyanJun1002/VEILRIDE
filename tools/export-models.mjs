import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XfT6WQAAAABJRU5ErkJggg==',
  'base64',
);

class FakeGradient {
  addColorStop() {}
}

class FakeCanvasContext {
  createLinearGradient() { return new FakeGradient(); }
  createRadialGradient() { return new FakeGradient(); }
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  arc() {}
  arcTo() {}
  stroke() {}
  fill() {}
  fillRect() {}
  strokeRect() {}
  fillText() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  scale() {}
  drawImage() {}
  putImageData() {}
  clearRect() {}
}

class FakeCanvas {
  constructor() {
    this.width = 1;
    this.height = 1;
    this.style = {};
  }

  getContext() { return new FakeCanvasContext(); }
  toDataURL() { return `data:image/png;base64,${transparentPng.toString('base64')}`; }
  toBlob(callback) { callback(new Blob([transparentPng], { type: 'image/png' })); }
}

class NodeFileReader {
  result = null;
  error = null;
  onload = null;
  onloadend = null;

  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((value) => {
      this.result = value;
      queueMicrotask(() => {
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    });
  }

  readAsDataURL(blob) {
    void blob.arrayBuffer().then((value) => {
      this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`;
      queueMicrotask(() => {
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    });
  }
}

Object.defineProperty(globalThis, 'navigator', {
  value: { deviceMemory: 8, hardwareConcurrency: 8 },
  configurable: true,
});
Object.defineProperty(globalThis, 'innerWidth', { value: 1920, configurable: true });
Object.defineProperty(globalThis, 'innerHeight', { value: 1080, configurable: true });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.document = { createElement: () => new FakeCanvas() };
globalThis.HTMLCanvasElement = FakeCanvas;
globalThis.FileReader = NodeFileReader;

const { createCar } = await import('../src/renderer.ts');
const { CAR_SPECS } = await import('../src/cars.ts');

const outputRoot = path.resolve('exports/mistline-model-pack');
const vehicleDir = path.join(outputRoot, 'vehicles');
const interiorDir = path.join(outputRoot, 'interiors');
const worldDir = path.join(outputRoot, 'world-props');
await rm(outputRoot, { recursive: true, force: true });
await Promise.all([vehicleDir, interiorDir, worldDir].map(directory => mkdir(directory, { recursive: true })));

const exporter = new GLTFExporter();
const manifest = {
  generatedAt: new Date().toISOString(),
  coordinateSystem: 'Y-up, -Z forward, meters',
  files: [],
};

function prepareForExport(root, prefix) {
  let groupIndex = 0;
  let meshIndex = 0;
  let materialIndex = 0;
  const materials = new Set();
  root.name = prefix;
  root.visible = true;
  root.traverse((object) => {
    object.visible = true;
    object.userData = {};
    if (!object.name) {
      object.name = object.isMesh
        ? `${prefix}_mesh_${String(++meshIndex).padStart(3, '0')}`
        : `${prefix}_group_${String(++groupIndex).padStart(3, '0')}`;
    }
    if (object.isMesh) {
      const materialList = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materialList) {
        if (!material || materials.has(material)) continue;
        materials.add(material);
        material.name ||= `${prefix}_material_${String(++materialIndex).padStart(3, '0')}`;
      }
    }
  });
  root.updateMatrixWorld(true);
  return root;
}

function validateGlb(buffer) {
  if (buffer.length < 20 || buffer.toString('utf8', 0, 4) !== 'glTF') throw new Error('Invalid GLB magic');
  if (buffer.readUInt32LE(4) !== 2) throw new Error('GLB is not version 2');
  if (buffer.readUInt32LE(8) !== buffer.length) throw new Error('GLB byte length mismatch');
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.toString('utf8', 16, 20);
  if (jsonType !== 'JSON') throw new Error('GLB JSON chunk missing');
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim());
  const binaryHeader = 20 + jsonLength;
  if (binaryHeader + 8 > buffer.length) throw new Error('GLB binary chunk missing');
  const binaryLength = buffer.readUInt32LE(binaryHeader);
  const binaryType = buffer.readUInt32LE(binaryHeader + 4);
  if (binaryType !== 0x004e4942) throw new Error('GLB BIN chunk type is invalid');
  if (binaryHeader + 8 + binaryLength > buffer.length) throw new Error('GLB BIN chunk is truncated');
  for (const view of json.bufferViews ?? []) {
    const end = (view.byteOffset ?? 0) + view.byteLength;
    if (end > binaryLength) throw new Error('GLB bufferView exceeds BIN chunk');
  }
  for (const accessor of json.accessors ?? []) {
    if (accessor.bufferView != null && accessor.bufferView >= (json.bufferViews?.length ?? 0)) {
      throw new Error('GLB accessor references a missing bufferView');
    }
  }
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessorIndices = [...Object.values(primitive.attributes ?? {})];
      if (primitive.indices != null) accessorIndices.push(primitive.indices);
      if (accessorIndices.some(index => index >= (json.accessors?.length ?? 0))) {
        throw new Error('GLB mesh references a missing accessor');
      }
    }
  }
}

async function exportGlb(object, relativePath, label) {
  const prepared = prepareForExport(object, label);
  const result = await exporter.parseAsync(prepared, {
    binary: true,
    onlyVisible: false,
    trs: true,
    maxTextureSize: 1024,
  });
  const buffer = Buffer.from(result);
  validateGlb(buffer);
  const destination = path.join(outputRoot, relativePath);
  await writeFile(destination, buffer);
  const bounds = new THREE.Box3().setFromObject(prepared);
  const size = bounds.getSize(new THREE.Vector3());
  manifest.files.push({
    path: relativePath.replaceAll('\\', '/'),
    label,
    bytes: buffer.length,
    sizeMeters: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
  });
}

const vehicleColors = {
  'mist-gt': 0xe95a35,
  'apex-r': 0xd9e2de,
  'ridge-x': 0xe5ad35,
  'touring-s': 0x365f4b,
  'trail-pickup': 0x674d79,
  'metro-bus': 0xe95a35,
  'storm-moto': 0x17242b,
};

const interiors = new Map();
for (const model of Object.keys(CAR_SPECS)) {
  const customization = {
    model,
    color: vehicleColors[model],
    wheelColor: 0x4c5957,
    spoiler: true,
  };
  const vehicle = createCar(customization.color, true, customization);
  const cockpit = vehicle.userData.cockpit;
  if (cockpit) {
    const interiorName = model === 'metro-bus'
      ? 'metro-bus-cockpit'
      : model === 'storm-moto'
        ? 'storm-moto-cockpit'
        : 'standard-car-cockpit';
    if (!interiors.has(interiorName)) interiors.set(interiorName, cockpit.clone(true));
  }
  await exportGlb(vehicle, `vehicles/${model}.glb`, model);
}

for (const [name, interior] of interiors) {
  await exportGlb(interior, `interiors/${name}.glb`, name);
}

function createTrafficCar() {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0x4f7890, roughness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x35575c, roughness: 0.2 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x090b0a, roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.58, 3.9), paint);
  body.position.y = 0.53;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.58, 1.72), glass);
  cabin.position.set(0, 1.04, 0.08);
  group.add(body, cabin);
  for (const x of [-0.98, 0.98]) {
    for (const z of [-1.28, 1.28]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.24, 12), rubber);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.39, z);
      group.add(wheel);
    }
  }
  return group;
}

function createPineTree() {
  const group = new THREE.Group();
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x493828, roughness: 0.96 });
  const crownColors = [0x263c30, 0x314936, 0x3c503a];
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.34, 2.8, 9), trunkMaterial);
  trunk.position.y = 1.32;
  group.add(trunk);
  const layers = [
    { y: 2.55, radius: 1.48, height: 2.25 },
    { y: 3.55, radius: 1.14, height: 2.05 },
    { y: 4.45, radius: 0.78, height: 1.72 },
  ];
  layers.forEach((layer, index) => {
    const material = new THREE.MeshStandardMaterial({ color: crownColors[index], roughness: 0.9, flatShading: true });
    const crown = new THREE.Mesh(new THREE.ConeGeometry(layer.radius, layer.height, 11, 2), material);
    crown.position.y = layer.y;
    crown.rotation.y = index * 0.34;
    group.add(crown);
  });
  return group;
}

function createRockCluster() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x697067, roughness: 0.94, flatShading: true });
  const main = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), material);
  main.position.y = 0.34;
  main.scale.set(1, 0.58, 0.82);
  main.rotation.set(0.18, 0.6, 0.12);
  const small = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), material);
  small.position.set(0.8, 0.18, 0.35);
  small.scale.set(0.52, 0.35, 0.43);
  small.rotation.set(0.1, 1.2, 0.18);
  group.add(main, small);
  return group;
}

function createShrub() {
  const shrub = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 1),
    new THREE.MeshStandardMaterial({ color: 0x314936, roughness: 1, flatShading: true }),
  );
  shrub.position.y = 0.32;
  shrub.scale.set(1.25, 0.7, 1);
  return shrub;
}

function createReflectorPost() {
  const group = new THREE.Group();
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.9, 0.13),
    new THREE.MeshStandardMaterial({ color: 0x9b9277, roughness: 0.72 }),
  );
  post.position.y = 0.45;
  const reflector = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.16, 0.07),
    new THREE.MeshStandardMaterial({ color: 0xffd8a0, emissive: 0xff6b24, emissiveIntensity: 1.8 }),
  );
  reflector.position.set(0, 0.72, -0.08);
  group.add(post, reflector);
  return group;
}

function createMountain() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x526457, roughness: 1, flatShading: true });
  const peaks = [
    { x: -1.7, y: 2.4, scale: [3.4, 4.8, 2.8] },
    { x: 1.1, y: 2.9, scale: [4.1, 5.8, 3.5] },
    { x: 4.1, y: 1.9, scale: [2.8, 3.8, 2.4] },
  ];
  for (const peak of peaks) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 12, 3), material);
    mesh.position.set(peak.x, peak.y, 0);
    mesh.scale.set(...peak.scale);
    mesh.rotation.y = peak.x * 0.17;
    group.add(mesh);
  }
  return group;
}

await exportGlb(createTrafficCar(), 'world-props/npc-traffic-car.glb', 'npc-traffic-car');
await exportGlb(createPineTree(), 'world-props/pine-tree.glb', 'pine-tree');
await exportGlb(createRockCluster(), 'world-props/rock-cluster.glb', 'rock-cluster');
await exportGlb(createShrub(), 'world-props/shrub.glb', 'shrub');
await exportGlb(createReflectorPost(), 'world-props/reflector-post.glb', 'reflector-post');
await exportGlb(createMountain(), 'world-props/mountain-cluster.glb', 'mountain-cluster');

const readme = `# MISTLINE Model Pack

Blender에서 \`File > Import > glTF 2.0 (.glb/.gltf)\`로 불러오세요.

## 폴더

- \`vehicles/\`: 플레이 가능한 탈것 7종(내부 모델 포함)
- \`interiors/\`: 승용차, 메트로 버스, 오토바이 콕핏 분리본
- \`world-props/\`: NPC 차량, 나무, 바위, 관목, 산, 도로 반사판

## 규격

- 단위: 미터
- 위쪽: +Y
- 차량 전방: -Z
- 각 파일의 루트 피벗: 월드 원점
- 재질과 계층 이름은 Blender 편집을 위해 자동 정리됨

## 참고

원본 게임 모델은 Three.js 코드로 생성되므로 이 GLB 파일들이 Blender 편집용 변환본입니다.
계기판, 번호판, 버스 노선판의 런타임 캔버스 텍스처는 편집팩에서 빈 자리표시자 텍스처로 변환됩니다.
`;

await writeFile(path.join(outputRoot, 'README.md'), readme, 'utf8');
await writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Exported ${manifest.files.length} GLB files to ${outputRoot}`);
