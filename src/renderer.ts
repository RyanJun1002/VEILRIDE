import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { TrafficState, VehicleState } from './simulation';
import { roadCenter, roadTangent } from './simulation';

const ROAD_WIDTH = 8.4;
const CHUNK_LENGTH = 140;
const CHUNK_COUNT = 13;

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
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, height / 2, 0);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
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
  dashboard.position.set(0, 0.86, -0.55);
  cockpit.add(dashboard);

  const cluster = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.25, 0.06), trim);
  cluster.position.set(-0.38, 0.99, -0.275);
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
  clusterDisplay.position.set(-0.38, 0.99, -0.225);
  cockpit.add(clusterDisplay);

  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(-0.39, 0.92, -0.22);
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
  column.position.set(-0.39, 0.92, -0.39);
  cockpit.add(steeringWheel, column);

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

export function createCar(color: number, player = false) {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.62, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.16 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101416, metalness: 0.4, roughness: 0.32 });
  const carbon = new THREE.MeshPhysicalMaterial({ color: 0x151b1b, metalness: 0.72, roughness: 0.27, clearcoat: 0.65, clearcoatRoughness: 0.25 });
  const gunmetal = new THREE.MeshStandardMaterial({ color: 0x4c5957, metalness: 0.9, roughness: 0.22 });
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

  const body = roundedBox(2.02, 0.56, 4.25, 0.36, paint);
  body.position.y = 0.48;
  group.add(body);

  const lowerBody = roundedBox(1.92, 0.19, 4.08, 0.22, carbon);
  lowerBody.position.y = 0.25;
  group.add(lowerBody);

  const hood = roundedBox(1.9, 0.18, 1.45, 0.25, paint);
  hood.position.set(0, 0.85, -1.27);
  hood.rotation.x = -0.035;
  group.add(hood);

  for (const side of [-1, 1]) {
    const frontHaunch = roundedBox(0.52, 0.2, 1.08, 0.16, paint);
    frontHaunch.position.set(side * 0.72, 0.76, -1.28);
    frontHaunch.rotation.x = -0.025;
    const rearHaunch = roundedBox(0.56, 0.22, 1.18, 0.17, paint);
    rearHaunch.position.set(side * 0.71, 0.78, 1.3);
    rearHaunch.rotation.x = 0.02;
    group.add(frontHaunch, rearHaunch);
  }

  const rearDeck = roundedBox(1.72, 0.13, 0.8, 0.18, paint);
  rearDeck.position.set(0, 0.88, 1.52);
  rearDeck.rotation.x = 0.025;
  group.add(rearDeck);

  const cabin = new THREE.Group();
  if (player) {
    const windshield = createGlassPanel([
      [-0.78, 0.96, -0.76],
      [0.78, 0.96, -0.76],
      [0.64, 1.36, -0.43],
      [-0.64, 1.36, -0.43],
    ], glass);
    const rearGlass = createGlassPanel([
      [-0.64, 1.36, 0.65],
      [0.64, 1.36, 0.65],
      [0.78, 0.96, 0.98],
      [-0.78, 0.96, 0.98],
    ], glass);
    cabin.add(windshield, rearGlass);

    for (const side of [-1, 1]) {
      const x = side * 0.81;
      const frontSideGlass = createGlassPanel([
        [x, 0.97, -0.68],
        [x, 1.34, -0.4],
        [x, 1.34, 0.14],
        [x, 0.97, 0.14],
      ], glass);
      const quarterGlass = createGlassPanel([
        [x, 0.97, 0.21],
        [x, 1.34, 0.21],
        [x, 1.31, 0.57],
        [x, 0.97, 0.86],
      ], glass);
      cabin.add(frontSideGlass, quarterGlass);
    }
  } else {
    const simpleCabin = roundedBox(1.65, 0.68, 1.92, 0.34, glass);
    simpleCabin.position.set(0, 0.95, 0.12);
    simpleCabin.scale.set(0.95, 1, 0.92);
    cabin.add(simpleCabin);
  }
  group.add(cabin);

  const roof = roundedBox(1.52, 0.08, 1.2, 0.22, paint);
  roof.position.set(0, 1.39, 0.18);
  group.add(roof);

  const exteriorCabinParts: THREE.Object3D[] = [];
  if (player) {
    const windshieldCowl = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.045, 0.075), dark);
    windshieldCowl.position.set(0, 0.96, -0.755);
    const rearGlassBase = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.045, 0.075), dark);
    rearGlassBase.position.set(0, 0.96, 0.975);
    const windshieldTopTrim = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.04, 0.07), dark);
    windshieldTopTrim.position.set(0, 1.355, -0.43);
    const rearGlassTopTrim = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.04, 0.07), dark);
    rearGlassTopTrim.position.set(0, 1.355, 0.65);
    group.add(windshieldCowl, rearGlassBase, windshieldTopTrim, rearGlassTopTrim);
    exteriorCabinParts.push(windshieldCowl, rearGlassBase, windshieldTopTrim, rearGlassTopTrim);
  }
  for (const side of [-1, 1]) {
    const beltTrim = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, 1.72), chrome);
    beltTrim.position.set(side * 0.835, 0.94, 0.13);
    const aPillar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.58, 0.075), dark);
    aPillar.position.set(side * 0.79, 1.15, -0.66);
    aPillar.rotation.x = 0.34;
    const bPillar = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.55, 0.075), dark);
    bPillar.position.set(side * 0.81, 1.13, 0.18);
    const cPillar = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.54, 0.09), dark);
    cPillar.position.set(side * 0.77, 1.14, 0.72);
    cPillar.rotation.x = -0.28;
    const windowTopTrim = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, 1.05), dark);
    windowTopTrim.position.set(side * 0.805, 1.355, 0.13);
    const doorLine = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.018, 1.45), dark);
    doorLine.position.set(side * 1.012, 0.58, 0.18);
    const doorHandle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, 0.25), chrome);
    doorHandle.position.set(side * 1.025, 0.8, 0.43);
    const sideSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 2.65), carbon);
    sideSkirt.position.set(side * 0.985, 0.28, 0.05);
    const sideIntake = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.25, 0.48), lightHousing);
    sideIntake.position.set(side * 1.018, 0.55, 0.9);
    sideIntake.rotation.x = -0.08;
    group.add(beltTrim, aPillar, bPillar, cPillar, windowTopTrim, doorLine, doorHandle, sideSkirt, sideIntake);
    exteriorCabinParts.push(beltTrim, aPillar, bPillar, cPillar, windowTopTrim);

    const mirrorMount = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.055, 0.08), dark);
    mirrorMount.position.set(side * 0.92, 1.04, -0.53);
    const mirrorHousing = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), paint);
    mirrorHousing.position.set(side * 1.04, 1.08, -0.52);
    mirrorHousing.scale.set(1.15, 0.58, 0.72);
    const mirrorGlass = new THREE.Mesh(new THREE.CircleGeometry(0.087, 16), glass);
    mirrorGlass.position.set(side * 1.118, 1.085, -0.505);
    mirrorGlass.rotation.y = side * Math.PI / 2;
    mirrorGlass.scale.y = 0.58;
    group.add(mirrorMount, mirrorHousing, mirrorGlass);
  }

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.12, 0.18), dark);
  splitter.position.set(0, 0.31, -2.16);
  group.add(splitter);

  const frontGrille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.23, 0.055), lightHousing);
  frontGrille.position.set(0, 0.48, -2.225);
  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.2, 0.13), carbon);
  rearBumper.position.set(0, 0.34, 2.16);
  group.add(frontGrille, rearBumper);

  if (player) {
    for (const x of [-0.48, 0.48]) {
      const hoodVent = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 0.62), carbon);
      hoodVent.position.set(x, 0.955, -1.22);
      hoodVent.rotation.x = -0.035;
      group.add(hoodVent);
    }
  }

  const wheelGeometry = new THREE.CylinderGeometry(0.39, 0.39, 0.28, 20);
  const rimGeometry = new THREE.CylinderGeometry(0.22, 0.22, 0.292, 20);
  const wheels: THREE.Group[] = [];
  const frontWheels: THREE.Group[] = [];
  for (const x of [-1.01, 1.01]) {
    for (const z of [-1.32, 1.35]) {
      const steeringPivot = new THREE.Group();
      steeringPivot.position.set(x, 0.43, z);
      const spinPivot = new THREE.Group();
      const wheel = new THREE.Mesh(wheelGeometry, rubber);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      const rim = new THREE.Mesh(rimGeometry, player ? gunmetal : chrome);
      rim.rotation.z = Math.PI / 2;
      spinPivot.add(wheel, rim);
      if (player) {
        const outward = Math.sign(x) * 0.157;
        const rimLip = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.018, 8, 28), chrome);
        rimLip.rotation.y = Math.PI / 2;
        rimLip.position.x = outward;
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.018, 24), brakeDisc);
        disc.rotation.z = Math.PI / 2;
        disc.position.x = outward * 0.9;
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.025, 18), dark);
        hub.rotation.z = Math.PI / 2;
        hub.position.x = outward * 1.08;
        spinPivot.add(disc, rimLip, hub);
        for (let spokeIndex = 0; spokeIndex < 5; spokeIndex++) {
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.028, 0.205), chrome);
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
    const headHousing = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.21, 0.055), lightHousing);
    headHousing.position.set(x, 0.69, -2.18);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.068), white);
    head.position.set(x, 0.69, -2.15);
    const runningLight = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.035, 0.075), white);
    runningLight.position.set(x, 0.78, -2.17);
    runningLight.rotation.z = x < 0 ? -0.09 : 0.09;
    const tailHousing = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.19, 0.055), lightHousing);
    tailHousing.position.set(x, 0.7, 2.19);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.055, 0.07), red);
    tail.position.set(x, 0.72, 2.225);
    const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, 0.075), amber);
    indicator.position.set(x + Math.sign(x) * 0.17, 0.66, 2.226);
    group.add(headHousing, head, runningLight, tailHousing, tail, indicator);
  }

  const rearLightBar = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.035, 0.065), red);
  rearLightBar.position.set(0, 0.72, 2.222);
  group.add(rearLightBar);

  if (player) {
    const spoiler = roundedBox(1.62, 0.075, 0.28, 0.07, carbon);
    spoiler.position.set(0, 1.08, 1.91);
    spoiler.rotation.x = -0.06;
    for (const x of [-0.55, 0.55]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.32, 0.075), carbon);
      strut.position.set(x, 0.9, 1.9);
      const endPlate = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.2, 0.34), carbon);
      endPlate.position.set(x * 1.42, 1.08, 1.91);
      group.add(strut, endPlate);
    }

    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.13, 0.28), carbon);
    diffuser.position.set(0, 0.255, 2.18);
    group.add(diffuser);
    for (const x of [-0.55, -0.28, 0, 0.28, 0.55]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.18, 0.3), carbon);
      fin.position.set(x, 0.22, 2.22);
      group.add(fin);
    }

    for (const x of [-0.67, 0.67]) {
      const exhaustOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 20), chrome);
      exhaustOuter.rotation.x = Math.PI / 2;
      exhaustOuter.position.set(x, 0.3, 2.27);
      const exhaustInner = new THREE.Mesh(new THREE.CylinderGeometry(0.067, 0.067, 0.19, 18), dark);
      exhaustInner.rotation.x = Math.PI / 2;
      exhaustInner.position.set(x, 0.3, 2.285);
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
    plate.position.set(0, 0.51, 2.238);

    const rearBadge = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 20), chrome);
    rearBadge.position.set(0, 0.85, 2.222);
    const badgeSlashLeft = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.09, 0.018), chrome);
    badgeSlashLeft.position.set(-0.021, 0.85, 2.235);
    badgeSlashLeft.rotation.z = -0.3;
    const badgeSlashRight = badgeSlashLeft.clone();
    badgeSlashRight.position.x = 0.021;
    badgeSlashRight.rotation.z = 0.3;

    const cockpit = createCockpit();
    group.add(spoiler, plate, rearBadge, badgeSlashLeft, badgeSlashRight, cockpit);
    group.userData.cockpit = cockpit;
  }

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  group.userData.wheels = wheels;
  group.userData.frontWheels = frontWheels;
  group.userData.firstPersonHidden = [body, cabin, roof, ...exteriorCabinParts];
  return group;
}

function makeRoadGeometry(startZ: number) {
  const segments = 38;
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
  const count = dash ? 18 : 55;
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
  const segments = 12;
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

export class GameRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(57, 1, 0.1, 1100);
  readonly renderer: THREE.WebGLRenderer;
  readonly playerCar = createCar(0xe95a35, true);
  readonly trafficCars = new Map<number, THREE.Group>();
  readonly chunks: WorldChunk[] = [];
  private composer: EffectComposer;
  private cameraMode = 0;
  private cameraPosition = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3();
  private sun: THREE.Mesh;
  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private timeIndex = 1;
  private seasonIndex = 1;
  private readonly timeSettings = [
    { name: '새벽', sky: 0x74889a, fog: 0x8798a0, density: 0.0052, hemiSky: 0x9cb8c9, hemiGround: 0x343c43, hemi: 1.35, key: 0xffb37f, keyPower: 3.1, exposure: 0.88, sun: 0xffbd86, sunOffset: [-115, 28, -340] },
    { name: '낮', sky: 0x9db4a5, fog: 0x9eb1a4, density: 0.0047, hemiSky: 0xc8e1d4, hemiGround: 0x46513d, hemi: 2.1, key: 0xffd5a0, keyPower: 4.6, exposure: 1.08, sun: 0xffe1ac, sunOffset: [-145, 85, -360] },
    { name: '노을', sky: 0xc47b5e, fog: 0xa87966, density: 0.0054, hemiSky: 0xe3a179, hemiGround: 0x493c3d, hemi: 1.45, key: 0xff7b45, keyPower: 4.1, exposure: 0.94, sun: 0xff8a4c, sunOffset: [125, 24, -330] },
    { name: '밤', sky: 0x101b2b, fog: 0x172437, density: 0.0062, hemiSky: 0x496587, hemiGround: 0x101820, hemi: 0.72, key: 0x9ebdff, keyPower: 1.15, exposure: 0.62, sun: 0xcfe0ff, sunOffset: [-110, 62, -360] },
  ];
  private readonly seasonSettings = [
    { name: '봄', ground: [0x6b8058, 0x72885e], shoulder: 0xa99d7d, leaves: [0x416a43, 0x568052, 0x78965e], hills: [0x60765c, 0x526950], rock: 0x77786d },
    { name: '여름', ground: [0x4f6048, 0x53634b], shoulder: 0x9b9277, leaves: [0x263c30, 0x314936, 0x3c503a], hills: [0x46594e, 0x526457], rock: 0x697067 },
    { name: '가을', ground: [0x756843, 0x7d7048], shoulder: 0xa48b68, leaves: [0x7b3f25, 0xa45f2f, 0xc58a3a], hills: [0x6f5b3e, 0x7d6744], rock: 0x776b5c },
    { name: '겨울', ground: [0xbfc7be, 0xcbd1c8], shoulder: 0xe0ded1, leaves: [0x354b46, 0x405752, 0x536762], hills: [0x8e9a95, 0xa5afaa], rock: 0x8a908d },
  ];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x9db4a5);
    this.scene.fog = new THREE.FogExp2(0x9eb1a4, 0.0047);

    this.hemiLight = new THREE.HemisphereLight(0xc8e1d4, 0x46513d, 2.1);
    this.scene.add(this.hemiLight);
    this.keyLight = new THREE.DirectionalLight(0xffd5a0, 4.6);
    this.keyLight.position.set(-50, 82, 32);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.left = -55;
    this.keyLight.shadow.camera.right = 55;
    this.keyLight.shadow.camera.top = 55;
    this.keyLight.shadow.camera.bottom = -55;
    this.keyLight.shadow.camera.far = 220;
    this.keyLight.shadow.bias = -0.0002;
    this.scene.add(this.keyLight);

    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffe1ac, fog: false });
    this.sun = new THREE.Mesh(new THREE.CircleGeometry(11, 40), sunMaterial);
    this.scene.add(this.sun);
    this.applyTimeSetting();

    this.scene.add(this.playerCar);
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x343b39, roughness: 0.92, metalness: 0.02 });
    this.scene.userData.roadMaterial = roadMaterial;
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const group = new THREE.Group();
      this.scene.add(group);
      this.chunks.push({ index: Number.NaN, group });
    }

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.5, 0.89));
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setTraffic(traffic: TrafficState[]) {
    for (const state of traffic) {
      if (!this.trafficCars.has(state.id)) {
        const car = createCar(state.color);
        car.scale.setScalar(0.92 + (state.id % 3) * 0.05);
        this.scene.add(car);
        this.trafficCars.set(state.id, car);
      }
    }
  }

  cycleCamera() {
    this.cameraMode = (this.cameraMode + 1) % 3;
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

  private applyTimeSetting() {
    const setting = this.timeSettings[this.timeIndex];
    (this.scene.background as THREE.Color).setHex(setting.sky);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setHex(setting.fog);
    fog.density = setting.density;
    this.hemiLight.color.setHex(setting.hemiSky);
    this.hemiLight.groundColor.setHex(setting.hemiGround);
    this.hemiLight.intensity = setting.hemi;
    this.keyLight.color.setHex(setting.key);
    this.keyLight.intensity = setting.keyPower;
    this.renderer.toneMappingExposure = setting.exposure;
    (this.sun.material as THREE.MeshBasicMaterial).color.setHex(setting.sun);
    this.sun.scale.setScalar(this.timeIndex === 3 ? 0.62 : 1);
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

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(250, CHUNK_LENGTH + 3, 16, 10),
      new THREE.MeshStandardMaterial({ color: season.ground[((index % 2) + 2) % 2], roughness: 1 }),
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
    const postCount = 36;
    const posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.13, 0.9, 0.13),
      new THREE.MeshStandardMaterial({ color: season.shoulder, roughness: 0.72 }),
      postCount,
    );
    const reflectors = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.18, 0.16, 0.07),
      new THREE.MeshStandardMaterial({ color: 0xffd8a0, emissive: 0xff6b24, emissiveIntensity: 1.8, roughness: 0.32 }),
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
    for (let i = 0; i < 40; i++) {
      const z = startZ - rng() * CHUNK_LENGTH;
      const side = rng() < 0.5 ? -1 : 1;
      const dist = 9 + rng() * 72;
      const x = roadCenter(z) + side * dist;
      if (rng() < 0.78) {
        trees.push({ x, z, scale: 0.72 + rng() * 1.55, rotation: rng() * Math.PI, color: Math.floor(rng() * season.leaves.length) });
      } else {
        rocks.push({ x, z, scale: 0.8 + rng() * 2.35, rotation: rng() * Math.PI * 2 });
      }
    }

    const trunkGeometry = new THREE.CylinderGeometry(0.19, 0.34, 2.8, 9);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x493828, roughness: 0.96 });
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
    const crownGeometry = new THREE.ConeGeometry(1, 1, 11, 2);
    const crownMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const crownLayers = [
      new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length),
      new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length),
      new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length),
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
        const color = new THREE.Color(season.leaves[(tree.color + layerIndex) % season.leaves.length]);
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

    const rockCount = rocks.length * 2;
    const rockClusters = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: season.rock, roughness: 0.94, flatShading: true }),
      rockCount,
    );
    rocks.forEach((rock, i) => {
      for (let piece = 0; piece < 2; piece++) {
        const scale = rock.scale * (piece ? 0.52 : 1);
        dummy.position.set(rock.x + piece * scale * 0.9, scale * 0.42 - 0.08, rock.z + piece * scale * 0.45);
        dummy.rotation.set(rock.rotation * 0.3, rock.rotation + piece, rock.rotation * 0.18);
        dummy.scale.set(scale, scale * (0.58 + piece * 0.1), scale * 0.82);
        dummy.updateMatrix();
        rockClusters.setMatrixAt(i * 2 + piece, dummy.matrix);
      }
    });
    rockClusters.castShadow = true;
    rockClusters.receiveShadow = true;
    chunk.group.add(rockClusters);

    const shrubCount = 18;
    const shrubs = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.55, 1),
      new THREE.MeshStandardMaterial({ color: season.leaves[1], roughness: 1, flatShading: true }),
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

    for (const side of [-1, 1]) {
      for (let peak = 0; peak < 2; peak++) {
        const mountain = new THREE.Mesh(
          makeMountainGeometry(index * 283 + side * 31 + peak * 719),
          new THREE.MeshStandardMaterial({
            color: season.hills[side > 0 ? 1 : 0],
            roughness: 1,
            flatShading: true,
          }),
        );
        const height = (peak === 0 ? 27 : 19) + rng() * 10;
        mountain.position.set(
          centerX + side * (82 + peak * 18 + rng() * 18),
          -0.15,
          centerZ + (peak ? 28 : -12) + (rng() - 0.5) * 32,
        );
        mountain.scale.set(
          (peak === 0 ? 31 : 23) + rng() * 10,
          height,
          (peak === 0 ? 27 : 20) + rng() * 9,
        );
        mountain.rotation.y = rng() * Math.PI;
        mountain.castShadow = true;
        mountain.receiveShadow = true;
        chunk.group.add(mountain);
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

    this.playerCar.position.set(player.x, 0.04, player.z);
    this.playerCar.rotation.y = -player.heading;
    this.playerCar.rotation.z = 0;
    const wheels = this.playerCar.userData.wheels as THREE.Group[];
    for (const wheel of wheels) wheel.rotation.x -= player.forwardSpeed * dt / 0.39;
    const frontWheels = this.playerCar.userData.frontWheels as THREE.Group[];
    for (const wheel of frontWheels) wheel.rotation.y = -player.wheelAngle;
    const cockpit = this.playerCar.userData.cockpit as THREE.Group;
    const firstPerson = this.cameraMode === 1;
    cockpit.visible = firstPerson;
    const firstPersonHidden = this.playerCar.userData.firstPersonHidden as THREE.Object3D[];
    for (const object of firstPersonHidden) object.visible = !firstPerson;
    if (cockpit.visible) {
      const steeringWheel = cockpit.userData.steeringWheel as THREE.Group;
      steeringWheel.rotation.z = -player.wheelAngle * 2.45;
      const kmh = Math.round(Math.abs(player.forwardSpeed) * 3.6);
      const rpm = Math.round(Math.min(8000, 900 + Math.abs(player.forwardSpeed) * 105));
      const gear = player.forwardSpeed < -0.5 ? 'R' : player.forwardSpeed < 1 ? 'N' : 'D';
      const clusterContext = cockpit.userData.clusterContext as CanvasRenderingContext2D;
      const clusterTexture = cockpit.userData.clusterTexture as THREE.CanvasTexture;
      drawCockpitCluster(clusterContext, kmh, rpm, gear, player.distance);
      clusterTexture.needsUpdate = true;
    }

    for (const state of traffic) {
      const car = this.trafficCars.get(state.id);
      if (!car) continue;
      car.position.set(roadCenter(state.z) + state.lane, 0.04, state.z);
      car.rotation.y = -roadTangent(state.z) + (state.direction === -1 ? Math.PI : 0);
      const npcWheels = car.userData.wheels as THREE.Group[];
      for (const wheel of npcWheels) wheel.rotation.x -= state.speed * dt / 0.39;
    }

    const forward = new THREE.Vector3(Math.sin(player.heading), 0, -Math.cos(player.heading));
    const right = new THREE.Vector3(Math.cos(player.heading), 0, Math.sin(player.heading));
    let desired: THREE.Vector3;
    let lookAhead: THREE.Vector3;
    if (this.cameraMode === 1) {
      desired = new THREE.Vector3(player.x, 1.27, player.z)
        .add(forward.clone().multiplyScalar(-0.42))
        .add(right.clone().multiplyScalar(-0.38));
      lookAhead = new THREE.Vector3(player.x, 1.21, player.z)
        .add(forward.clone().multiplyScalar(45))
        .add(right.clone().multiplyScalar(-0.38));
    } else if (this.cameraMode === 2) {
      desired = new THREE.Vector3(player.x, 5.2, player.z).add(forward.clone().multiplyScalar(-9)).add(right.multiplyScalar(7));
      lookAhead = new THREE.Vector3(player.x, 1.1, player.z).add(forward.clone().multiplyScalar(15));
    } else {
      const speedCamera = Math.min(Math.abs(player.forwardSpeed) / 75, 1);
      desired = new THREE.Vector3(player.x, 3.65 - speedCamera * 0.42, player.z)
        .add(forward.clone().multiplyScalar(-7.4 + speedCamera * 1.0));
      desired.add(right.multiplyScalar(-player.lateralSpeed * 0.05));
      lookAhead = new THREE.Vector3(player.x, 1.05, player.z).add(forward.clone().multiplyScalar(15));
    }
    if (this.cameraMode === 1) {
      // The cockpit camera is rigidly mounted to the car so acceleration cannot
      // make the interior appear to slide away from the driver.
      this.cameraPosition.copy(desired);
      this.cameraTarget.copy(lookAhead);
    } else {
      const cameraEase = 1 - Math.exp(-dt * 5.2);
      this.cameraPosition.lerp(desired, cameraEase);
      this.cameraTarget.lerp(lookAhead, cameraEase);
    }
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraTarget);
    const targetFov = this.cameraMode === 1
      ? 67 + Math.min(Math.abs(player.forwardSpeed) / 80, 1) * 4
      : 58 + Math.min(Math.abs(player.forwardSpeed), 80) * 0.24;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.updateProjectionMatrix();

    const sunOffset = this.timeSettings[this.timeIndex].sunOffset;
    this.sun.position.set(player.x + sunOffset[0], sunOffset[1], player.z + sunOffset[2]);
    this.sun.lookAt(this.camera.position);
  }

  render() {
    this.composer.render();
  }

  resize() {
    const width = innerWidth;
    const height = innerHeight;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
