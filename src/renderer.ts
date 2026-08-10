import * as THREE from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrafficState, VehicleState } from './simulation';
import { roadCenter, roadTangent } from './simulation';
import { DEFAULT_CUSTOMIZATION, type CarCustomization, type CarModelId } from './cars';
import type { NetworkPlayerState } from './multiplayer';

const ROAD_WIDTH = 8.4;
const CHUNK_LENGTH = 140;
const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
const cpuCores = navigator.hardwareConcurrency ?? 8;
const mobileDevice = matchMedia('(pointer: coarse)').matches || innerWidth <= 820;
const LOW_POWER_MODE = mobileDevice || deviceMemory <= 4 || cpuCores <= 4;
const VERY_LOW_END = deviceMemory <= 3 || cpuCores <= 2;
const CHUNK_COUNT = LOW_POWER_MODE ? (VERY_LOW_END ? 6 : 8) : 13;
const TRAFFIC_RENDER_LIMIT = LOW_POWER_MODE ? (VERY_LOW_END ? 10 : 16) : Number.POSITIVE_INFINITY;
const LOW_RENDER_SCALE = VERY_LOW_END ? 0.9 : 1;
const LOW_POWER_PIXEL_RATIO = VERY_LOW_END
  ? Math.min(devicePixelRatio, 1.15)
  : Math.min(devicePixelRatio, 1.5);
const VEHICLE_CURVE_SEGMENTS = LOW_POWER_MODE ? 10 : 24;
const VEHICLE_BEVEL_SEGMENTS = LOW_POWER_MODE ? 2 : 5;
const VEHICLE_WHEEL_SEGMENTS = LOW_POWER_MODE ? 28 : 48;
const VEHICLE_RIM_SEGMENTS = LOW_POWER_MODE ? 24 : 40;

export type WorldMapId = 'mountain' | 'city' | 'desert';

type WorldPalette = {
  ground: number[];
  shoulder: number;
  leaves: number[];
  hills: number[];
  rock: number;
};

const WORLD_MAP_PALETTES: Record<Exclude<WorldMapId, 'mountain'>, WorldPalette> = {
  city: {
    ground: [0x4f5754, 0x555e5b],
    shoulder: 0x8b9290,
    leaves: [0x315844, 0x3f6b50, 0x55795b],
    hills: [0x53605f, 0x667170],
    rock: 0x6d7473,
  },
  desert: {
    ground: [0xb78d57, 0xc59b61],
    shoulder: 0xd1ae78,
    leaves: [0x53613d, 0x68754a, 0x7d8553],
    hills: [0x9f6341, 0xb6784d],
    rock: 0x8d6449,
  },
};

const WORLD_MAP_ATMOSPHERE: Record<WorldMapId, { sky: number; fog: number; blend: number; fogMultiplier: number }> = {
  mountain: { sky: 0x9db4a5, fog: 0x9eb1a4, blend: 0, fogMultiplier: 1 },
  city: { sky: 0x9eafb2, fog: 0x929f9e, blend: 0.32, fogMultiplier: 0.82 },
  desert: { sky: 0xd9b77f, fog: 0xc9a06d, blend: 0.46, fogMultiplier: 0.68 },
};

function worldMaterial(parameters: THREE.MeshStandardMaterialParameters) {
  if (!LOW_POWER_MODE) return new THREE.MeshStandardMaterial(parameters);
  return new THREE.MeshLambertMaterial({
    color: parameters.color,
    map: parameters.map,
    normalMap: parameters.normalMap,
    normalScale: parameters.normalScale,
    emissive: parameters.emissive,
    emissiveIntensity: parameters.emissiveIntensity,
    flatShading: parameters.flatShading,
    transparent: parameters.transparent,
    opacity: parameters.opacity,
    side: parameters.side,
    depthWrite: parameters.depthWrite,
  });
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedBox(width: number, height: number, depth: number, radius: number, material: THREE.Material) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -depth / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + depth - radius);
  shape.quadraticCurveTo(x + width, y + depth, x + width - radius, y + depth);
  shape.lineTo(x + radius, y + depth);
  shape.quadraticCurveTo(x, y + depth, x, y + depth - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  const bevel = Math.min(0.075, radius * 0.48, height * 0.22);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: VEHICLE_BEVEL_SEGMENTS,
    curveSegments: VEHICLE_CURVE_SEGMENTS,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, height / 2, 0);
  toCreasedNormals(geometry, Math.PI / 3);
  return new THREE.Mesh(geometry, material);
}

function createRoundedTyre(radius: number, width: number, material: THREE.Material) {
  const tyre = new THREE.Group();
  const shoulder = Math.min(radius * 0.2, width * 0.36);
  const tread = new THREE.Mesh(
    new THREE.TorusGeometry(radius - shoulder, shoulder, LOW_POWER_MODE ? 8 : 12, VEHICLE_WHEEL_SEGMENTS),
    material,
  );
  tread.rotation.y = Math.PI / 2;
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(
      radius - shoulder * 0.72,
      radius - shoulder * 0.72,
      width * 0.82,
      VEHICLE_WHEEL_SEGMENTS,
      1,
      true,
    ),
    material,
  );
  barrel.rotation.z = Math.PI / 2;
  tyre.add(tread, barrel);
  return tyre;
}

function canvasRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawGaugeDial(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  value: number,
  maxValue: number,
  unit: string,
  numberScale: number,
) {
  const startAngle = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const ratio = THREE.MathUtils.clamp(value / maxValue, 0, 1);

  context.save();
  context.lineCap = 'round';
  const rim = context.createRadialGradient(centerX, centerY, radius * 0.58, centerX, centerY, radius);
  rim.addColorStop(0, '#101917');
  rim.addColorStop(0.74, '#07100f');
  rim.addColorStop(1, '#2c3835');
  context.fillStyle = rim;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = '#33413e';
  context.lineWidth = 7;
  context.beginPath();
  context.arc(centerX, centerY, radius - 7, startAngle, startAngle + sweep);
  context.stroke();

  const activeGradient = context.createLinearGradient(centerX - radius, centerY, centerX + radius, centerY);
  activeGradient.addColorStop(0, '#55c9ac');
  activeGradient.addColorStop(0.72, '#b6ffea');
  activeGradient.addColorStop(1, '#ff7047');
  context.strokeStyle = activeGradient;
  context.shadowColor = '#55e4bd';
  context.shadowBlur = 14;
  context.lineWidth = 8;
  context.beginPath();
  context.arc(centerX, centerY, radius - 7, startAngle, startAngle + sweep * ratio);
  context.stroke();
  context.shadowBlur = 0;

  for (let i = 0; i <= 50; i++) {
    const angle = startAngle + sweep * (i / 50);
    const major = i % 5 === 0;
    const outer = radius - 16;
    const inner = outer - (major ? 22 : 11);
    context.strokeStyle = major ? '#d7e5e0' : '#5c6c67';
    context.lineWidth = major ? 3 : 1.5;
    context.beginPath();
    context.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
    context.lineTo(centerX + Math.cos(angle) * outer, centerY + Math.sin(angle) * outer);
    context.stroke();
  }

  context.fillStyle = '#aabbb5';
  context.font = '600 23px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (let i = 0; i <= 10; i++) {
    const angle = startAngle + sweep * (i / 10);
    const labelRadius = radius - 49;
    context.fillText(
      Math.round((maxValue / numberScale) * (i / 10)).toString(),
      centerX + Math.cos(angle) * labelRadius,
      centerY + Math.sin(angle) * labelRadius,
    );
  }

  const needleAngle = startAngle + sweep * ratio;
  context.save();
  context.translate(centerX, centerY);
  context.rotate(needleAngle + Math.PI / 2);
  const needleGradient = context.createLinearGradient(0, -radius * 0.68, 0, 12);
  needleGradient.addColorStop(0, '#ffd4bd');
  needleGradient.addColorStop(0.28, '#ff7047');
  needleGradient.addColorStop(1, '#8f2416');
  context.fillStyle = needleGradient;
  context.shadowColor = '#ff5128';
  context.shadowBlur = 9;
  context.beginPath();
  context.moveTo(-5, 10);
  context.lineTo(-2.5, -radius * 0.68);
  context.lineTo(2.5, -radius * 0.68);
  context.lineTo(5, 10);
  context.closePath();
  context.fill();
  context.restore();

  context.shadowBlur = 0;
  const hub = context.createRadialGradient(centerX - 4, centerY - 5, 2, centerX, centerY, 17);
  hub.addColorStop(0, '#a8b5b0');
  hub.addColorStop(0.35, '#46514e');
  hub.addColorStop(1, '#111817');
  context.fillStyle = hub;
  context.beginPath();
  context.arc(centerX, centerY, 17, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = '#6f817b';
  context.font = '700 18px Arial';
  context.fillText(unit, centerX, centerY + 67);
  context.restore();
}

function drawCockpitCluster(
  context: CanvasRenderingContext2D,
  kmh: number,
  rpm: number,
  gear: string,
  distance: number,
) {
  const background = context.createLinearGradient(0, 0, 0, 416);
  background.addColorStop(0, '#111a18');
  background.addColorStop(0.5, '#050a09');
  background.addColorStop(1, '#0b1211');
  context.fillStyle = background;
  context.fillRect(0, 0, 1024, 416);

  drawGaugeDial(context, 225, 210, 174, kmh, 300, 'KM/H', 1);
  drawGaugeDial(context, 799, 210, 174, rpm, 8000, 'RPM ×1000', 1000);

  canvasRoundRect(context, 421, 82, 182, 244, 20);
  const screen = context.createLinearGradient(421, 82, 603, 326);
  screen.addColorStop(0, '#10221e');
  screen.addColorStop(1, '#06100e');
  context.fillStyle = screen;
  context.fill();
  context.strokeStyle = '#354b45';
  context.lineWidth = 3;
  context.stroke();

  context.textAlign = 'center';
  context.fillStyle = '#71857e';
  context.font = '700 18px Arial';
  context.fillText('MISTLINE', 512, 112);
  context.fillStyle = '#ff7248';
  context.font = '800 72px Arial';
  context.fillText(gear, 512, 191);
  context.fillStyle = '#d6fff2';
  context.font = '700 39px Arial';
  context.fillText(kmh.toString().padStart(3, '0'), 512, 244);
  context.fillStyle = '#759087';
  context.font = '600 15px Arial';
  context.fillText('KM/H', 512, 267);
  context.strokeStyle = '#263d37';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(442, 284);
  context.lineTo(582, 284);
  context.stroke();
  context.fillStyle = '#91aaa2';
  context.font = '600 15px Arial';
  context.fillText(`${(distance / 1000).toFixed(1)} KM`, 512, 309);

  context.textAlign = 'left';
  context.font = '700 15px Arial';
  context.fillStyle = '#55ddb8';
  context.fillText('◀', 429, 57);
  context.textAlign = 'right';
  context.fillText('▶', 595, 57);
  context.textAlign = 'center';
  context.fillStyle = '#d9a348';
  context.fillText('●', 489, 57);
  context.fillStyle = '#7e918b';
  context.fillText('ABS  ESC', 540, 57);
}

function createDShapeRimGeometry(outerRadius: number, rimWidth: number) {
  const innerRadius = outerRadius - rimWidth;
  const startAngle = -Math.PI / 4;
  const sweep = Math.PI * 1.5;
  const segments = 56;
  const shape = new THREE.Shape();

  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + sweep * (i / segments);
    const x = Math.cos(angle) * outerRadius;
    const y = Math.sin(angle) * outerRadius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const hole = new THREE.Path();
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + sweep * (1 - i / segments);
    const x = Math.cos(angle) * innerRadius;
    const y = Math.sin(angle) * innerRadius;
    if (i === 0) hole.moveTo(x, y);
    else hole.lineTo(x, y);
  }
  hole.closePath();
  shape.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.035,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.0045,
    bevelThickness: 0.0045,
    curveSegments: 6,
  });
  geometry.translate(0, 0, -0.0175);
  geometry.computeVertexNormals();
  return geometry;
}

function createGlassPanel(points: Array<[number, number, number]>, material: THREE.Material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function createCockpit() {
  const cockpit = new THREE.Group();
  const matte = new THREE.MeshStandardMaterial({ color: 0x252b29, roughness: 0.82, metalness: 0.08 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x3c4542, roughness: 0.42, metalness: 0.48 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x282e2c, roughness: 0.94 });
  const wheelLeather = new THREE.MeshPhysicalMaterial({ color: 0x202826, roughness: 0.58, metalness: 0.08, clearcoat: 0.32, clearcoatRoughness: 0.52 });
  const carbon = new THREE.MeshPhysicalMaterial({ color: 0x35413e, roughness: 0.3, metalness: 0.72, clearcoat: 0.58, clearcoatRoughness: 0.25 });
  const brushedMetal = new THREE.MeshStandardMaterial({ color: 0x9ba9a5, roughness: 0.25, metalness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff6338, emissive: 0x7e1e0c, emissiveIntensity: 0.65, roughness: 0.35 });

  const dashboard = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.24, 0.48), matte);
  dashboard.position.set(0, 0.78, -0.55);
  cockpit.add(dashboard);

  const cluster = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.25, 0.06), trim);
  cluster.position.set(-0.38, 0.9, -0.275);
  cockpit.add(cluster);

  const clusterCanvas = document.createElement('canvas');
  clusterCanvas.width = 1024;
  clusterCanvas.height = 416;
  const clusterContext = clusterCanvas.getContext('2d')!;
  const clusterTexture = new THREE.CanvasTexture(clusterCanvas);
  clusterTexture.colorSpace = THREE.SRGBColorSpace;
  clusterTexture.anisotropy = 8;
  const clusterDisplay = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.25),
    new THREE.MeshBasicMaterial({ map: clusterTexture, toneMapped: false }),
  );
  clusterDisplay.position.set(-0.38, 0.9, -0.225);
  cockpit.add(clusterDisplay);

  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(-0.39, 0.83, -0.22);
  steeringWheel.rotation.x = 0.22;
  const wheelRim = new THREE.Mesh(createDShapeRimGeometry(0.153, 0.023), wheelLeather);
  wheelRim.castShadow = true;
  steeringWheel.add(wheelRim);

  for (const side of [-1, 1]) {
    const horizontalSpoke = new THREE.Mesh(new THREE.BoxGeometry(0.102, 0.038, 0.027), carbon);
    horizontalSpoke.position.set(side * 0.078, -0.004, 0.002);
    horizontalSpoke.rotation.z = side * -0.13;
    steeringWheel.add(horizontalSpoke);

    const thumbGrip = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 10), wheelLeather);
    thumbGrip.position.set(side * 0.132, 0.018, 0.005);
    thumbGrip.scale.set(0.85, 1.65, 0.9);
    steeringWheel.add(thumbGrip);

    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.082, 0.012), brushedMetal);
    paddle.position.set(side * 0.105, 0.022, -0.034);
    paddle.rotation.z = side * -0.1;
    steeringWheel.add(paddle);

    for (let buttonIndex = 0; buttonIndex < 3; buttonIndex++) {
      const button = new THREE.Mesh(
        new THREE.CylinderGeometry(0.007, 0.007, 0.008, 12),
        buttonIndex === 0 ? accent : brushedMetal,
      );
      button.rotation.x = Math.PI / 2;
      button.position.set(side * (0.067 + buttonIndex * 0.015), 0.013, 0.023);
      steeringWheel.add(button);
    }
  }

  const lowerSpoke = new THREE.Mesh(new THREE.BoxGeometry(0.043, 0.097, 0.028), carbon);
  lowerSpoke.position.set(0, -0.07, 0.002);
  steeringWheel.add(lowerSpoke);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.061, 0.067, 0.052, 24), carbon);
  hub.rotation.x = Math.PI / 2;
  steeringWheel.add(hub);

  const badgeCanvas = document.createElement('canvas');
  badgeCanvas.width = 128;
  badgeCanvas.height = 128;
  const badgeContext = badgeCanvas.getContext('2d')!;
  const badgeGradient = badgeContext.createRadialGradient(45, 36, 4, 64, 64, 60);
  badgeGradient.addColorStop(0, '#d3ded9');
  badgeGradient.addColorStop(0.4, '#64736f');
  badgeGradient.addColorStop(1, '#16201e');
  badgeContext.fillStyle = badgeGradient;
  badgeContext.fillRect(0, 0, 128, 128);
  badgeContext.fillStyle = '#ff6a3d';
  badgeContext.font = '900 70px Arial';
  badgeContext.textAlign = 'center';
  badgeContext.textBaseline = 'middle';
  badgeContext.fillText('V', 64, 69);
  const badgeTexture = new THREE.CanvasTexture(badgeCanvas);
  badgeTexture.colorSpace = THREE.SRGBColorSpace;
  const badge = new THREE.Mesh(
    new THREE.CircleGeometry(0.032, 24),
    new THREE.MeshBasicMaterial({ map: badgeTexture, toneMapped: false }),
  );
  badge.position.z = 0.032;
  steeringWheel.add(badge);

  const centerStripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.025, 0.008), accent);
  centerStripe.position.set(0, 0.151, 0.021);
  steeringWheel.add(centerStripe);

  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.36, 12), trim);
  column.rotation.x = Math.PI / 2;
  column.position.set(-0.39, 0.83, -0.39);
  cockpit.add(steeringWheel, column);

  const floor = roundedBox(2.12, 0.12, 4.1, 0.08, leather);
  floor.position.set(0, 0.22, -0.52);
  const frontBulkhead = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.46, 0.12), matte);
  frontBulkhead.position.set(0, 0.45, -0.77);
  const centerTunnel = roundedBox(0.3, 0.2, 1.45, 0.08, carbon);
  centerTunnel.position.set(0.18, 0.35, 0.22);
  const driverSeatBase = roundedBox(0.58, 0.2, 0.72, 0.12, leather);
  driverSeatBase.position.set(-0.39, 0.38, 0.68);
  const passengerSeatBase = driverSeatBase.clone();
  passengerSeatBase.position.x = 0.42;
  cockpit.add(floor, frontBulkhead, centerTunnel, driverSeatBase, passengerSeatBase);

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.72, 0.065), matte);
    pillar.position.set(side * 0.81, 1.18, -0.43);
    pillar.rotation.x = 0.34;
    cockpit.add(pillar);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.38, 1.08), leather);
    door.position.set(side * 0.82, 0.79, 0.15);
    cockpit.add(door);
  }
  const windshieldTop = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.045, 0.07), matte);
  windshieldTop.position.set(0, 1.48, -0.4);
  const windshield = new THREE.Mesh(
    new THREE.PlaneGeometry(1.48, 0.64),
    new THREE.MeshPhysicalMaterial({
      color: 0xa9c6c4,
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  windshield.position.set(0, 1.19, -0.43);
  windshield.rotation.x = 0.16;

  const roofLiner = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.055, 1.25), leather);
  roofLiner.position.set(0, 1.53, 0.16);
  const roofConsole = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 0.26), trim);
  roofConsole.position.set(0, 1.49, -0.05);
  for (const side of [-1, 1]) {
    const roofRail = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.065, 1.18), matte);
    roofRail.position.set(side * 0.77, 1.46, 0.15);
    cockpit.add(roofRail);
    const rearPillar = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.62, 0.08), matte);
    rearPillar.position.set(side * 0.78, 1.18, 0.63);
    rearPillar.rotation.x = -0.12;
    cockpit.add(rearPillar);
  }
  const mirrorMaterial = new THREE.MeshStandardMaterial({ color: 0x667775, roughness: 0.16, metalness: 0.82 });
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.045), mirrorMaterial);
  mirror.position.set(0.08, 1.36, -0.62);
  const mirrorStem = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.16, 0.025), trim);
  mirrorStem.position.set(0.08, 1.44, -0.6);
  cockpit.add(windshieldTop, windshield, roofLiner, roofConsole, mirror, mirrorStem);
  const cockpitLight = new THREE.PointLight(0xbfe8dc, 1.15, 3.2, 1.7);
  cockpitLight.position.set(-0.2, 1.28, 0.45);
  cockpit.add(cockpitLight);

  cockpit.userData.steeringWheel = steeringWheel;
  cockpit.userData.clusterContext = clusterContext;
  cockpit.userData.clusterTexture = clusterTexture;
  cockpit.visible = false;
  return cockpit;
}

function createPickupCockpit() {
  const cockpit = new THREE.Group();
  const dash = new THREE.MeshStandardMaterial({ color: 0x202725, roughness: 0.86, metalness: 0.06 });
  const dashTop = new THREE.MeshStandardMaterial({ color: 0x3d4844, roughness: 0.7, metalness: 0.14 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x171d1b, roughness: 0.94 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x77817d, roughness: 0.34, metalness: 0.72 });
  const rubber = new THREE.MeshPhysicalMaterial({ color: 0x1c2421, roughness: 0.62, clearcoat: 0.22 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff673e, emissive: 0x7d1d0c, emissiveIntensity: 0.62 });
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: 0x183c38,
    emissive: 0x2a8174,
    emissiveIntensity: 0.3,
    roughness: 0.3,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xa7c8c6,
    transparent: true,
    opacity: 0.09,
    roughness: 0.035,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const upperDash = roundedBox(1.94, 0.15, 0.5, 0.055, dashTop);
  upperDash.position.set(0, 0.61, -0.54);
  const lowerDash = roundedBox(1.9, 0.31, 0.28, 0.045, dash);
  lowerDash.position.set(0, 0.41, -0.47);
  cockpit.add(upperDash, lowerDash);

  const clusterCanvas = document.createElement('canvas');
  clusterCanvas.width = 1024;
  clusterCanvas.height = 416;
  const clusterContext = clusterCanvas.getContext('2d')!;
  const clusterTexture = new THREE.CanvasTexture(clusterCanvas);
  clusterTexture.colorSpace = THREE.SRGBColorSpace;
  clusterTexture.anisotropy = 8;
  const clusterHood = roundedBox(0.62, 0.22, 0.12, 0.05, dashTop);
  clusterHood.position.set(-0.43, 0.78, -0.34);
  const clusterDisplay = new THREE.Mesh(
    new THREE.PlaneGeometry(0.54, 0.17),
    new THREE.MeshBasicMaterial({ map: clusterTexture, toneMapped: false }),
  );
  clusterDisplay.position.set(-0.43, 0.77, -0.264);
  clusterDisplay.renderOrder = 5;
  (clusterDisplay.material as THREE.MeshBasicMaterial).depthTest = false;
  cockpit.add(clusterHood, clusterDisplay);

  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(-0.43, 0.52, 0.01);
  steeringWheel.rotation.x = 0.12;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.158, 0.018, 12, 40), rubber);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.052, 0.04, 20), dashTop);
  hub.rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.024, 0.018), trim);
    spoke.position.set(side * 0.074, -0.006, 0);
    spoke.rotation.z = side * -0.12;
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.009, 10), side < 0 ? accent : trim);
    button.rotation.x = Math.PI / 2;
    button.position.set(side * 0.095, 0.014, 0.015);
    steeringWheel.add(spoke, button);
  }
  const lowerSpoke = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.105, 0.018), trim);
  lowerSpoke.position.y = -0.075;
  steeringWheel.add(rim, hub, lowerSpoke);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.045, 0.4, 12), dash);
  column.rotation.x = Math.PI / 2;
  column.position.set(-0.43, 0.52, -0.22);
  cockpit.add(steeringWheel, column);

  const centerStack = roundedBox(0.43, 0.45, 0.12, 0.045, dashTop);
  centerStack.position.set(0.34, 0.49, -0.37);
  const infotainment = roundedBox(0.32, 0.19, 0.02, 0.018, screenMaterial);
  infotainment.position.set(0.34, 0.57, -0.3);
  const screenInset = roundedBox(0.25, 0.11, 0.012, 0.012, dash);
  screenInset.position.set(0.34, 0.57, -0.287);
  const screenLine = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.008), accent);
  screenLine.position.set(0.34, 0.57, -0.278);
  cockpit.add(centerStack, infotainment, screenInset, screenLine);
  for (const x of [-0.78, 0.76]) {
    const vent = roundedBox(0.24, 0.08, 0.035, 0.018, trim);
    vent.position.set(x, 0.6, -0.278);
    for (let i = -1; i <= 1; i++) {
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.008, 0.008), dash);
      vane.position.set(x, 0.6 + i * 0.022, -0.254);
      cockpit.add(vane);
    }
    cockpit.add(vent);
  }
  for (let i = 0; i < 3; i++) {
    const climate = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.018, 14), i === 1 ? accent : trim);
    climate.rotation.x = Math.PI / 2;
    climate.position.set(0.24 + i * 0.1, 0.38, -0.285);
    cockpit.add(climate);
  }

  const floor = roundedBox(2.18, 0.11, 3.25, 0.07, leather);
  floor.position.set(0, 0.1, 0.36);
  const console = roundedBox(0.36, 0.22, 1.2, 0.09, dashTop);
  console.position.set(0.18, 0.27, 0.38);
  const shifter = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.032, 0.24, 10), trim);
  shifter.position.set(0.18, 0.47, 0.08);
  shifter.rotation.x = -0.18;
  const shifterGrip = roundedBox(0.09, 0.12, 0.07, 0.035, rubber);
  shifterGrip.position.set(0.18, 0.59, 0.05);
  cockpit.add(floor, console, shifter, shifterGrip);
  for (const z of [0.45, 0.68]) {
    const cup = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 20), trim);
    cup.rotation.x = Math.PI / 2;
    cup.position.set(0.18, 0.395, z);
    cockpit.add(cup);
  }

  for (const side of [-1, 1]) {
    const door = roundedBox(0.1, 0.58, 1.52, 0.045, dash);
    door.position.set(side * 1.02, 0.62, 0.18);
    const armrest = roundedBox(0.16, 0.11, 0.58, 0.045, dashTop);
    armrest.position.set(side * 0.94, 0.64, 0.28);
    const handle = roundedBox(0.04, 0.055, 0.27, 0.018, trim);
    handle.position.set(side * 0.91, 0.77, 0.16);
    const pillar = roundedBox(0.055, 0.76, 0.075, 0.022, dash);
    pillar.position.set(side * 1.0, 1.29, -0.46);
    pillar.rotation.x = 0.29;
    const rearPillar = roundedBox(0.1, 0.68, 0.11, 0.03, dash);
    rearPillar.position.set(side * 0.97, 1.16, 0.86);
    cockpit.add(door, armrest, handle, pillar, rearPillar);
  }
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.94, 0.83), glass);
  windshield.position.set(0, 1.28, -0.54);
  windshield.rotation.x = 0.18;
  const windshieldTop = roundedBox(2.02, 0.045, 0.07, 0.02, dash);
  windshieldTop.position.set(0, 1.7, -0.45);
  const roof = roundedBox(2.04, 0.055, 1.08, 0.028, leather);
  roof.position.set(0, 1.73, -0.08);
  const rearWindow = new THREE.Mesh(new THREE.PlaneGeometry(1.52, 0.54), glass);
  rearWindow.position.set(0, 1.2, 1.03);
  rearWindow.rotation.y = Math.PI;
  const mirror = roundedBox(0.39, 0.115, 0.045, 0.022, trim);
  mirror.position.set(0.12, 1.52, -0.59);
  const mirrorStem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 8), trim);
  mirrorStem.position.set(0.12, 1.62, -0.55);
  cockpit.add(windshield, windshieldTop, roof, rearWindow, mirror, mirrorStem);

  const interiorLight = new THREE.PointLight(0xd4e7df, 2.2, 3.1, 1.65);
  interiorLight.position.set(-0.25, 1.32, 0.45);
  cockpit.add(interiorLight);
  cockpit.userData.steeringWheel = steeringWheel;
  cockpit.userData.clusterContext = clusterContext;
  cockpit.userData.clusterTexture = clusterTexture;
  cockpit.visible = false;
  return cockpit;
}

type CameraProfile = {
  height: number;
  forwardOffset: number;
  sideOffset: number;
  chaseHeight: number;
  chaseDistance: number;
  lookHeight: number;
};

function createBikeCockpit(color: number) {
  const cockpit = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xadb8b4, metalness: 0.92, roughness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141b1a, metalness: 0.35, roughness: 0.58 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xa9d3d4, transparent: true, opacity: 0.2, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.23, clearcoat: 1 });
  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(0, 1.04, -1.1);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.54, 12), metal);
  bar.rotation.z = Math.PI / 2;
  steeringWheel.add(bar);
  for (const side of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.19, 12), dark);
    grip.rotation.z = Math.PI / 2;
    grip.position.x = side * 0.29;
    steeringWheel.add(grip);
    const mirrorStem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.28, 8), metal);
    mirrorStem.position.set(side * 0.24, 0.13, 0);
    mirrorStem.rotation.z = side * -0.42;
    const mirror = new THREE.Mesh(new THREE.CircleGeometry(0.09, 18), glass);
    mirror.position.set(side * 0.31, 0.25, 0.01);
    steeringWheel.add(mirrorStem, mirror);
  }
  cockpit.add(steeringWheel);

  const clusterCanvas = document.createElement('canvas');
  clusterCanvas.width = 1024;
  clusterCanvas.height = 416;
  const clusterContext = clusterCanvas.getContext('2d')!;
  const clusterTexture = new THREE.CanvasTexture(clusterCanvas);
  clusterTexture.colorSpace = THREE.SRGBColorSpace;
  const cluster = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.1),
    new THREE.MeshBasicMaterial({ map: clusterTexture, toneMapped: false }),
  );
  cluster.position.set(0, 1.08, -1.18);
  cockpit.add(cluster);

  const windscreen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.55), glass);
  windscreen.position.set(0, 1.3, -1.32);
  windscreen.rotation.x = -0.18;
  const tankTop = roundedBox(0.5, 0.26, 0.68, 0.15, paint);
  tankTop.position.set(0, 0.76, -0.72);
  tankTop.rotation.x = -0.08;
  const forkCrown = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.12), metal);
  forkCrown.position.set(0, 0.92, -1.1);
  cockpit.add(windscreen, tankTop, forkCrown);
  cockpit.userData.steeringWheel = steeringWheel;
  cockpit.userData.clusterContext = clusterContext;
  cockpit.userData.clusterTexture = clusterTexture;
  cockpit.visible = false;
  return cockpit;
}

function createBusCockpit() {
  const cockpit = new THREE.Group();
  const dashMaterial = new THREE.MeshStandardMaterial({ color: 0x26302e, roughness: 0.84, metalness: 0.06 });
  const dashTopMaterial = new THREE.MeshStandardMaterial({ color: 0x38423f, roughness: 0.72, metalness: 0.12 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x687470, roughness: 0.38, metalness: 0.56 });
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x111716, roughness: 0.96, metalness: 0.02 });
  const headlinerMaterial = new THREE.MeshStandardMaterial({ color: 0x4d5753, roughness: 0.94, metalness: 0.02 });
  const wheelMaterial = new THREE.MeshPhysicalMaterial({ color: 0x18201e, roughness: 0.58, clearcoat: 0.28 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0xf05d3b, emissive: 0x7b1f0d, emissiveIntensity: 0.55 });
  const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0xa5cecd, transparent: true, opacity: 0.045, roughness: 0.025, side: THREE.DoubleSide, depthWrite: false });
  const sideGlassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x294a47, transparent: true, opacity: 0.42, roughness: 0.13, side: THREE.DoubleSide, depthWrite: false });

  // Bus interiors need their own driver-scale layout. The previous cockpit used
  // a deep block below a distant cluster, which filled half of first-person view.
  const dashboard = roundedBox(2.28, 0.15, 0.5, 0.06, dashMaterial);
  dashboard.position.set(0, 0.25, -0.04);
  const dashTop = roundedBox(2.34, 0.055, 0.58, 0.035, dashTopMaterial);
  dashTop.position.set(0, 0.355, -0.075);
  cockpit.add(dashboard, dashTop);

  const clusterCanvas = document.createElement('canvas');
  clusterCanvas.width = 1024;
  clusterCanvas.height = 416;
  const clusterContext = clusterCanvas.getContext('2d')!;
  const clusterTexture = new THREE.CanvasTexture(clusterCanvas);
  clusterTexture.colorSpace = THREE.SRGBColorSpace;
  clusterTexture.anisotropy = 8;
  const clusterHousing = roundedBox(0.5, 0.18, 0.065, 0.035, trimMaterial);
  clusterHousing.position.set(-0.56, 0.69, -0.04);
  const clusterDisplay = new THREE.Mesh(
    new THREE.PlaneGeometry(0.455, 0.145),
    new THREE.MeshBasicMaterial({ map: clusterTexture, toneMapped: false }),
  );
  clusterDisplay.position.set(-0.56, 0.69, -0.004);
  clusterDisplay.renderOrder = 4;
  (clusterDisplay.material as THREE.MeshBasicMaterial).depthTest = false;
  cockpit.add(clusterHousing, clusterDisplay);

  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(-0.56, 0.61, 0.32);
  steeringWheel.rotation.x = 0.18;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.022, 12, 34), wheelMaterial);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.063, 0.068, 0.05, 18), trimMaterial);
  hub.rotation.x = Math.PI / 2;
  for (const angle of [0, Math.PI * 0.67, -Math.PI * 0.67]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.029, 0.14, 0.02), trimMaterial);
    spoke.position.set(Math.sin(angle) * 0.066, Math.cos(angle) * 0.066, 0);
    spoke.rotation.z = -angle;
    steeringWheel.add(spoke);
  }
  steeringWheel.add(rim, hub);
  const steeringColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.042, 0.38, 12), dashTopMaterial);
  steeringColumn.rotation.x = Math.PI / 2;
  steeringColumn.position.set(-0.56, 0.59, 0.13);
  cockpit.add(steeringWheel, steeringColumn);

  const buttonPanel = roundedBox(0.36, 0.17, 0.055, 0.025, trimMaterial);
  buttonPanel.position.set(0.12, 0.49, -0.02);
  for (let i = 0; i < 4; i++) {
    const button = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), i === 0 ? accentMaterial : dashMaterial);
    button.position.set(0.045 + (i % 2) * 0.14, 0.455 + Math.floor(i / 2) * 0.07, 0.012);
    cockpit.add(button);
  }
  const ticketConsole = roundedBox(0.32, 0.28, 0.32, 0.055, dashMaterial);
  ticketConsole.position.set(0.75, 0.22, 0.02);
  cockpit.add(buttonPanel, ticketConsole);

  const floor = roundedBox(3.28, 0.12, 3.25, 0.06, floorMaterial);
  floor.position.set(0, -0.25, 0.42);
  const driverPedestal = roundedBox(0.68, 0.18, 0.72, 0.08, dashTopMaterial);
  driverPedestal.position.set(-0.56, -0.13, 0.78);
  const aisleTrim = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.025, 2.25), trimMaterial);
  aisleTrim.position.set(0.34, -0.17, 0.3);
  cockpit.add(floor, driverPedestal, aisleTrim);

  // A wide panoramic opening puts the A-pillars at the peripheral edges instead
  // of forming the narrow black rectangle visible in the old Metro cockpit.
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(3.22, 1.52), glassMaterial);
  windshield.position.set(0, 1.35, -0.47);
  const topRail = roundedBox(3.34, 0.065, 0.075, 0.025, dashMaterial);
  topRail.position.set(0, 2.13, -0.455);
  const roofShell = roundedBox(3.32, 0.12, 3.25, 0.055, dashMaterial);
  roofShell.position.set(0, 2.16, 0.58);
  const ceilingLiner = roundedBox(2.98, 0.035, 2.8, 0.03, headlinerMaterial);
  ceilingLiner.position.set(0, 2.085, 0.62);
  const frontBulkhead = roundedBox(3.26, 0.63, 0.12, 0.045, dashMaterial);
  frontBulkhead.position.set(0, 0.26, -0.43);
  const windshieldSill = roundedBox(3.3, 0.085, 0.17, 0.03, dashTopMaterial);
  windshieldSill.position.set(0, 0.59, -0.405);
  cockpit.add(windshield, topRail, roofShell, ceilingLiner, frontBulkhead, windshieldSill);
  for (const side of [-1, 1]) {
    const pillar = roundedBox(0.065, 1.58, 0.075, 0.022, dashMaterial);
    pillar.position.set(side * 1.65, 1.35, -0.455);
    cockpit.add(pillar);

    // Continue the body rearward from each A-pillar so the cockpit does not
    // look open-sided in first person. Glass stays transparent while the door,
    // belt rail and roof rail make the bus cabin silhouette readable.
    const sideWindow = new THREE.Mesh(new THREE.PlaneGeometry(1.82, 1.22), sideGlassMaterial);
    sideWindow.position.set(side * 1.64, 1.35, 0.45);
    sideWindow.rotation.y = side * Math.PI / 2;
    const sideRoofRail = roundedBox(0.075, 0.07, 1.9, 0.025, dashMaterial);
    sideRoofRail.position.set(side * 1.64, 2.02, 0.45);
    const sideBeltRail = roundedBox(0.09, 0.075, 1.9, 0.025, dashTopMaterial);
    sideBeltRail.position.set(side * 1.64, 0.72, 0.45);
    const windowDivider = roundedBox(0.075, 1.22, 0.075, 0.022, dashMaterial);
    windowDivider.position.set(side * 1.64, 1.35, 0.45);
    const rearPillar = roundedBox(0.085, 1.38, 0.095, 0.025, dashMaterial);
    rearPillar.position.set(side * 1.64, 1.35, 1.36);
    const doorPanel = roundedBox(0.12, 0.72, 1.82, 0.05, dashMaterial);
    doorPanel.position.set(side * 1.64, 0.32, 0.45);
    const doorInset = roundedBox(0.018, 0.36, 0.72, 0.035, dashTopMaterial);
    doorInset.position.set(side * 1.57, 0.34, 0.48);
    cockpit.add(sideWindow, sideRoofRail, sideBeltRail, windowDivider, rearPillar, doorPanel, doorInset);
  }

  const mirror = roundedBox(0.38, 0.12, 0.045, 0.025, trimMaterial);
  mirror.position.set(0.73, 1.92, -0.36);
  const mirrorStem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 10), trimMaterial);
  mirrorStem.position.set(0.73, 2.02, -0.4);
  cockpit.add(mirror, mirrorStem);

  cockpit.userData.steeringWheel = steeringWheel;
  cockpit.userData.clusterContext = clusterContext;
  cockpit.userData.clusterTexture = clusterTexture;
  cockpit.visible = false;
  return cockpit;
}

function addVehicleWheel(
  group: THREE.Group,
  wheels: THREE.Group[],
  frontWheels: THREE.Group[],
  position: [number, number, number],
  radius: number,
  width: number,
  rubber: THREE.Material,
  rimMaterial: THREE.Material,
  front: boolean,
) {
  const steeringPivot = new THREE.Group();
  steeringPivot.position.set(...position);
  const spinPivot = new THREE.Group();
  const tyre = createRoundedTyre(radius, width, rubber);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.57, radius * 0.57, width * 1.04, VEHICLE_RIM_SEGMENTS), rimMaterial);
  rim.rotation.z = Math.PI / 2;
  spinPivot.add(tyre, rim);
  steeringPivot.add(spinPivot);
  group.add(steeringPivot);
  wheels.push(spinPivot);
  if (front) frontWheels.push(steeringPivot);
}

function finishCustomVehicle(
  group: THREE.Group,
  wheels: THREE.Group[],
  frontWheels: THREE.Group[],
  appearance: CarCustomization,
  cockpit: THREE.Group | null,
  wheelRadius: number,
  cameraProfile: CameraProfile,
  rideHeight = 0,
) {
  if (cockpit) {
    group.add(cockpit);
    group.userData.cockpit = cockpit;
  }
  group.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  group.userData.wheels = wheels;
  group.userData.frontWheels = frontWheels;
  group.userData.firstPersonHidden = group.children.filter(child => child !== cockpit);
  group.userData.appearance = appearance;
  group.userData.wheelRadius = wheelRadius;
  group.userData.cameraProfile = cameraProfile;
  group.userData.rideHeight = rideHeight;
  return group;
}

function createLightweightTrafficCar(color: number, model: CarModelId) {
  const group = new THREE.Group();
  const appearance = { ...DEFAULT_CUSTOMIZATION, color, model };
  const paint = new THREE.MeshLambertMaterial({ color });
  const cabinMaterial = new THREE.MeshLambertMaterial({ color: 0x304d50 });
  const glass = new THREE.MeshBasicMaterial({ color: 0x20383b });
  const trim = new THREE.MeshLambertMaterial({ color: 0x18201f });
  const rubber = new THREE.MeshLambertMaterial({ color: 0x090b0a });
  const white = new THREE.MeshBasicMaterial({ color: 0xf0fff8 });
  const red = new THREE.MeshBasicMaterial({ color: 0xd7281e });

  const shape = model === 'metro-bus'
    ? { width: 2.35, bodyHeight: 1.12, length: 7.05, cabinWidth: 2.22, cabinHeight: 1.55, cabinLength: 6.35, bodyY: 0.68, cabinY: 1.82, cabinZ: 0.05, wheelX: 1.18, wheelZ: 2.35, wheelRadius: 0.5 }
    : model === 'trail-pickup'
      ? { width: 2.12, bodyHeight: 0.72, length: 5.35, cabinWidth: 1.92, cabinHeight: 0.9, cabinLength: 2.08, bodyY: 0.58, cabinY: 1.2, cabinZ: -0.82, wheelX: 1.08, wheelZ: 1.7, wheelRadius: 0.46 }
      : model === 'ridge-x'
        ? { width: 2.02, bodyHeight: 0.78, length: 4.5, cabinWidth: 1.72, cabinHeight: 0.82, cabinLength: 2.15, bodyY: 0.62, cabinY: 1.24, cabinZ: 0.02, wheelX: 1.02, wheelZ: 1.42, wheelRadius: 0.44 }
        : model === 'apex-r'
          ? { width: 1.92, bodyHeight: 0.5, length: 4.45, cabinWidth: 1.52, cabinHeight: 0.5, cabinLength: 1.72, bodyY: 0.46, cabinY: 0.88, cabinZ: 0.1, wheelX: 0.98, wheelZ: 1.42, wheelRadius: 0.37 }
          : model === 'touring-s'
            ? { width: 1.98, bodyHeight: 0.62, length: 4.85, cabinWidth: 1.66, cabinHeight: 0.64, cabinLength: 2.25, bodyY: 0.53, cabinY: 1.02, cabinZ: 0.08, wheelX: 1, wheelZ: 1.54, wheelRadius: 0.4 }
            : { width: 1.9, bodyHeight: 0.58, length: 3.9, cabinWidth: 1.5, cabinHeight: 0.58, cabinLength: 1.72, bodyY: 0.53, cabinY: 1.04, cabinZ: 0.08, wheelX: 0.98, wheelZ: 1.28, wheelRadius: 0.38 };

  const body = new THREE.Mesh(new THREE.BoxGeometry(shape.width, shape.bodyHeight, shape.length), paint);
  body.position.y = shape.bodyY;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(shape.cabinWidth, shape.cabinHeight, shape.cabinLength), cabinMaterial);
  cabin.position.set(0, shape.cabinY, shape.cabinZ);
  const headlights = new THREE.Mesh(new THREE.BoxGeometry(shape.width * 0.67, 0.11, 0.05), white);
  headlights.position.set(0, shape.bodyY + 0.08, -shape.length * 0.505);
  const taillights = new THREE.Mesh(new THREE.BoxGeometry(shape.width * 0.7, 0.1, 0.05), red);
  taillights.position.set(0, shape.bodyY + 0.08, shape.length * 0.505);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(shape.cabinWidth * 0.94, 0.1, shape.cabinLength * 0.82),
    paint,
  );
  roof.position.set(0, shape.cabinY + shape.cabinHeight * 0.52, shape.cabinZ);
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(shape.cabinWidth * 0.76, shape.cabinHeight * 0.58, 0.045),
    glass,
  );
  windshield.position.set(0, shape.cabinY, shape.cabinZ - shape.cabinLength * 0.505);
  const rearWindow = windshield.clone();
  rearWindow.position.z = shape.cabinZ + shape.cabinLength * 0.505;

  const sideWindowGeometry = new THREE.BoxGeometry(0.045, shape.cabinHeight * 0.5, shape.cabinLength * 0.68);
  const sideWindows = new THREE.InstancedMesh(sideWindowGeometry, glass, 2);
  const sideWindowMatrix = new THREE.Matrix4();
  sideWindows.setMatrixAt(0, sideWindowMatrix.makeTranslation(-shape.cabinWidth * 0.51, shape.cabinY, shape.cabinZ));
  sideWindows.setMatrixAt(1, sideWindowMatrix.makeTranslation(shape.cabinWidth * 0.51, shape.cabinY, shape.cabinZ));

  const bumperGeometry = new THREE.BoxGeometry(shape.width * 0.92, 0.13, 0.13);
  const bumpers = new THREE.InstancedMesh(bumperGeometry, trim, 2);
  const bumperMatrix = new THREE.Matrix4();
  bumpers.setMatrixAt(0, bumperMatrix.makeTranslation(0, shape.wheelRadius * 0.72, -shape.length * 0.515));
  bumpers.setMatrixAt(1, bumperMatrix.makeTranslation(0, shape.wheelRadius * 0.72, shape.length * 0.515));
  group.add(body, cabin, roof, windshield, rearWindow, sideWindows, bumpers, headlights, taillights);

  if (model === 'trail-pickup') {
    const railGeometry = new THREE.BoxGeometry(0.13, 0.38, 2.08);
    const bedRails = new THREE.InstancedMesh(railGeometry, paint, 2);
    const railMatrix = new THREE.Matrix4();
    bedRails.setMatrixAt(0, railMatrix.makeTranslation(-0.96, 1.02, 1.25));
    bedRails.setMatrixAt(1, railMatrix.makeTranslation(0.96, 1.02, 1.25));
    group.add(bedRails);
  } else if (model === 'metro-bus') {
    const pillarGeometry = new THREE.BoxGeometry(0.06, shape.cabinHeight * 0.64, 0.08);
    const pillars = new THREE.InstancedMesh(pillarGeometry, trim, 10);
    const pillarMatrix = new THREE.Matrix4();
    for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
      for (let pillarIndex = 0; pillarIndex < 5; pillarIndex++) {
        pillars.setMatrixAt(
          sideIndex * 5 + pillarIndex,
          pillarMatrix.makeTranslation(
            (sideIndex ? 1 : -1) * shape.cabinWidth * 0.52,
            shape.cabinY,
            shape.cabinZ - 2.35 + pillarIndex * 1.18,
          ),
        );
      }
    }
    group.add(pillars);
  } else if (model === 'apex-r') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(shape.width * 0.72, 0.08, 0.18), trim);
    spoiler.position.set(0, shape.bodyY + shape.bodyHeight * 0.68, shape.length * 0.43);
    group.add(spoiler);
  }

  const wheelGeometry = new THREE.CylinderGeometry(shape.wheelRadius, shape.wheelRadius, 0.24, VERY_LOW_END ? 10 : 16);
  const wheels: THREE.Group[] = [];
  const frontWheels: THREE.Group[] = [];
  for (const x of [-shape.wheelX, shape.wheelX]) {
    for (const z of [-shape.wheelZ, shape.wheelZ]) {
      const steeringPivot = new THREE.Group();
      steeringPivot.position.set(x, shape.wheelRadius + 0.01, z);
      const spinPivot = new THREE.Group();
      const wheel = new THREE.Mesh(wheelGeometry, rubber);
      wheel.rotation.z = Math.PI / 2;
      spinPivot.add(wheel);
      steeringPivot.add(spinPivot);
      group.add(steeringPivot);
      wheels.push(spinPivot);
      if (z < 0) frontWheels.push(steeringPivot);
    }
  }

  return finishCustomVehicle(group, wheels, frontWheels, appearance, null, shape.wheelRadius, {
    height: 1.2,
    forwardOffset: 0,
    sideOffset: 0,
    chaseHeight: 3.4,
    chaseDistance: 7,
    lookHeight: 1,
  });
}

function createBus(appearance: CarCustomization, player: boolean) {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: appearance.color, metalness: 0.24, roughness: 0.29, clearcoat: 0.9, clearcoatRoughness: 0.16 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x121918, metalness: 0.35, roughness: 0.42 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x090b0a, roughness: 0.9 });
  const rim = new THREE.MeshStandardMaterial({ color: appearance.wheelColor, metalness: 0.88, roughness: 0.25 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x6d9698, transparent: true, opacity: 0.7, roughness: 0.09, metalness: 0.08, side: THREE.DoubleSide, depthWrite: false });
  const windowTint = new THREE.MeshStandardMaterial({ color: 0x29494b, metalness: 0.22, roughness: 0.2 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xaab5b1, metalness: 0.9, roughness: 0.2 });
  const white = new THREE.MeshStandardMaterial({ color: 0xedfff7, emissive: 0xc8fff1, emissiveIntensity: 2.2 });
  const red = new THREE.MeshStandardMaterial({ color: 0xa5130e, emissive: 0xff2418, emissiveIntensity: 1.5 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xffa33a, emissive: 0xff6a18, emissiveIntensity: 1.65 });
  const body = roundedBox(2.42, 1.12, 7.25, 0.24, paint);
  body.position.y = 0.62;
  const upper = roundedBox(2.34, 1.78, 6.8, 0.2, paint);
  upper.position.set(0, 1.52, 0.02);
  const roof = roundedBox(2.38, 0.14, 6.75, 0.16, dark);
  roof.position.set(0, 3.01, 0.02);
  group.add(body, upper, roof);

  const frontGlassLeft = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 1.18), glass);
  frontGlassLeft.position.set(-0.52, 2.17, -3.5);
  frontGlassLeft.rotation.y = Math.PI;
  const frontGlassRight = frontGlassLeft.clone();
  frontGlassRight.position.x = 0.52;
  const windshieldDivider = new THREE.Mesh(new THREE.BoxGeometry(0.065, 1.25, 0.075), dark);
  windshieldDivider.position.set(0, 2.17, -3.455);
  const rearGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.0), glass);
  rearGlass.position.set(0, 2.18, 3.5);
  group.add(frontGlassLeft, frontGlassRight, windshieldDivider, rearGlass);
  for (const side of [-1, 1]) {
    // Give the side glazing a solid dark backing. A single transparent plane
    // disappeared into the painted upper body at shallow camera angles.
    const windowBand = roundedBox(0.055, 0.86, 5.76, 0.025, windowTint);
    windowBand.position.set(side * 1.245, 2.18, 0.1);
    group.add(windowBand);
    for (let i = 0; i < 5; i++) {
      const window = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 0.78), glass);
      window.position.set(side * 1.278, 2.18, -2.25 + i * 1.18);
      window.rotation.y = side * Math.PI / 2;
      group.add(window);
    }
    for (let i = 0; i < 6; i++) {
      const windowFrame = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.92, 0.075), dark);
      windowFrame.position.set(side * 1.292, 2.18, -2.84 + i * 1.18);
      group.add(windowFrame);
    }
    const lowerSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 5.8), dark);
    lowerSkirt.position.set(side * 1.18, 0.43, 0.25);
    const sideStripe = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 6.3), chrome);
    sideStripe.position.set(side * 1.225, 1.46, 0.02);
    group.add(lowerSkirt, sideStripe);
  }
  const belt = new THREE.Mesh(new THREE.BoxGeometry(2.44, 0.16, 6.78), dark);
  belt.position.set(0, 1.6, 0.03);
  group.add(belt);
  const routeCanvas = document.createElement('canvas');
  routeCanvas.width = 512;
  routeCanvas.height = 128;
  const routeContext = routeCanvas.getContext('2d')!;
  routeContext.fillStyle = '#09110f';
  routeContext.fillRect(0, 0, 512, 128);
  routeContext.fillStyle = '#ffb342';
  routeContext.font = '800 62px Arial';
  routeContext.textAlign = 'center';
  routeContext.textBaseline = 'middle';
  routeContext.fillText('09  MISTLINE', 256, 68);
  const routeTexture = new THREE.CanvasTexture(routeCanvas);
  const routeSign = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.42), new THREE.MeshBasicMaterial({ map: routeTexture, toneMapped: false, side: THREE.DoubleSide }));
  routeSign.position.set(0, 2.74, -3.445);
  routeSign.rotation.y = Math.PI;
  const rearRouteSign = routeSign.clone();
  rearRouteSign.scale.set(0.72, 0.72, 0.72);
  rearRouteSign.scale.x = -0.72;
  rearRouteSign.position.set(0, 2.78, 3.445);
  rearRouteSign.rotation.y = 0;
  group.add(routeSign, rearRouteSign);
  const frontMask = roundedBox(2.2, 0.62, 0.12, 0.05, dark);
  frontMask.position.set(0, 0.96, -3.55);
  const grille = roundedBox(1.18, 0.3, 0.055, 0.035, chrome);
  grille.position.set(0, 0.63, -3.63);
  for (let i = 0; i < 4; i++) {
    const grilleSlat = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.025, 0.026), dark);
    grilleSlat.position.set(0, 0.53 + i * 0.07, -3.668);
    group.add(grilleSlat);
  }
  const roofHvac = roundedBox(1.25, 0.22, 2.05, 0.12, dark);
  roofHvac.position.set(0, 3.15, 0.72);
  const hvacInset = roundedBox(0.92, 0.08, 1.58, 0.08, chrome);
  hvacInset.position.set(0, 3.29, 0.72);
  group.add(frontMask, grille, roofHvac, hvacInset);

  const doorLower = roundedBox(0.075, 0.74, 0.98, 0.035, paint);
  doorLower.position.set(1.225, 0.91, -2.46);
  const doorGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.72), glass);
  doorGlass.position.set(1.305, 1.9, -2.46);
  doorGlass.rotation.y = Math.PI / 2;
  for (const z of [-2.94, -1.98]) {
    const doorPost = new THREE.Mesh(new THREE.BoxGeometry(0.065, 1.68, 0.065), dark);
    doorPost.position.set(1.318, 1.48, z);
    group.add(doorPost);
  }
  group.add(doorLower, doorGlass);

  for (const side of [-1, 1]) {
    const mirrorStem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.35, 10), chrome);
    mirrorStem.rotation.z = Math.PI / 2;
    mirrorStem.position.set(side * 1.28, 2.08, -3.18);
    const mirrorHousing = roundedBox(0.3, 0.17, 0.13, 0.055, dark);
    mirrorHousing.position.set(side * 1.45, 2.08, -3.18);
    group.add(mirrorStem, mirrorHousing);
  }
  for (const x of [-0.78, 0.78]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.08), white);
    head.position.set(x, 0.78, -3.66);
    const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.085), amber);
    indicator.position.set(x + Math.sign(x) * 0.34, 0.78, -3.665);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.08), red);
    tail.position.set(x, 0.84, 3.66);
    group.add(head, indicator, tail);
  }
  const bumperFront = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.24, 0.18), dark);
  bumperFront.position.set(0, 0.34, -3.7);
  const bumperRear = bumperFront.clone();
  bumperRear.position.z = 3.7;
  group.add(bumperFront, bumperRear);

  const wheels: THREE.Group[] = [];
  const frontWheels: THREE.Group[] = [];
  for (const x of [-1.2, 1.2]) {
    addVehicleWheel(group, wheels, frontWheels, [x, 0.53, -2.45], 0.52, 0.3, rubber, rim, true);
    addVehicleWheel(group, wheels, frontWheels, [x, 0.53, 2.35], 0.52, 0.3, rubber, rim, false);
  }
  const cockpit = player ? createBusCockpit() : null;
  if (cockpit) cockpit.position.set(0, 0.96, -2.58);
  return finishCustomVehicle(group, wheels, frontWheels, appearance, cockpit, 0.52, {
    height: 2.18, forwardOffset: 1.3, sideOffset: -0.56, chaseHeight: 5.4, chaseDistance: 11.8, lookHeight: 1.75,
  });
}

function createMotorcycle(appearance: CarCustomization, player: boolean) {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: appearance.color, metalness: 0.4, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.13 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111615, metalness: 0.5, roughness: 0.38 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x070908, roughness: 0.92 });
  const metal = new THREE.MeshStandardMaterial({ color: appearance.wheelColor, metalness: 0.92, roughness: 0.2 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2fff7, emissive: 0xc6fff0, emissiveIntensity: 2.5 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb4140d, emissive: 0xff2317, emissiveIntensity: 1.6 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 1.2), metal);
  frame.position.set(0, 0.55, 0.05);
  frame.rotation.x = -0.08;
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.46, LOW_POWER_MODE ? 22 : 36, LOW_POWER_MODE ? 14 : 24), paint);
  tank.position.set(0, 0.89, -0.25);
  tank.scale.set(0.78, 0.7, 1.05);
  const fairing = roundedBox(0.62, 0.52, 0.8, 0.16, paint);
  fairing.position.set(0, 0.82, -0.62);
  const seat = roundedBox(0.46, 0.14, 0.82, 0.12, dark);
  seat.position.set(0, 0.84, 0.48);
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.48, 0.55), dark);
  engine.position.set(0, 0.49, 0.05);
  group.add(frame, tank, fairing, seat, engine);
  const wheels: THREE.Group[] = [];
  const frontWheels: THREE.Group[] = [];
  addVehicleWheel(group, wheels, frontWheels, [0, 0.43, -1.02], 0.43, 0.18, rubber, metal, true);
  addVehicleWheel(group, wheels, frontWheels, [0, 0.43, 1.02], 0.43, 0.22, rubber, metal, false);
  for (const x of [-0.19, 0.19]) {
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.84, 10), metal);
    fork.position.set(x, 0.75, -0.84);
    fork.rotation.x = -0.18;
    group.add(fork);
  }
  const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.7, 10), metal);
  handlebar.rotation.z = Math.PI / 2;
  handlebar.position.set(0, 1.15, -0.62);
  const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.15, LOW_POWER_MODE ? 20 : 32, LOW_POWER_MODE ? 12 : 20), white);
  headlight.position.set(0, 0.98, -1.0);
  headlight.scale.z = 0.55;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.08), red);
  tail.position.set(0, 0.78, 1.0);
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.95, 14), metal);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.32, 0.43, 0.46);
  const riderSuit = new THREE.MeshStandardMaterial({ color: 0x182321, roughness: 0.72, metalness: 0.08 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x304b50, roughness: 0.06, metalness: 0.5, clearcoat: 1 });
  const torso = roundedBox(0.5, 0.62, 0.38, 0.12, riderSuit);
  torso.position.set(0, 1.2, 0.13);
  torso.rotation.x = -0.36;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.25, LOW_POWER_MODE ? 22 : 34, LOW_POWER_MODE ? 14 : 22), riderSuit);
  helmet.position.set(0, 1.62, -0.13);
  const helmetVisor = new THREE.Mesh(new THREE.SphereGeometry(0.205, 18, 10, 0, Math.PI), visor);
  helmetVisor.position.set(0, 1.64, -0.29);
  helmetVisor.rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.58, 10), riderSuit);
    arm.position.set(side * 0.22, 1.2, -0.28);
    arm.rotation.x = -0.88;
    arm.rotation.z = side * -0.3;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.68, 10), riderSuit);
    leg.position.set(side * 0.2, 0.82, 0.32);
    leg.rotation.x = -0.46;
    group.add(arm, leg);
  }
  group.add(handlebar, headlight, tail, exhaust, torso, helmet, helmetVisor);
  const cockpit = player ? createBikeCockpit(appearance.color) : null;
  return finishCustomVehicle(group, wheels, frontWheels, appearance, cockpit, 0.43, {
    height: 1.32, forwardOffset: 0.3, sideOffset: 0, chaseHeight: 2.75, chaseDistance: 5.6, lookHeight: 0.92,
  }, 0.02);
}

function createPickup(appearance: CarCustomization, player: boolean) {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: appearance.color, metalness: 0.34, roughness: 0.24, clearcoat: 0.95, clearcoatRoughness: 0.16 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151b1a, metalness: 0.42, roughness: 0.42 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x080a09, roughness: 0.92 });
  const rim = new THREE.MeshStandardMaterial({ color: appearance.wheelColor, metalness: 0.9, roughness: 0.25 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x72999b, transparent: true, opacity: 0.66, roughness: 0.07, side: THREE.DoubleSide, depthWrite: false });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xaeb8b4, metalness: 0.9, roughness: 0.2 });
  const bedLiner = new THREE.MeshStandardMaterial({ color: 0x202624, metalness: 0.08, roughness: 0.92 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9fff7, emissive: 0xbffff0, emissiveIntensity: 2.1 });
  const red = new THREE.MeshStandardMaterial({ color: 0x98110d, emissive: 0xff2117, emissiveIntensity: 1.5 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xffa038, emissive: 0xff6718, emissiveIntensity: 1.5 });
  const body = roundedBox(2.18, 0.72, 5.35, 0.3, paint);
  body.position.y = 0.53;
  const cabBelt = roundedBox(2.05, 0.45, 2.16, 0.2, paint);
  cabBelt.position.set(0, 1.03, -0.9);
  const cabRoof = roundedBox(1.95, 0.16, 1.88, 0.16, paint);
  cabRoof.position.set(0, 1.69, -0.82);
  const hood = roundedBox(2.06, 0.25, 1.52, 0.2, paint);
  hood.position.set(0, 0.9, -2.02);
  const hoodBulge = roundedBox(0.86, 0.08, 1.16, 0.09, paint);
  hoodBulge.position.set(0, 1.055, -2.02);
  const windshield = createGlassPanel([
    [-0.84, 1.2, -1.91],
    [0.84, 1.2, -1.91],
    [0.79, 1.61, -1.56],
    [-0.79, 1.61, -1.56],
  ], glass);
  const rearWindow = createGlassPanel([
    [-0.77, 1.2, 0.13],
    [-0.75, 1.6, 0.02],
    [0.75, 1.6, 0.02],
    [0.77, 1.2, 0.13],
  ], glass);
  const bedFloor = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.1, 2.18), bedLiner);
  bedFloor.position.set(0, 0.82, 1.35);
  group.add(body, cabBelt, cabRoof, hood, hoodBulge, windshield, rearWindow, bedFloor);
  for (const x of [-0.91, 0.91]) {
    for (const z of [-1.68, 0.04]) {
      const pillar = roundedBox(0.13, 0.64, 0.14, 0.045, paint);
      pillar.position.set(x, 1.4, z);
      pillar.rotation.x = z < -1 ? -0.24 : 0.08;
      group.add(pillar);
    }
  }
  for (let i = -3; i <= 3; i++) {
    const bedRib = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.025, 0.045), dark);
    bedRib.position.set(0, 0.89, 1.35 + i * 0.29);
    group.add(bedRib);
  }
  for (const side of [-1, 1]) {
    const sideWindow = createGlassPanel([
      [side * 1.025, 1.2, -1.68],
      [side * 1.025, 1.2, -0.08],
      [side * 0.94, 1.61, -0.05],
      [side * 0.94, 1.61, -1.48],
    ], glass);
    const doorSeam = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.84, 0.045), dark);
    doorSeam.position.set(side * 1.055, 1.05, -0.12);
    const bedRail = roundedBox(0.18, 0.55, 2.25, 0.08, paint);
    bedRail.position.set(side * 1.0, 1.05, 1.34);
    const bedCap = roundedBox(0.22, 0.09, 2.3, 0.045, dark);
    bedCap.position.set(side * 1.0, 1.37, 1.34);
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 2.4), dark);
    step.position.set(side * 1.1, 0.34, 0.12);
    const mirrorStem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 10), chrome);
    mirrorStem.rotation.z = Math.PI / 2;
    mirrorStem.position.set(side * 1.1, 1.55, -1.55);
    const mirrorHousing = roundedBox(0.24, 0.14, 0.12, 0.045, dark);
    mirrorHousing.position.set(side * 1.23, 1.55, -1.55);
    const doorHandle = roundedBox(0.035, 0.06, 0.28, 0.02, chrome);
    doorHandle.position.set(side * 1.075, 1.18, -0.45);
    const bodyLine = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.045, 4.55), chrome);
    bodyLine.position.set(side * 1.095, 0.88, -0.05);
    group.add(sideWindow, doorSeam, bedRail, bedCap, step, mirrorStem, mirrorHousing, doorHandle, bodyLine);

    for (const z of [-1.72, 1.72]) {
      const fenderFlare = roundedBox(0.12, 0.15, 1.06, 0.045, dark);
      fenderFlare.position.set(side * 1.085, 0.73, z);
      group.add(fenderFlare);
    }
  }
  const tailgate = roundedBox(1.94, 0.55, 0.18, 0.07, paint);
  tailgate.position.set(0, 1.04, 2.62);
  const tailgateHandle = roundedBox(0.38, 0.08, 0.06, 0.025, dark);
  tailgateHandle.position.set(0, 1.18, 2.73);
  const frontFascia = roundedBox(2.05, 0.46, 0.16, 0.07, dark);
  frontFascia.position.set(0, 0.62, -2.74);
  const grille = roundedBox(1.28, 0.3, 0.055, 0.035, chrome);
  grille.position.set(0, 0.66, -2.84);
  for (let i = 0; i < 3; i++) {
    const grilleSlat = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.025, 0.025), dark);
    grilleSlat.position.set(0, 0.58 + i * 0.08, -2.875);
    group.add(grilleSlat);
  }
  const grilleBadge = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), dark);
  grilleBadge.position.set(0, 0.69, -2.91);
  const badgeMark = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.13, 0.012), chrome);
  badgeMark.position.set(0, 0.69, -2.925);
  badgeMark.rotation.z = -0.36;
  const skidPlate = roundedBox(1.28, 0.12, 0.19, 0.045, chrome);
  skidPlate.position.set(0, 0.22, -2.79);
  group.add(grilleBadge, badgeMark, skidPlate);
  for (const x of [-0.77, 0.77]) {
    const headlight = roundedBox(0.42, 0.2, 0.07, 0.04, white);
    headlight.position.set(x, 0.78, -2.83);
    const indicator = roundedBox(0.12, 0.1, 0.075, 0.025, amber);
    indicator.position.set(x + Math.sign(x) * 0.28, 0.76, -2.835);
    const taillight = roundedBox(0.24, 0.34, 0.07, 0.045, red);
    taillight.position.set(x, 1.02, 2.73);
    group.add(headlight, indicator, taillight);
  }
  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.18, 0.16), chrome);
  frontBumper.position.set(0, 0.35, -2.82);
  const rearBumper = frontBumper.clone();
  rearBumper.position.z = 2.78;
  const tailgateInset = roundedBox(1.2, 0.045, 0.025, 0.015, dark);
  tailgateInset.position.set(0, 1.05, 2.724);
  const towHitch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.38), dark);
  towHitch.position.set(0, 0.22, 2.91);
  const hitchBall = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), chrome);
  hitchBall.position.set(0, 0.3, 3.1);
  const thirdBrake = roundedBox(0.42, 0.07, 0.035, 0.02, red);
  thirdBrake.position.set(0, 1.64, 0.14);
  group.add(tailgate, tailgateHandle, tailgateInset, frontFascia, grille, frontBumper, rearBumper, towHitch, hitchBall, thirdBrake);
  const wheels: THREE.Group[] = [];
  const frontWheels: THREE.Group[] = [];
  for (const x of [-1.1, 1.1]) {
    addVehicleWheel(group, wheels, frontWheels, [x, 0.53, -1.72], 0.5, 0.32, rubber, rim, true);
    addVehicleWheel(group, wheels, frontWheels, [x, 0.53, 1.72], 0.5, 0.32, rubber, rim, false);
  }
  const cockpit = player ? createPickupCockpit() : null;
  if (cockpit) cockpit.position.set(0, 0.38, -1.16);
  return finishCustomVehicle(group, wheels, frontWheels, appearance, cockpit, 0.5, {
    height: 1.68, forwardOffset: 0.02, sideOffset: -0.4, chaseHeight: 4.2, chaseDistance: 8.6, lookHeight: 1.25,
  }, 0.12);
}

export function createCar(color: number, player = false, customization?: CarCustomization) {
  const appearance = customization ?? { ...DEFAULT_CUSTOMIZATION, color };
  if (appearance.model === 'metro-bus') return createBus(appearance, player);
  if (appearance.model === 'storm-moto') return createMotorcycle(appearance, player);
  if (appearance.model === 'trail-pickup') return createPickup(appearance, player);
  const isApex = appearance.model === 'apex-r';
  const detailed = player || Boolean(customization);
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: appearance.color, metalness: 0.38, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.12 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101416, metalness: 0.4, roughness: 0.32 });
  const carbon = new THREE.MeshPhysicalMaterial({ color: 0x151b1b, metalness: 0.72, roughness: 0.27, clearcoat: 0.65, clearcoatRoughness: 0.25 });
  const gunmetal = new THREE.MeshStandardMaterial({ color: appearance.wheelColor, metalness: 0.9, roughness: 0.22 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x8eb9bd,
    metalness: 0.08,
    roughness: 0.06,
    transmission: 0.34,
    transparent: true,
    opacity: 0.64,
    side: THREE.DoubleSide,
    depthWrite: false,
    clearcoat: 0.65,
    clearcoatRoughness: 0.12,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x090a0a, roughness: 0.88 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xbcc1bd, metalness: 0.9, roughness: 0.16 });
  const brakeDisc = new THREE.MeshStandardMaterial({ color: 0x77807d, metalness: 0.92, roughness: 0.38 });
  const brakeCaliper = new THREE.MeshStandardMaterial({ color: 0xff4a26, metalness: 0.35, roughness: 0.32 });
  const lightHousing = new THREE.MeshStandardMaterial({ color: 0x080d0e, metalness: 0.48, roughness: 0.2 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe7fff4, emissive: 0xbfffea, emissiveIntensity: 2.4, roughness: 0.14 });
  const red = new THREE.MeshStandardMaterial({ color: 0x8f0805, emissive: 0xff1c12, emissiveIntensity: 1.45, roughness: 0.2 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xffaa3a, emissive: 0xff6a13, emissiveIntensity: 1.7, roughness: 0.2 });

  const body = roundedBox(isApex ? 2.18 : 2.02, isApex ? 0.46 : 0.56, isApex ? 4.72 : 4.25, isApex ? 0.4 : 0.36, paint);
  body.position.y = isApex ? 0.43 : 0.48;
  group.add(body);

  const lowerBody = roundedBox(isApex ? 2.08 : 1.92, isApex ? 0.16 : 0.19, isApex ? 4.62 : 4.08, isApex ? 0.27 : 0.22, carbon);
  lowerBody.position.y = isApex ? 0.22 : 0.25;
  group.add(lowerBody);

  const hood = roundedBox(isApex ? 2.04 : 1.9, isApex ? 0.11 : 0.18, isApex ? 1.78 : 1.45, isApex ? 0.32 : 0.25, paint);
  hood.position.set(0, isApex ? 0.72 : 0.85, isApex ? -1.5 : -1.27);
  hood.rotation.x = isApex ? -0.055 : -0.035;
  group.add(hood);

  for (const side of [-1, 1]) {
    const frontHaunch = roundedBox(isApex ? 0.62 : 0.52, isApex ? 0.17 : 0.2, isApex ? 1.32 : 1.08, isApex ? 0.22 : 0.16, paint);
    frontHaunch.position.set(side * (isApex ? 0.78 : 0.72), isApex ? 0.67 : 0.76, isApex ? -1.5 : -1.28);
    frontHaunch.rotation.x = -0.025;
    const rearHaunch = roundedBox(isApex ? 0.67 : 0.56, isApex ? 0.2 : 0.22, isApex ? 1.38 : 1.18, isApex ? 0.23 : 0.17, paint);
    rearHaunch.position.set(side * (isApex ? 0.78 : 0.71), isApex ? 0.69 : 0.78, isApex ? 1.5 : 1.3);
    rearHaunch.rotation.x = 0.02;
    group.add(frontHaunch, rearHaunch);
  }

  const rearDeck = roundedBox(isApex ? 1.94 : 1.72, isApex ? 0.11 : 0.13, isApex ? 1.02 : 0.8, isApex ? 0.28 : 0.18, paint);
  rearDeck.position.set(0, isApex ? 0.75 : 0.88, isApex ? 1.72 : 1.52);
  rearDeck.rotation.x = 0.025;
  group.add(rearDeck);

  const cabin = new THREE.Group();
  if (detailed) {
    const windshield = createGlassPanel([
      [isApex ? -0.86 : -0.78, isApex ? 0.82 : 0.96, isApex ? -0.94 : -0.76],
      [isApex ? 0.86 : 0.78, isApex ? 0.82 : 0.96, isApex ? -0.94 : -0.76],
      [isApex ? 0.67 : 0.64, isApex ? 1.2 : 1.36, isApex ? -0.38 : -0.43],
      [isApex ? -0.67 : -0.64, isApex ? 1.2 : 1.36, isApex ? -0.38 : -0.43],
    ], glass);
    const rearGlass = createGlassPanel([
      [isApex ? -0.67 : -0.64, isApex ? 1.2 : 1.36, isApex ? 0.48 : 0.65],
      [isApex ? 0.67 : 0.64, isApex ? 1.2 : 1.36, isApex ? 0.48 : 0.65],
      [isApex ? 0.86 : 0.78, isApex ? 0.82 : 0.96, isApex ? 1.16 : 0.98],
      [isApex ? -0.86 : -0.78, isApex ? 0.82 : 0.96, isApex ? 1.16 : 0.98],
    ], glass);
    cabin.add(windshield, rearGlass);

    for (const side of [-1, 1]) {
      const x = side * (isApex ? 0.89 : 0.81);
      const frontSideGlass = createGlassPanel([
        [x, isApex ? 0.83 : 0.97, isApex ? -0.85 : -0.68],
        [x, isApex ? 1.18 : 1.34, isApex ? -0.36 : -0.4],
        [x, isApex ? 1.18 : 1.34, isApex ? 0.12 : 0.14],
        [x, isApex ? 0.83 : 0.97, isApex ? 0.12 : 0.14],
      ], glass);
      const quarterGlass = createGlassPanel([
        [x, isApex ? 0.83 : 0.97, isApex ? 0.19 : 0.21],
        [x, isApex ? 1.18 : 1.34, isApex ? 0.19 : 0.21],
        [x, isApex ? 1.15 : 1.31, isApex ? 0.54 : 0.57],
        [x, isApex ? 0.83 : 0.97, isApex ? 1.03 : 0.86],
      ], glass);
      cabin.add(frontSideGlass, quarterGlass);
    }
  } else {
    const simpleCabin = roundedBox(isApex ? 1.76 : 1.65, isApex ? 0.48 : 0.68, isApex ? 2.12 : 1.92, isApex ? 0.38 : 0.34, glass);
    simpleCabin.position.set(0, isApex ? 0.82 : 0.95, isApex ? 0.08 : 0.12);
    simpleCabin.scale.set(isApex ? 0.98 : 0.95, 1, isApex ? 0.96 : 0.92);
    cabin.add(simpleCabin);
  }
  group.add(cabin);

  const roof = roundedBox(isApex ? 1.58 : 1.52, isApex ? 0.055 : 0.08, isApex ? 1.04 : 1.2, isApex ? 0.3 : 0.22, paint);
  roof.position.set(0, isApex ? 1.22 : 1.39, isApex ? 0.08 : 0.18);
  group.add(roof);

  const exteriorCabinParts: THREE.Object3D[] = [];
  if (detailed) {
    const windshieldCowl = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.045, 0.075), dark);
    windshieldCowl.position.set(0, isApex ? 0.82 : 0.96, isApex ? -0.935 : -0.755);
    const rearGlassBase = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.045, 0.075), dark);
    rearGlassBase.position.set(0, isApex ? 0.82 : 0.96, isApex ? 1.15 : 0.975);
    const windshieldTopTrim = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.04, 0.07), dark);
    windshieldTopTrim.position.set(0, isApex ? 1.195 : 1.355, isApex ? -0.38 : -0.43);
    const rearGlassTopTrim = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.04, 0.07), dark);
    rearGlassTopTrim.position.set(0, isApex ? 1.195 : 1.355, isApex ? 0.48 : 0.65);
    group.add(windshieldCowl, rearGlassBase, windshieldTopTrim, rearGlassTopTrim);
    exteriorCabinParts.push(windshieldCowl, rearGlassBase, windshieldTopTrim, rearGlassTopTrim);
  }
  for (const side of [-1, 1]) {
    const beltTrim = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, isApex ? 2.03 : 1.72), chrome);
    beltTrim.position.set(side * (isApex ? 0.915 : 0.835), isApex ? 0.81 : 0.94, isApex ? 0.1 : 0.13);
    const aPillar = new THREE.Mesh(new THREE.BoxGeometry(0.06, isApex ? 0.5 : 0.58, 0.075), dark);
    aPillar.position.set(side * (isApex ? 0.84 : 0.79), isApex ? 1.01 : 1.15, isApex ? -0.82 : -0.66);
    aPillar.rotation.x = isApex ? 0.52 : 0.34;
    const bPillar = new THREE.Mesh(new THREE.BoxGeometry(0.055, isApex ? 0.43 : 0.55, 0.075), dark);
    bPillar.position.set(side * (isApex ? 0.89 : 0.81), isApex ? 1.0 : 1.13, isApex ? 0.15 : 0.18);
    const cPillar = new THREE.Mesh(new THREE.BoxGeometry(0.065, isApex ? 0.5 : 0.54, 0.09), dark);
    cPillar.position.set(side * (isApex ? 0.84 : 0.77), isApex ? 1.0 : 1.14, isApex ? 0.84 : 0.72);
    cPillar.rotation.x = isApex ? -0.48 : -0.28;
    const windowTopTrim = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, isApex ? 1.22 : 1.05), dark);
    windowTopTrim.position.set(side * (isApex ? 0.885 : 0.805), isApex ? 1.195 : 1.355, isApex ? 0.1 : 0.13);
    const doorLine = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.018, isApex ? 1.62 : 1.45), dark);
    doorLine.position.set(side * (isApex ? 1.092 : 1.012), isApex ? 0.53 : 0.58, isApex ? 0.12 : 0.18);
    const doorHandle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, 0.25), chrome);
    doorHandle.position.set(side * (isApex ? 1.105 : 1.025), isApex ? 0.72 : 0.8, isApex ? 0.37 : 0.43);
    const sideSkirt = new THREE.Mesh(new THREE.BoxGeometry(isApex ? 0.14 : 0.11, isApex ? 0.1 : 0.12, isApex ? 3.12 : 2.65), carbon);
    sideSkirt.position.set(side * (isApex ? 1.065 : 0.985), isApex ? 0.23 : 0.28, 0.05);
    const sideIntake = new THREE.Mesh(new THREE.BoxGeometry(0.035, isApex ? 0.33 : 0.25, isApex ? 0.66 : 0.48), lightHousing);
    sideIntake.position.set(side * (isApex ? 1.098 : 1.018), isApex ? 0.53 : 0.55, isApex ? 0.98 : 0.9);
    sideIntake.rotation.x = -0.08;
    group.add(beltTrim, aPillar, bPillar, cPillar, windowTopTrim, doorLine, doorHandle, sideSkirt, sideIntake);
    exteriorCabinParts.push(beltTrim, aPillar, bPillar, cPillar, windowTopTrim);

    const mirrorMount = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.055, 0.08), dark);
    mirrorMount.position.set(side * (isApex ? 0.99 : 0.92), isApex ? 0.9 : 1.04, isApex ? -0.68 : -0.53);
    const mirrorHousing = new THREE.Mesh(new THREE.SphereGeometry(0.13, LOW_POWER_MODE ? 16 : 28, LOW_POWER_MODE ? 10 : 18), paint);
    mirrorHousing.position.set(side * (isApex ? 1.12 : 1.04), isApex ? 0.93 : 1.08, isApex ? -0.67 : -0.52);
    mirrorHousing.scale.set(1.15, 0.58, 0.72);
    const mirrorGlass = new THREE.Mesh(new THREE.CircleGeometry(0.087, 16), glass);
    mirrorGlass.position.set(side * (isApex ? 1.2 : 1.118), isApex ? 0.935 : 1.085, isApex ? -0.655 : -0.505);
    mirrorGlass.rotation.y = side * Math.PI / 2;
    mirrorGlass.scale.y = 0.58;
    group.add(mirrorMount, mirrorHousing, mirrorGlass);
  }

  const frontEndZ = isApex ? -2.4 : -2.16;
  const rearEndZ = isApex ? 2.4 : 2.16;
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(isApex ? 2.02 : 1.72, isApex ? 0.09 : 0.12, isApex ? 0.3 : 0.18), dark);
  splitter.position.set(0, isApex ? 0.24 : 0.31, frontEndZ);
  group.add(splitter);

  const frontGrille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.23, 0.055), lightHousing);
  frontGrille.position.set(0, isApex ? 0.42 : 0.48, frontEndZ - 0.065);
  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(isApex ? 1.98 : 1.78, 0.2, 0.13), carbon);
  rearBumper.position.set(0, isApex ? 0.31 : 0.34, rearEndZ);
  group.add(frontGrille, rearBumper);

  if (detailed) {
    for (const x of [-0.48, 0.48]) {
      const hoodVent = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 0.62), carbon);
      hoodVent.position.set(x, isApex ? 0.79 : 0.955, isApex ? -1.45 : -1.22);
      hoodVent.rotation.x = isApex ? -0.055 : -0.035;
      group.add(hoodVent);
    }
  }

  const wheelRadius = isApex ? 0.43 : 0.39;
  const wheelWidth = isApex ? 0.31 : 0.28;
  const rimRadius = wheelRadius * 0.565;
  const rimGeometry = new THREE.CylinderGeometry(rimRadius, rimRadius, wheelWidth + 0.012, VEHICLE_RIM_SEGMENTS);
  const wheels: THREE.Group[] = [];
  const frontWheels: THREE.Group[] = [];
  for (const x of [isApex ? -1.08 : -1.01, isApex ? 1.08 : 1.01]) {
    for (const z of [isApex ? -1.53 : -1.32, isApex ? 1.52 : 1.35]) {
      const steeringPivot = new THREE.Group();
      steeringPivot.position.set(x, wheelRadius + 0.04, z);
      const spinPivot = new THREE.Group();
      const wheel = createRoundedTyre(wheelRadius, wheelWidth, rubber);
      const rim = new THREE.Mesh(rimGeometry, detailed ? gunmetal : chrome);
      rim.rotation.z = Math.PI / 2;
      spinPivot.add(wheel, rim);
      if (detailed) {
        const outward = Math.sign(x) * 0.157;
        const rimLip = new THREE.Mesh(new THREE.TorusGeometry(rimRadius + 0.005, 0.018, 8, 28), chrome);
        rimLip.rotation.y = Math.PI / 2;
        rimLip.position.x = outward;
        const discRadius = wheelRadius * 0.45;
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(discRadius, discRadius, 0.018, LOW_POWER_MODE ? 24 : 40), brakeDisc);
        disc.rotation.z = Math.PI / 2;
        disc.position.x = outward * 0.9;
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.025, LOW_POWER_MODE ? 20 : 32), dark);
        hub.rotation.z = Math.PI / 2;
        hub.position.x = outward * 1.08;
        spinPivot.add(disc, rimLip, hub);
        for (let spokeIndex = 0; spokeIndex < 5; spokeIndex++) {
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.028, rimRadius * 0.93), chrome);
          spoke.position.x = outward * 1.06;
          spoke.rotation.x = (spokeIndex / 5) * Math.PI;
          spinPivot.add(spoke);
        }
        const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.085, 0.055), brakeCaliper);
        caliper.position.set(outward * 0.94, 0.02, -0.145);
        spinPivot.add(caliper);
      }
      steeringPivot.add(spinPivot);
      group.add(steeringPivot);
      wheels.push(spinPivot);
      if (z < 0) frontWheels.push(steeringPivot);
    }
  }

  for (const x of [-0.67, 0.67]) {
    const lightX = x * (isApex ? 1.08 : 1);
    const headHousing = new THREE.Mesh(new THREE.BoxGeometry(isApex ? 0.58 : 0.52, isApex ? 0.16 : 0.21, 0.055), lightHousing);
    headHousing.position.set(lightX, isApex ? 0.6 : 0.69, frontEndZ - 0.02);
    const head = new THREE.Mesh(new THREE.BoxGeometry(isApex ? 0.46 : 0.4, isApex ? 0.045 : 0.07, 0.068), white);
    head.position.set(lightX, isApex ? 0.61 : 0.69, frontEndZ + 0.01);
    const runningLight = new THREE.Mesh(new THREE.BoxGeometry(isApex ? 0.54 : 0.48, 0.035, 0.075), white);
    runningLight.position.set(lightX, isApex ? 0.68 : 0.78, frontEndZ - 0.01);
    runningLight.rotation.z = x < 0 ? -0.09 : 0.09;
    const tailHousing = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.19, 0.055), lightHousing);
    tailHousing.position.set(lightX, isApex ? 0.62 : 0.7, rearEndZ + 0.03);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.055, 0.07), red);
    tail.position.set(lightX, isApex ? 0.64 : 0.72, rearEndZ + 0.065);
    const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, 0.075), amber);
    indicator.position.set(lightX + Math.sign(x) * 0.17, isApex ? 0.58 : 0.66, rearEndZ + 0.066);
    group.add(headHousing, head, runningLight, tailHousing, tail, indicator);
  }

  const rearLightBar = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.035, 0.065), red);
  rearLightBar.position.set(0, isApex ? 0.64 : 0.72, rearEndZ + 0.062);
  group.add(rearLightBar);

  if (detailed) {
    if (appearance.spoiler && !isApex) {
      const spoiler = roundedBox(1.62, 0.075, 0.28, 0.07, carbon);
      spoiler.position.set(0, 1.08, 1.91);
      spoiler.rotation.x = -0.06;
      group.add(spoiler);
      for (const x of [-0.55, 0.55]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.32, 0.075), carbon);
        strut.position.set(x, 0.9, 1.9);
        const endPlate = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.2, 0.34), carbon);
        endPlate.position.set(x * 1.42, 1.08, 1.91);
        group.add(strut, endPlate);
      }
    }

    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.13, 0.28), carbon);
    diffuser.position.set(0, isApex ? 0.22 : 0.255, rearEndZ + 0.02);
    group.add(diffuser);
    for (const x of [-0.55, -0.28, 0, 0.28, 0.55]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.18, 0.3), carbon);
      fin.position.set(x, isApex ? 0.19 : 0.22, rearEndZ + 0.06);
      group.add(fin);
    }

    for (const x of [-0.67, 0.67]) {
      const exhaustOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 20), chrome);
      exhaustOuter.rotation.x = Math.PI / 2;
      exhaustOuter.position.set(x, isApex ? 0.27 : 0.3, rearEndZ + 0.11);
      const exhaustInner = new THREE.Mesh(new THREE.CylinderGeometry(0.067, 0.067, 0.19, 18), dark);
      exhaustInner.rotation.x = Math.PI / 2;
      exhaustInner.position.set(x, isApex ? 0.27 : 0.3, rearEndZ + 0.125);
      group.add(exhaustOuter, exhaustInner);
    }

    const plateCanvas = document.createElement('canvas');
    plateCanvas.width = 384;
    plateCanvas.height = 128;
    const plateContext = plateCanvas.getContext('2d')!;
    plateContext.fillStyle = '#e9eee9';
    plateContext.fillRect(0, 0, 384, 128);
    plateContext.strokeStyle = '#17201e';
    plateContext.lineWidth = 9;
    plateContext.strokeRect(5, 5, 374, 118);
    plateContext.fillStyle = '#15201e';
    plateContext.font = '800 64px Arial';
    plateContext.textAlign = 'center';
    plateContext.textBaseline = 'middle';
    plateContext.fillText('VD · 09', 192, 68);
    const plateTexture = new THREE.CanvasTexture(plateCanvas);
    plateTexture.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.18),
      new THREE.MeshBasicMaterial({ map: plateTexture, toneMapped: false }),
    );
    plate.position.set(0, isApex ? 0.47 : 0.51, rearEndZ + 0.078);

    const rearBadge = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 20), chrome);
    rearBadge.position.set(0, isApex ? 0.75 : 0.85, rearEndZ + 0.062);
    const badgeSlashLeft = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.09, 0.018), chrome);
    badgeSlashLeft.position.set(-0.021, isApex ? 0.75 : 0.85, rearEndZ + 0.075);
    badgeSlashLeft.rotation.z = -0.3;
    const badgeSlashRight = badgeSlashLeft.clone();
    badgeSlashRight.position.x = 0.021;
    badgeSlashRight.rotation.z = 0.3;

    group.add(plate, rearBadge, badgeSlashLeft, badgeSlashRight);
    if (player) {
      const cockpit = createCockpit();
      group.add(cockpit);
      group.userData.cockpit = cockpit;
    }
  }

  if (appearance.model === 'apex-r') {
    const noseWedge = roundedBox(2.08, 0.09, 1.28, 0.2, paint);
    noseWedge.position.set(0, 0.65, -1.82);
    noseWedge.rotation.x = -0.08;
    const wingBlade = roundedBox(1.94, 0.065, 0.36, 0.08, carbon);
    wingBlade.position.set(0, 1.04, 2.12);
    wingBlade.rotation.x = -0.06;
    group.add(noseWedge, wingBlade);
    for (const x of [-0.62, 0.62]) {
      const wingStrut = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.075), carbon);
      wingStrut.position.set(x, 0.85, 2.08);
      const wingEndPlate = roundedBox(0.05, 0.22, 0.42, 0.035, carbon);
      wingEndPlate.position.set(x * 1.48, 1.04, 2.12);
      group.add(wingStrut, wingEndPlate);
    }
    for (const side of [-1, 1]) {
      const canard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.16), carbon);
      canard.position.set(side * 0.86, 0.34, -2.43);
      canard.rotation.y = side * -0.2;
      const rearIntakeBlade = roundedBox(0.055, 0.27, 0.52, 0.025, carbon);
      rearIntakeBlade.position.set(side * 1.105, 0.58, 1.02);
      rearIntakeBlade.rotation.x = -0.1;
      group.add(canard, rearIntakeBlade);
    }
    const centerBlade = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.022, 1.42), carbon);
    centerBlade.position.set(0, 0.79, -1.48);
    group.add(centerBlade);
  } else if (appearance.model === 'ridge-x') {
    group.userData.rideHeight = 0.11;
    const suvCabin = roundedBox(1.88, 0.78, 2.35, 0.2, paint);
    suvCabin.position.set(0, 1.13, 0.2);
    const suvGlass = roundedBox(1.76, 0.56, 2.0, 0.16, glass);
    suvGlass.position.set(0, 1.42, 0.12);
    const suvRoof = roundedBox(1.9, 0.12, 2.32, 0.12, carbon);
    suvRoof.position.set(0, 1.79, 0.18);
    group.add(suvCabin, suvGlass, suvRoof);
    for (const z of [-0.28, 0.5]) {
      const rackBar = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.055, 0.075), carbon);
      rackBar.position.set(0, 1.9, z);
      group.add(rackBar);
    }
    for (const x of [-0.48, -0.16, 0.16, 0.48]) {
      const rallyLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16), white);
      rallyLamp.rotation.x = Math.PI / 2;
      rallyLamp.position.set(x, 1.92, -0.38);
      group.add(rallyLamp);
    }
    const spareTyre = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.12, 12, 24), rubber);
    spareTyre.position.set(0, 0.91, 2.3);
    group.add(spareTyre);
    for (const x of [-0.88, 0.88]) {
      for (const z of [-1.55, 1.58]) {
        const mudFlap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.035), rubber);
        mudFlap.position.set(x, 0.24, z);
        group.add(mudFlap);
      }
    }
  } else if (appearance.model === 'touring-s') {
    roof.position.y = 1.42;
    const wagonBody = roundedBox(1.74, 0.62, 2.25, 0.2, paint);
    wagonBody.position.set(0, 1.08, 0.65);
    const wagonGlass = roundedBox(1.62, 0.45, 1.88, 0.15, glass);
    wagonGlass.position.set(0, 1.32, 0.48);
    const wagonRoof = roundedBox(1.7, 0.09, 2.3, 0.12, paint);
    wagonRoof.position.set(0, 1.62, 0.42);
    group.add(wagonBody, wagonGlass, wagonRoof);
    const deckTrim = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.045, 0.08), chrome);
    deckTrim.position.set(0, 0.96, 1.82);
    group.add(deckTrim);
    for (const side of [-1, 1]) {
      const lowerChrome = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 2.45), chrome);
      lowerChrome.position.set(side * 0.99, 0.37, 0.05);
      group.add(lowerChrome);
    }
  }

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  group.userData.wheels = wheels;
  group.userData.frontWheels = frontWheels;
  group.userData.firstPersonHidden = group.children.filter(child => child !== group.userData.cockpit);
  group.userData.appearance = appearance;
  group.userData.wheelRadius = wheelRadius;
  group.userData.cameraProfile = {
    height: isApex ? 1.15 : 1.27,
    forwardOffset: isApex ? -0.5 : -0.42,
    sideOffset: -0.38,
    chaseHeight: appearance.model === 'ridge-x' ? 4.15 : 3.65,
    chaseDistance: appearance.model === 'touring-s' ? 8.1 : 7.4,
    lookHeight: 1.05,
  } satisfies CameraProfile;
  return group;
}

function makeRoadGeometry(startZ: number) {
  const segments = LOW_POWER_MODE ? 22 : 38;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const z = startZ - (i / segments) * CHUNK_LENGTH;
    const center = roadCenter(z);
    const angle = roadTangent(z);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    for (const side of [-1, 1]) {
      positions.push(center + nx * ROAD_WIDTH * 0.5 * side, 0.025, z + nz * ROAD_WIDTH * 0.5 * side);
      uvs.push(side < 0 ? 0 : 1, i / segments * 7);
    }
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeMarkingGeometry(startZ: number, offset: number, width = 0.11, dash = false) {
  const positions: number[] = [];
  const indices: number[] = [];
  const count = LOW_POWER_MODE ? (dash ? 12 : 32) : (dash ? 18 : 55);
  for (let i = 0; i < count; i++) {
    if (dash && i % 2) continue;
    const z1 = startZ - (i / count) * CHUNK_LENGTH;
    const z2 = z1 - (CHUNK_LENGTH / count) * (dash ? 0.55 : 1.02);
    const a1 = roadTangent(z1);
    const a2 = roadTangent(z2);
    const x1 = roadCenter(z1) + Math.cos(a1) * offset;
    const zz1 = z1 + Math.sin(a1) * offset;
    const x2 = roadCenter(z2) + Math.cos(a2) * offset;
    const zz2 = z2 + Math.sin(a2) * offset;
    const dx = x2 - x1;
    const dz = zz2 - zz1;
    const length = Math.hypot(dx, dz) || 1;
    const nx = (-dz / length) * width * 0.5;
    const nz = (dx / length) * width * 0.5;
    const base = positions.length / 3;
    positions.push(
      x1 - nx, 0.045, zz1 - nz,
      x1 + nx, 0.045, zz1 + nz,
      x2 - nx, 0.045, zz2 - nz,
      x2 + nx, 0.045, zz2 + nz,
    );
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color: offset === 0 ? 0xe3bb63 : 0xe9e7d8,
    fog: true,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

function makeMountainGeometry(seed: number) {
  const rng = mulberry32(seed);
  const segments = LOW_POWER_MODE ? 8 : 12;
  const rings = [
    { y: 0, radius: 1, offsetX: 0, offsetZ: 0 },
    { y: 0.32, radius: 0.74, offsetX: (rng() - 0.5) * 0.12, offsetZ: (rng() - 0.5) * 0.12 },
    { y: 0.64, radius: 0.39, offsetX: (rng() - 0.5) * 0.16, offsetZ: (rng() - 0.5) * 0.16 },
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const irregularity = 0.82 + rng() * 0.3;
      positions.push(
        ring.offsetX + Math.cos(angle) * ring.radius * irregularity,
        ring.y + (rng() - 0.5) * 0.035,
        ring.offsetZ + Math.sin(angle) * ring.radius * irregularity,
      );
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const a = ring * segments + i;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + i;
      const d = (ring + 1) * segments + next;
      indices.push(a, b, c, b, d, c);
    }
  }
  const peakIndex = positions.length / 3;
  positions.push((rng() - 0.5) * 0.16, 1, (rng() - 0.5) * 0.16);
  const topRingStart = (rings.length - 1) * segments;
  for (let i = 0; i < segments; i++) {
    indices.push(topRingStart + i, topRingStart + ((i + 1) % segments), peakIndex);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const faceted = geometry.toNonIndexed();
  geometry.dispose();
  faceted.computeVertexNormals();
  return faceted;
}

type WorldChunk = { index: number; group: THREE.Group };
type SandTextures = {
  diffuse: THREE.Texture;
  normal?: THREE.Texture;
  roughness?: THREE.Texture;
};
type EnvironmentSurface = {
  diffuse: THREE.Texture;
  normal?: THREE.Texture;
};
type RemoteCarRender = {
  car: THREE.Group;
  target: NetworkPlayerState;
  appearanceKey: string;
};

function createStarField() {
  const rng = mulberry32(90731);
  const positions: number[] = [];
  const count = LOW_POWER_MODE ? 110 : 260;
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 330 + rng() * 470;
    positions.push(
      Math.cos(angle) * radius,
      95 + Math.pow(rng(), 0.58) * 390,
      Math.sin(angle) * radius,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xeaf2ff,
    size: LOW_POWER_MODE ? 1.45 : 1.7,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(geometry, material);
  stars.frustumCulled = false;
  return stars;
}

function createMoonGlow() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const glow = context.createRadialGradient(64, 64, 15, 64, 64, 62);
  glow.addColorStop(0, 'rgba(213, 228, 255, 0.68)');
  glow.addColorStop(0.32, 'rgba(176, 205, 255, 0.28)');
  glow.addColorStop(1, 'rgba(135, 173, 235, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(43, 43, 1);
  return sprite;
}

export class GameRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(57, 1, 0.1, 1100);
  readonly renderer: THREE.WebGLRenderer;
  playerCar: THREE.Group;
  readonly trafficCars = new Map<number, THREE.Group>();
  readonly remoteCars = new Map<string, RemoteCarRender>();
  readonly chunks: WorldChunk[] = [];
  readonly lowPower = LOW_POWER_MODE;
  private playerVisible = true;
  private composer: EffectComposer | null = null;
  private cameraMode = 0;
  private cameraSnap = true;
  private cameraPosition = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3();
  private sun: THREE.Mesh;
  private moonGlow: THREE.Sprite;
  private stars: THREE.Points;
  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private readonly headLights: THREE.SpotLight[] = [];
  private readonly headLightTargets: THREE.Object3D[] = [];
  private timeIndex = 1;
  private seasonIndex = 1;
  private worldMap: WorldMapId = 'mountain';
  private sandTextures: SandTextures;
  private readonly environmentTextureCache = new Map<string, THREE.Texture>();
  private readonly timeSettings = [
    { name: '새벽', sky: 0x74889a, fog: 0x8798a0, density: 0.0052, hemiSky: 0x9cb8c9, hemiGround: 0x343c43, hemi: 1.35, key: 0xffb37f, keyPower: 3.1, exposure: 0.88, sun: 0xffbd86, sunOffset: [-115, 28, -340] },
    { name: '낮', sky: 0x9db4a5, fog: 0x9eb1a4, density: 0.0047, hemiSky: 0xc8e1d4, hemiGround: 0x46513d, hemi: 2.1, key: 0xffd5a0, keyPower: 4.6, exposure: 1.08, sun: 0xffe1ac, sunOffset: [-145, 85, -360] },
    { name: '노을', sky: 0xc47b5e, fog: 0xa87966, density: 0.0054, hemiSky: 0xe3a179, hemiGround: 0x493c3d, hemi: 1.45, key: 0xff7b45, keyPower: 4.1, exposure: 0.94, sun: 0xff8a4c, sunOffset: [125, 24, -330] },
    { name: '밤', sky: 0x17263d, fog: 0x22354a, density: 0.0057, hemiSky: 0x6e89aa, hemiGround: 0x202d3a, hemi: 1.02, key: 0xb9ceff, keyPower: 1.56, exposure: 0.82, sun: 0xe3ecff, sunOffset: [-110, 62, -360] },
  ];
  private readonly seasonSettings = [
    { name: '봄', ground: [0x6b8058, 0x72885e], shoulder: 0xa99d7d, leaves: [0x416a43, 0x568052, 0x78965e], hills: [0x60765c, 0x526950], rock: 0x77786d },
    { name: '여름', ground: [0x4f6048, 0x53634b], shoulder: 0x9b9277, leaves: [0x263c30, 0x314936, 0x3c503a], hills: [0x46594e, 0x526457], rock: 0x697067 },
    { name: '가을', ground: [0x756843, 0x7d7048], shoulder: 0xa48b68, leaves: [0x7b3f25, 0xa45f2f, 0xc58a3a], hills: [0x6f5b3e, 0x7d6744], rock: 0x776b5c },
    { name: '겨울', ground: [0xbfc7be, 0xcbd1c8], shoulder: 0xe0ded1, leaves: [0x354b46, 0x405752, 0x536762], hills: [0x8e9a95, 0xa5afaa], rock: 0x8a908d },
  ];

  constructor(canvas: HTMLCanvasElement) {
    this.playerCar = createCar(DEFAULT_CUSTOMIZATION.color, true, DEFAULT_CUSTOMIZATION);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !VERY_LOW_END, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(LOW_POWER_MODE ? LOW_POWER_PIXEL_RATIO : Math.min(devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = !LOW_POWER_MODE;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.sandTextures = this.loadSandTextures();

    this.scene.background = new THREE.Color(0x9db4a5);
    this.scene.fog = new THREE.FogExp2(0x9eb1a4, 0.0047);

    this.hemiLight = new THREE.HemisphereLight(0xc8e1d4, 0x46513d, 2.1);
    this.scene.add(this.hemiLight);
    this.keyLight = new THREE.DirectionalLight(0xffd5a0, 4.6);
    this.keyLight.position.set(-50, 82, 32);
    this.keyLight.castShadow = !LOW_POWER_MODE;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.left = -55;
    this.keyLight.shadow.camera.right = 55;
    this.keyLight.shadow.camera.top = 55;
    this.keyLight.shadow.camera.bottom = -55;
    this.keyLight.shadow.camera.far = 220;
    this.keyLight.shadow.bias = -0.0002;
    this.scene.add(this.keyLight);

    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffe1ac, fog: false });
    this.sun = new THREE.Mesh(new THREE.CircleGeometry(11, LOW_POWER_MODE ? 20 : 40), sunMaterial);
    this.scene.add(this.sun);
    this.moonGlow = createMoonGlow();
    this.scene.add(this.moonGlow);
    this.stars = createStarField();
    this.scene.add(this.stars);
    const headLightCount = LOW_POWER_MODE ? 1 : 2;
    for (let i = 0; i < headLightCount; i++) {
      const light = new THREE.SpotLight(
        0xfff0cf,
        LOW_POWER_MODE ? 78 : 54,
        LOW_POWER_MODE ? 66 : 78,
        THREE.MathUtils.degToRad(LOW_POWER_MODE ? 29 : 23),
        0.72,
        1.28,
      );
      light.castShadow = false;
      const target = new THREE.Object3D();
      light.target = target;
      this.scene.add(light, target);
      this.headLights.push(light);
      this.headLightTargets.push(target);
    }
    this.applyTimeSetting();

    this.scene.add(this.playerCar);
    const roadMaterial = worldMaterial({ color: 0x343b39, roughness: 0.92, metalness: 0.02 });
    this.scene.userData.roadMaterial = roadMaterial;
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const group = new THREE.Group();
      this.scene.add(group);
      this.chunks.push({ index: Number.NaN, group });
    }

    if (!LOW_POWER_MODE) void this.initPostProcessing();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private loadSandTextures(): SandTextures {
    const loader = new THREE.TextureLoader();
    const anisotropy = Math.min(LOW_POWER_MODE ? 4 : 8, this.renderer.capabilities.getMaxAnisotropy());
    const load = (filename: string, color = false) => {
      const texture = loader.load(new URL(`textures/${filename}`, document.baseURI).href);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      // 78 repeats across a 140 m chunk keeps both ends on the same UV phase.
      texture.repeat.set(140, 78);
      texture.anisotropy = anisotropy;
      if (color) texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    };
    return {
      diffuse: load('dense-sand-diffuse-2k.webp', true),
      normal: VERY_LOW_END ? undefined : load('dense-sand-normal-1k.webp'),
      roughness: LOW_POWER_MODE ? undefined : load('dense-sand-roughness-1k.webp'),
    };
  }

  private loadEnvironmentSurface(
    prefix: string,
    repeatX = 1,
    repeatY = 1,
    useNormal = true,
  ): EnvironmentSurface {
    const load = (kind: 'diffuse' | 'normal', color: boolean) => {
      const filename = `${prefix}-${kind}-1k.webp`;
      const cacheKey = `${filename}:${repeatX}:${repeatY}`;
      const cached = this.environmentTextureCache.get(cacheKey);
      if (cached) return cached;
      const texture = new THREE.TextureLoader().load(
        new URL(`textures/environment/${filename}`, document.baseURI).href,
      );
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeatX, repeatY);
      texture.anisotropy = Math.min(
        LOW_POWER_MODE ? 4 : 8,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      if (color) texture.colorSpace = THREE.SRGBColorSpace;
      this.environmentTextureCache.set(cacheKey, texture);
      return texture;
    };
    return {
      diffuse: load('diffuse', true),
      normal: useNormal && !VERY_LOW_END ? load('normal', false) : undefined,
    };
  }

  private async initPostProcessing() {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js'),
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
    ]);
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.5, 0.89));
    this.composer = composer;
    this.resize();
  }

  setTraffic(traffic: TrafficState[]) {
    for (const state of traffic.slice(0, TRAFFIC_RENDER_LIMIT)) {
      this.ensureTrafficCar(state);
    }
  }

  private ensureTrafficCar(state: TrafficState) {
    const existing = this.trafficCars.get(state.id);
    const existingAppearance = existing?.userData.appearance as CarCustomization | undefined;
    if (existing && existingAppearance?.model === state.model) return existing;
    if (existing) {
      this.scene.remove(existing);
      this.disposeCar(existing);
      this.trafficCars.delete(state.id);
    }
    const appearance: CarCustomization = {
      ...DEFAULT_CUSTOMIZATION,
      model: state.model,
      color: state.color,
      spoiler: state.model === 'apex-r',
    };
    // Modern phones and tablets can render the regular vehicle silhouettes.
    // Reserve the boxy fallback for genuinely constrained devices only.
    const car = VERY_LOW_END
      ? createLightweightTrafficCar(state.color, state.model)
      : createCar(state.color, false, appearance);
    car.scale.setScalar(VERY_LOW_END ? 1.02 : 0.94 + (state.id % 3) * 0.025);
    this.scene.add(car);
    this.trafficCars.set(state.id, car);
    return car;
  }

  setTrafficEnabled(enabled: boolean) {
    for (const car of this.trafficCars.values()) car.visible = enabled;
  }

  setPlayerCustomization(customization: CarCustomization) {
    const previous = this.playerCar;
    const position = previous.position.clone();
    const rotation = previous.rotation.clone();
    this.scene.remove(previous);
    this.disposeCar(previous);
    this.playerCar = createCar(customization.color, true, customization);
    this.playerCar.position.copy(position);
    this.playerCar.rotation.copy(rotation);
    this.playerCar.visible = this.playerVisible;
    this.scene.add(this.playerCar);
  }

  setPlayerVisible(visible: boolean) {
    this.playerVisible = visible;
    this.playerCar.visible = visible;
  }

  setRemotePlayers(players: NetworkPlayerState[]) {
    const activeIds = new Set(players.map(player => player.id));
    for (const state of players) {
      const appearanceKey = JSON.stringify(state.appearance);
      const existing = this.remoteCars.get(state.id);
      if (!existing || existing.appearanceKey !== appearanceKey) {
        if (existing) {
          this.scene.remove(existing.car);
          this.disposeCar(existing.car);
        }
        const car = createCar(state.appearance.color, false, state.appearance);
        const rideHeight = (car.userData.rideHeight as number | undefined) ?? 0;
        car.position.set(state.x, 0.04 + rideHeight, state.z);
        car.rotation.y = -state.heading;
        this.scene.add(car);
        this.remoteCars.set(state.id, { car, target: state, appearanceKey });
      } else {
        existing.target = state;
      }
    }
    for (const [id, entry] of this.remoteCars) {
      if (activeIds.has(id)) continue;
      this.scene.remove(entry.car);
      this.disposeCar(entry.car);
      this.remoteCars.delete(id);
    }
  }

  private disposeCar(car: THREE.Group) {
    car.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const map = (material as THREE.MeshStandardMaterial).map;
        map?.dispose();
        material.dispose();
      }
    });
  }

  cycleCamera() {
    this.cameraMode = (this.cameraMode + 1) % 3;
    this.cameraSnap = true;
  }

  resetCamera() {
    this.cameraMode = 0;
    this.cameraSnap = true;
  }

  cycleTime() {
    this.timeIndex = (this.timeIndex + 1) % this.timeSettings.length;
    this.applyTimeSetting();
    return this.timeSettings[this.timeIndex].name;
  }

  cycleSeason() {
    this.seasonIndex = (this.seasonIndex + 1) % this.seasonSettings.length;
    for (const chunk of this.chunks) chunk.index = Number.NaN;
    return this.seasonSettings[this.seasonIndex].name;
  }

  setWorldMap(map: WorldMapId) {
    if (this.worldMap === map) return;
    this.worldMap = map;
    for (const chunk of this.chunks) chunk.index = Number.NaN;
    this.applyTimeSetting();
  }

  private applyTimeSetting() {
    const setting = this.timeSettings[this.timeIndex];
    const atmosphere = WORLD_MAP_ATMOSPHERE[this.worldMap];
    const atmosphereBlend = this.timeIndex === 3 ? atmosphere.blend * 0.22 : atmosphere.blend;
    (this.scene.background as THREE.Color)
      .setHex(setting.sky)
      .lerp(new THREE.Color(atmosphere.sky), atmosphereBlend);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setHex(setting.fog).lerp(new THREE.Color(atmosphere.fog), atmosphereBlend);
    fog.density = setting.density * atmosphere.fogMultiplier;
    this.hemiLight.color.setHex(setting.hemiSky);
    this.hemiLight.groundColor.setHex(setting.hemiGround);
    this.hemiLight.intensity = setting.hemi;
    this.keyLight.color.setHex(setting.key);
    this.keyLight.intensity = setting.keyPower;
    this.renderer.toneMappingExposure = setting.exposure;
    (this.sun.material as THREE.MeshBasicMaterial).color.setHex(setting.sun);
    this.sun.scale.setScalar(this.timeIndex === 3 ? 0.62 : 1);
    const night = this.timeIndex === 3;
    this.moonGlow.visible = night;
    this.stars.visible = night;
    for (const light of this.headLights) light.visible = night;
  }

  private rebuildChunk(chunk: WorldChunk, index: number) {
    chunk.index = index;
    while (chunk.group.children.length) {
      const child = chunk.group.children.pop();
      if (!child) continue;
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const material of materials) {
            if (material !== this.scene.userData.roadMaterial) material.dispose();
          }
        }
      });
    }
    const startZ = -index * CHUNK_LENGTH + CHUNK_LENGTH;
    const centerZ = startZ - CHUNK_LENGTH / 2;
    const centerX = roadCenter(centerZ);
    const rng = mulberry32(index * 9187 + 41);
    const season = this.seasonSettings[this.seasonIndex];
    const palette: WorldPalette = this.worldMap === 'mountain'
      ? season
      : WORLD_MAP_PALETTES[this.worldMap];

    // Ground chunks must meet edge-to-edge. The former 3 m overlap placed two
    // differently colored coplanar surfaces on top of each other, causing the
    // horizontal z-fighting bands visible while driving.
    const groundColor = new THREE.Color(palette.ground[0])
      .lerp(new THREE.Color(palette.ground[1] ?? palette.ground[0]), 0.5);
    const desertGround = this.worldMap === 'desert';
    const seasonalGroundPrefix = this.worldMap === 'mountain'
      ? (this.seasonIndex === 2
          ? 'autumn-leaves'
          : this.seasonIndex === 3
            ? 'snow-ground'
            : 'grass-ground')
      : null;
    const seasonalGround = seasonalGroundPrefix
      ? this.loadEnvironmentSurface(seasonalGroundPrefix, 70, 40)
      : null;
    const seasonalGroundColor = seasonalGroundPrefix === 'grass-ground'
      ? 0x91ad73
      : 0xffffff;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(250, CHUNK_LENGTH),
      worldMaterial({
        color: desertGround ? 0xffffff : seasonalGround ? seasonalGroundColor : groundColor,
        map: desertGround ? this.sandTextures.diffuse : seasonalGround?.diffuse,
        normalMap: desertGround ? this.sandTextures.normal : seasonalGround?.normal,
        normalScale: desertGround && this.sandTextures.normal
          ? new THREE.Vector2(0.38, 0.38)
          : seasonalGround?.normal
            ? new THREE.Vector2(0.32, 0.32)
            : undefined,
        roughness: desertGround ? 0.96 : 1,
        roughnessMap: desertGround ? this.sandTextures.roughness : undefined,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(centerX, -0.13, centerZ);
    ground.receiveShadow = true;
    chunk.group.add(ground);

    const road = new THREE.Mesh(makeRoadGeometry(startZ), this.scene.userData.roadMaterial as THREE.Material);
    road.receiveShadow = true;
    chunk.group.add(road);
    chunk.group.add(makeMarkingGeometry(startZ, 0, 0.13, true));
    chunk.group.add(makeMarkingGeometry(startZ, -3.75, 0.1));
    chunk.group.add(makeMarkingGeometry(startZ, 3.75, 0.1));

    // Roadside reflector posts replace the old flat shoulder blocks.
    const postCount = LOW_POWER_MODE ? 20 : 36;
    const posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.13, 0.9, 0.13),
      worldMaterial({ color: palette.shoulder, roughness: 0.72 }),
      postCount,
    );
    const reflectors = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.18, 0.16, 0.07),
      worldMaterial({ color: 0xffd8a0, emissive: 0xff6b24, emissiveIntensity: 1.8, roughness: 0.32 }),
      postCount,
    );
    const dummy = new THREE.Object3D();
    let postIndex = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < postCount / 2; i++) {
        const z = startZ - ((i + 0.5) / (postCount / 2)) * CHUNK_LENGTH;
        const angle = roadTangent(z);
        const x = roadCenter(z) + side * 4.65;
        dummy.position.set(x, 0.32, z);
        dummy.rotation.set(0, -angle, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        posts.setMatrixAt(postIndex, dummy.matrix);
        dummy.position.y = 0.72;
        dummy.updateMatrix();
        reflectors.setMatrixAt(postIndex, dummy.matrix);
        postIndex++;
      }
    }
    posts.castShadow = true;
    posts.receiveShadow = true;
    reflectors.castShadow = true;
    chunk.group.add(posts, reflectors);

    const trees: Array<{ x: number; z: number; scale: number; rotation: number; color: number }> = [];
    const rocks: Array<{ x: number; z: number; scale: number; rotation: number }> = [];
    const propCount = this.worldMap === 'city'
      ? (LOW_POWER_MODE ? 14 : 24)
      : (LOW_POWER_MODE ? 22 : 40);
    for (let i = 0; i < propCount; i++) {
      const z = startZ - rng() * CHUNK_LENGTH;
      const side = rng() < 0.5 ? -1 : 1;
      const dist = 9 + rng() * 72;
      const x = roadCenter(z) + side * dist;
      const propRoll = rng();
      if (this.worldMap === 'mountain' && propRoll < 0.78) {
        trees.push({ x, z, scale: 0.72 + rng() * 1.55, rotation: rng() * Math.PI, color: Math.floor(rng() * palette.leaves.length) });
      } else if (this.worldMap === 'city' && propRoll < 0.42) {
        trees.push({ x, z, scale: 0.55 + rng() * 0.7, rotation: rng() * Math.PI, color: Math.floor(rng() * palette.leaves.length) });
      } else if (this.worldMap !== 'city') {
        rocks.push({ x, z, scale: 0.8 + rng() * 2.35, rotation: rng() * Math.PI * 2 });
      }
    }

    const trunkPrefix = this.worldMap === 'mountain' && this.seasonIndex === 3
      ? 'dead-tree'
      : 'jacaranda-trunk';
    const trunkSurface = trees.length
      ? this.loadEnvironmentSurface(trunkPrefix, 2, 2, false)
      : null;
    const crownPrefix = this.worldMap === 'city'
      ? 'jacaranda-leaves'
      : this.seasonIndex === 3
        ? 'winter-tree'
        : 'searsia-leaves';
    const crownSurface = trees.length
      ? this.loadEnvironmentSurface(crownPrefix, 2, 2, false)
      : null;
    const trunkGeometry = new THREE.CylinderGeometry(0.19, 0.34, 2.8, LOW_POWER_MODE ? 6 : 9);
    const trunkMaterial = worldMaterial({ color: 0x765f48, map: trunkSurface?.diffuse, roughness: 0.96 });
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
    const crownGeometry = new THREE.ConeGeometry(1, 1, LOW_POWER_MODE ? 7 : 11, LOW_POWER_MODE ? 1 : 2);
    const crownMaterial = worldMaterial({ color: 0xffffff, map: crownSurface?.diffuse, roughness: 0.9, flatShading: true });
    const crownLayers = [
      new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length),
      new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length),
      ...(!LOW_POWER_MODE ? [new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length)] : []),
    ];
    const layerShape = [
      { y: 2.55, radius: 1.48, height: 2.25 },
      { y: 3.55, radius: 1.14, height: 2.05 },
      { y: 4.45, radius: 0.78, height: 1.72 },
    ];
    trees.forEach((tree, i) => {
      dummy.position.set(tree.x, 1.32 * tree.scale, tree.z);
      dummy.rotation.set(0, tree.rotation, 0);
      dummy.scale.set(tree.scale, tree.scale, tree.scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      crownLayers.forEach((layer, layerIndex) => {
        const shape = layerShape[layerIndex];
        dummy.position.set(tree.x, shape.y * tree.scale, tree.z);
        dummy.rotation.set(0, tree.rotation + layerIndex * 0.34, 0);
        dummy.scale.set(shape.radius * tree.scale, shape.height * tree.scale, shape.radius * tree.scale);
        dummy.updateMatrix();
        layer.setMatrixAt(i, dummy.matrix);
        const color = new THREE.Color(palette.leaves[(tree.color + layerIndex) % palette.leaves.length]);
        color.multiplyScalar(0.88 + layerIndex * 0.055);
        layer.setColorAt(i, color);
      });
    });
    trunks.castShadow = true;
    trunks.receiveShadow = true;
    for (const layer of crownLayers) {
      layer.castShadow = true;
      layer.receiveShadow = true;
      if (layer.instanceColor) layer.instanceColor.needsUpdate = true;
    }
    chunk.group.add(trunks, ...crownLayers);

    const rockPieces = LOW_POWER_MODE ? 1 : 2;
    const rockCount = rocks.length * rockPieces;
    const rockPrefixes = this.worldMap === 'desert'
      ? ['desert-cliff', 'boulder-namaqualand-05', 'boulder-01', 'boulder-namaqualand-03']
      : ['mountain-cliff', 'boulder-01', 'boulder-namaqualand-03', 'boulder-namaqualand-05'];
    const rockSurface = rocks.length
      ? this.loadEnvironmentSurface(
          rockPrefixes[((index % rockPrefixes.length) + rockPrefixes.length) % rockPrefixes.length],
          2,
          2,
        )
      : null;
    const rockClusters = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, LOW_POWER_MODE ? 0 : 1),
      worldMaterial({
        color: 0xffffff,
        map: rockSurface?.diffuse,
        normalMap: rockSurface?.normal,
        normalScale: rockSurface?.normal ? new THREE.Vector2(0.42, 0.42) : undefined,
        roughness: 0.94,
        flatShading: true,
      }),
      rockCount,
    );
    rocks.forEach((rock, i) => {
      for (let piece = 0; piece < rockPieces; piece++) {
        const scale = rock.scale * (piece ? 0.52 : 1);
        dummy.position.set(rock.x + piece * scale * 0.9, scale * 0.42 - 0.08, rock.z + piece * scale * 0.45);
        dummy.rotation.set(rock.rotation * 0.3, rock.rotation + piece, rock.rotation * 0.18);
        dummy.scale.set(scale, scale * (0.58 + piece * 0.1), scale * 0.82);
        dummy.updateMatrix();
        rockClusters.setMatrixAt(i * rockPieces + piece, dummy.matrix);
      }
    });
    rockClusters.castShadow = true;
    rockClusters.receiveShadow = true;
    chunk.group.add(rockClusters);

    const shrubCount = this.worldMap === 'city'
      ? (LOW_POWER_MODE ? 5 : 10)
      : (LOW_POWER_MODE ? 8 : 18);
    const shrubPrefix = this.seasonIndex === 3 ? 'winter-tree' : 'searsia-leaves';
    const shrubSurface = this.loadEnvironmentSurface(shrubPrefix, 2, 2, false);
    const shrubs = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.55, LOW_POWER_MODE ? 0 : 1),
      worldMaterial({ color: palette.leaves[1], map: shrubSurface.diffuse, roughness: 1, flatShading: true }),
      shrubCount,
    );
    for (let i = 0; i < shrubCount; i++) {
      const z = startZ - rng() * CHUNK_LENGTH;
      const side = rng() < 0.5 ? -1 : 1;
      const x = roadCenter(z) + side * (6.5 + rng() * 30);
      const scale = 0.45 + rng() * 0.9;
      dummy.position.set(x, scale * 0.32, z);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.scale.set(scale * 1.25, scale * 0.7, scale);
      dummy.updateMatrix();
      shrubs.setMatrixAt(i, dummy.matrix);
    }
    shrubs.castShadow = true;
    shrubs.receiveShadow = true;
    chunk.group.add(shrubs);

    if (this.worldMap === 'city') {
      const buildingCount = LOW_POWER_MODE ? 14 : 24;
      const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
      const buildingSurface = this.loadEnvironmentSurface(index % 2 ? 'red-brick' : 'stone-wall', 3, 5);
      const buildings = new THREE.InstancedMesh(
        buildingGeometry,
        worldMaterial({
          color: 0xffffff,
          map: buildingSurface.diffuse,
          normalMap: buildingSurface.normal,
          normalScale: buildingSurface.normal ? new THREE.Vector2(0.3, 0.3) : undefined,
          roughness: 0.88,
          metalness: 0.05,
        }),
        buildingCount,
      );
      const windowPanels = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        worldMaterial({ color: 0x9bc4c5, emissive: 0x6d9a9b, emissiveIntensity: 0.42, roughness: 0.4 }),
        buildingCount,
      );
      const buildingColors = [0x68716f, 0x7a746d, 0x596866, 0x817b72, 0x525b5c];
      for (let i = 0; i < buildingCount; i++) {
        const z = startZ - rng() * CHUNK_LENGTH;
        const side = rng() < 0.5 ? -1 : 1;
        const width = 5 + rng() * 8;
        const depth = 6 + rng() * 11;
        const height = 8 + rng() * (LOW_POWER_MODE ? 19 : 29);
        const x = roadCenter(z) + side * (15 + rng() * 48);
        dummy.position.set(x, height * 0.5 - 0.08, z);
        dummy.rotation.set(0, rng() * 0.08, 0);
        dummy.scale.set(width, height, depth);
        dummy.updateMatrix();
        buildings.setMatrixAt(i, dummy.matrix);
        buildings.setColorAt(i, new THREE.Color(buildingColors[Math.floor(rng() * buildingColors.length)]));

        dummy.position.set(x - side * (width * 0.505), height * 0.54, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.08, height * 0.48, depth * 0.7);
        dummy.updateMatrix();
        windowPanels.setMatrixAt(i, dummy.matrix);
      }
      buildings.castShadow = true;
      buildings.receiveShadow = true;
      windowPanels.castShadow = false;
      if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
      chunk.group.add(buildings, windowPanels);

      const lampCount = LOW_POWER_MODE ? 12 : 20;
      const lampPoles = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.055, 0.075, 4.5, LOW_POWER_MODE ? 5 : 8),
        worldMaterial({ color: 0x303837, roughness: 0.72, metalness: 0.48 }),
        lampCount,
      );
      const lampHeads = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.32, 0.13, 0.52),
        worldMaterial({ color: 0xffd99a, emissive: 0xffa84d, emissiveIntensity: 1.25, roughness: 0.3 }),
        lampCount,
      );
      for (let i = 0; i < lampCount; i++) {
        const side = i % 2 ? -1 : 1;
        const z = startZ - ((i + 0.5) / lampCount) * CHUNK_LENGTH;
        const x = roadCenter(z) + side * 6.1;
        dummy.position.set(x, 2.18, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        lampPoles.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x - side * 0.12, 4.43, z);
        dummy.updateMatrix();
        lampHeads.setMatrixAt(i, dummy.matrix);
      }
      lampPoles.castShadow = true;
      lampHeads.castShadow = true;
      chunk.group.add(lampPoles, lampHeads);
    } else if (this.worldMap === 'desert') {
      const cactusCount = LOW_POWER_MODE ? 10 : 18;
      const cactusMaterial = worldMaterial({ color: 0x486044, roughness: 0.94 });
      const cactusTrunks = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.22, 0.3, 2.8, LOW_POWER_MODE ? 6 : 9),
        cactusMaterial,
        cactusCount,
      );
      const cactusArms = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.13, 0.16, 1.15, LOW_POWER_MODE ? 6 : 9),
        cactusMaterial,
        cactusCount * 2,
      );
      for (let i = 0; i < cactusCount; i++) {
        const z = startZ - rng() * CHUNK_LENGTH;
        const side = rng() < 0.5 ? -1 : 1;
        const x = roadCenter(z) + side * (11 + rng() * 62);
        const scale = 0.72 + rng() * 1.15;
        dummy.position.set(x, 1.35 * scale, z);
        dummy.rotation.set(0, rng() * Math.PI, 0);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        cactusTrunks.setMatrixAt(i, dummy.matrix);
        for (let arm = 0; arm < 2; arm++) {
          const armSide = arm ? -1 : 1;
          dummy.position.set(x + armSide * 0.3 * scale, (1.15 + arm * 0.55) * scale, z);
          dummy.rotation.set(0, 0, armSide * Math.PI * 0.38);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          cactusArms.setMatrixAt(i * 2 + arm, dummy.matrix);
        }
      }
      cactusTrunks.castShadow = true;
      cactusArms.castShadow = true;
      chunk.group.add(cactusTrunks, cactusArms);
    }

    if (this.worldMap !== 'city') {
      for (const side of [-1, 1]) {
        for (let peak = 0; peak < (LOW_POWER_MODE ? 1 : 2); peak++) {
        const mountain = new THREE.Mesh(
          makeMountainGeometry(index * 283 + side * 31 + peak * 719),
          worldMaterial({
            color: palette.hills[side > 0 ? 1 : 0],
            roughness: 1,
            flatShading: true,
          }),
        );
        const desert = this.worldMap === 'desert';
        const height = desert
          ? (peak === 0 ? 12 : 8) + rng() * 6
          : (peak === 0 ? 27 : 19) + rng() * 10;
        mountain.position.set(
          centerX + side * ((desert ? 74 : 82) + peak * 18 + rng() * 18),
          -0.15,
          centerZ + (peak ? 28 : -12) + (rng() - 0.5) * 32,
        );
        mountain.scale.set(
          (desert ? (peak === 0 ? 44 : 34) : (peak === 0 ? 31 : 23)) + rng() * 10,
          height,
          (desert ? (peak === 0 ? 31 : 25) : (peak === 0 ? 27 : 20)) + rng() * 9,
        );
        mountain.rotation.y = rng() * Math.PI;
        mountain.castShadow = true;
        mountain.receiveShadow = true;
        chunk.group.add(mountain);
        }
      }
    }
  }

  update(player: VehicleState, traffic: TrafficState[], dt: number) {
    const currentChunk = Math.floor(-player.z / CHUNK_LENGTH);
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const index = currentChunk - 2 + i;
      const chunk = this.chunks[i];
      if (chunk.index !== index) this.rebuildChunk(chunk, index);
    }

    const playerRideHeight = (this.playerCar.userData.rideHeight as number | undefined) ?? 0;
    this.playerCar.position.set(player.x, 0.04 + playerRideHeight, player.z);
    this.playerCar.rotation.y = -player.heading;
    const playerAppearance = this.playerCar.userData.appearance as CarCustomization;
    const motorcycleLean = THREE.MathUtils.clamp(
      -player.steerAngle
        * Math.min(Math.abs(player.forwardSpeed) / 24, 1)
        * (this.cameraMode === 1 ? 0.035 : 0.12),
      this.cameraMode === 1 ? -0.035 : -0.12,
      this.cameraMode === 1 ? 0.035 : 0.12,
    );
    this.playerCar.rotation.z = playerAppearance.model === 'storm-moto'
      ? motorcycleLean
      : 0;
    const wheels = this.playerCar.userData.wheels as THREE.Group[];
    const playerWheelRadius = (this.playerCar.userData.wheelRadius as number | undefined) ?? 0.39;
    for (const wheel of wheels) wheel.rotation.x -= player.forwardSpeed * dt / playerWheelRadius;
    const frontWheels = this.playerCar.userData.frontWheels as THREE.Group[];
    for (const wheel of frontWheels) wheel.rotation.y = -player.wheelAngle;
    const cockpit = this.playerCar.userData.cockpit as THREE.Group;
    const firstPerson = this.cameraMode === 1;
    cockpit.visible = firstPerson;
    const firstPersonHidden = this.playerCar.userData.firstPersonHidden as THREE.Object3D[];
    for (const object of firstPersonHidden) object.visible = !firstPerson;
    if (cockpit.visible) {
      const steeringWheel = cockpit.userData.steeringWheel as THREE.Group;
      steeringWheel.rotation.z = playerAppearance.model === 'storm-moto'
        ? -player.wheelAngle * 0.6
        : -player.wheelAngle * 2.45;
      const kmh = Math.round(Math.abs(player.forwardSpeed) * 3.6);
      const rpm = Math.round(Math.min(8000, 900 + Math.abs(player.forwardSpeed) * 105));
      const gear = player.forwardSpeed < -0.5 ? 'R' : player.forwardSpeed < 1 ? 'N' : 'D';
      const clusterContext = cockpit.userData.clusterContext as CanvasRenderingContext2D;
      const clusterTexture = cockpit.userData.clusterTexture as THREE.CanvasTexture;
      drawCockpitCluster(clusterContext, kmh, rpm, gear, player.distance);
      clusterTexture.needsUpdate = true;
    }

    // Tablets keep a small render pool, but it follows the closest traffic
    // instead of permanently hiding cars with higher IDs. This prevents an
    // invisible simulation car from reaching the player or causing a collision.
    const renderedTraffic = LOW_POWER_MODE
      ? [...traffic]
        .sort((a, b) => Math.abs(a.z - player.z) - Math.abs(b.z - player.z))
        .slice(0, TRAFFIC_RENDER_LIMIT)
      : traffic;
    const renderedTrafficIds = new Set(renderedTraffic.map(state => state.id));
    for (const [id, car] of this.trafficCars) car.visible = renderedTrafficIds.has(id);
    for (const state of renderedTraffic) {
      const car = this.ensureTrafficCar(state);
      car.position.set(roadCenter(state.z) + state.lane, 0.04, state.z);
      car.rotation.y = -roadTangent(state.z) + (state.direction === -1 ? Math.PI : 0);
      const npcWheels = car.userData.wheels as THREE.Group[];
      const npcWheelRadius = (car.userData.wheelRadius as number | undefined) ?? 0.39;
      for (const wheel of npcWheels) wheel.rotation.x -= state.speed * dt / npcWheelRadius;
    }

    const remoteEase = 1 - Math.exp(-dt * 11);
    for (const entry of this.remoteCars.values()) {
      const { car, target } = entry;
      const rideHeight = (car.userData.rideHeight as number | undefined) ?? 0;
      car.position.lerp(new THREE.Vector3(target.x, 0.04 + rideHeight, target.z), remoteEase);
      const targetRotation = -target.heading;
      const rotationDelta = Math.atan2(
        Math.sin(targetRotation - car.rotation.y),
        Math.cos(targetRotation - car.rotation.y),
      );
      car.rotation.y += rotationDelta * remoteEase;
      const remoteAppearance = car.userData.appearance as CarCustomization;
      car.rotation.z = remoteAppearance.model === 'storm-moto'
        ? THREE.MathUtils.clamp(
          -target.wheelAngle * Math.min(Math.abs(target.forwardSpeed) / 24, 1) * 0.42,
          -0.12,
          0.12,
        )
        : 0;
      const remoteWheels = car.userData.wheels as THREE.Group[];
      const remoteWheelRadius = (car.userData.wheelRadius as number | undefined) ?? 0.39;
      for (const wheel of remoteWheels) wheel.rotation.x -= target.forwardSpeed * dt / remoteWheelRadius;
      const remoteFrontWheels = car.userData.frontWheels as THREE.Group[];
      for (const wheel of remoteFrontWheels) wheel.rotation.y = -target.wheelAngle;
    }

    const forward = new THREE.Vector3(Math.sin(player.heading), 0, -Math.cos(player.heading));
    const right = new THREE.Vector3(Math.cos(player.heading), 0, Math.sin(player.heading));
    const headLightFront = playerAppearance.model === 'metro-bus'
      ? 5.15
      : playerAppearance.model === 'trail-pickup'
        ? 2.78
        : playerAppearance.model === 'storm-moto'
          ? 1.08
          : 2.18;
    for (let i = 0; i < this.headLights.length; i++) {
      const lateral = this.headLights.length === 1 ? 0 : (i === 0 ? -0.66 : 0.66);
      const lightPosition = new THREE.Vector3(player.x, 0.78 + playerRideHeight, player.z)
        .add(forward.clone().multiplyScalar(headLightFront))
        .add(right.clone().multiplyScalar(lateral));
      const targetPosition = new THREE.Vector3(player.x, 0.04, player.z)
        .add(forward.clone().multiplyScalar(48))
        .add(right.clone().multiplyScalar(lateral * 0.35));
      this.headLights[i].position.copy(lightPosition);
      this.headLightTargets[i].position.copy(targetPosition);
    }
    const cameraProfile = this.playerCar.userData.cameraProfile as CameraProfile;
    let desired: THREE.Vector3;
    let lookAhead: THREE.Vector3;
    if (this.cameraMode === 1) {
      desired = new THREE.Vector3(player.x, cameraProfile.height, player.z)
        .add(forward.clone().multiplyScalar(cameraProfile.forwardOffset))
        .add(right.clone().multiplyScalar(cameraProfile.sideOffset));
      lookAhead = new THREE.Vector3(player.x, cameraProfile.height - 0.06, player.z)
        .add(forward.clone().multiplyScalar(45))
        .add(right.clone().multiplyScalar(cameraProfile.sideOffset));
    } else if (this.cameraMode === 2) {
      desired = new THREE.Vector3(player.x, 5.2, player.z).add(forward.clone().multiplyScalar(-9)).add(right.multiplyScalar(7));
      lookAhead = new THREE.Vector3(player.x, 1.1, player.z).add(forward.clone().multiplyScalar(15));
    } else {
      const speedCamera = Math.min(Math.abs(player.forwardSpeed) / 75, 1);
      desired = new THREE.Vector3(player.x, cameraProfile.chaseHeight - speedCamera * 0.42, player.z)
        .add(forward.clone().multiplyScalar(-cameraProfile.chaseDistance + speedCamera * 1.0));
      desired.add(right.multiplyScalar(-player.lateralSpeed * 0.05));
      lookAhead = new THREE.Vector3(player.x, cameraProfile.lookHeight, player.z).add(forward.clone().multiplyScalar(15));
    }
    if (this.cameraMode === 1 || this.cameraSnap) {
      // The cockpit camera is rigidly mounted to the car so acceleration cannot
      // make the interior appear to slide away from the driver.
      this.cameraPosition.copy(desired);
      this.cameraTarget.copy(lookAhead);
      this.cameraSnap = false;
    } else {
      const cameraEase = 1 - Math.exp(-dt * 5.2);
      this.cameraPosition.lerp(desired, cameraEase);
      this.cameraTarget.lerp(lookAhead, cameraEase);
    }
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraTarget);
    const targetFov = this.cameraMode === 1
      ? (playerAppearance.model === 'trail-pickup' ? 75 : 67)
        + Math.min(Math.abs(player.forwardSpeed) / 80, 1) * 4
      : 58 + Math.min(Math.abs(player.forwardSpeed), 80) * 0.24;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.updateProjectionMatrix();

    const sunOffset = this.timeSettings[this.timeIndex].sunOffset;
    this.sun.position.set(player.x + sunOffset[0], sunOffset[1], player.z + sunOffset[2]);
    this.sun.lookAt(this.camera.position);
    this.moonGlow.position.copy(this.sun.position);
    this.stars.position.set(player.x, 0, player.z);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const width = innerWidth;
    const height = innerHeight;
    const renderScale = LOW_POWER_MODE ? LOW_RENDER_SCALE : 1;
    this.renderer.setSize(Math.round(width * renderScale), Math.round(height * renderScale), false);
    this.composer?.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
