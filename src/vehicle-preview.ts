import * as THREE from 'three';
import { createCar, type WorldMapId } from './renderer';
import type { CarCustomization } from './cars';

const MAP_STYLE: Record<WorldMapId, { platform: number; hemi: number; ground: number; key: number; rim: number }> = {
  mountain: { platform: 0x25332c, hemi: 0xbfd8ca, ground: 0x28342d, key: 0xffd7a5, rim: 0x86c3a7 },
  city: { platform: 0x20292d, hemi: 0xa7c1c8, ground: 0x1b2225, key: 0xe5f1ff, rim: 0x71b9d0 },
  desert: { platform: 0x513a2c, hemi: 0xf2cca0, ground: 0x4d3428, key: 0xffbc79, rim: 0xe88650 },
};

export class VehiclePreviewRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  private readonly pivot = new THREE.Group();
  private readonly platformMaterial = new THREE.MeshStandardMaterial({
    color: 0x25332c,
    metalness: 0.32,
    roughness: 0.7,
    transparent: true,
    opacity: 0.88,
  });
  private readonly hemi = new THREE.HemisphereLight(0xbfd8ca, 0x28342d, 2.3);
  private readonly key = new THREE.DirectionalLight(0xffd7a5, 5.2);
  private readonly rim = new THREE.DirectionalLight(0x86c3a7, 3.2);
  private vehicle: THREE.Group | null = null;
  private active = true;
  private lastFrame = 0;
  private lastTime = performance.now();
  private readonly lowPower = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 4) <= 4;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: !this.lowPower,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.lowPower ? 1.15 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = !this.lowPower;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera.position.set(7.2, 3.8, 8.8);
    this.camera.lookAt(0, 1.05, 0);
    this.scene.add(this.pivot, this.hemi, this.key, this.rim);
    this.key.position.set(-5, 8, 4);
    this.key.castShadow = !this.lowPower;
    this.key.shadow.mapSize.set(1024, 1024);
    this.rim.position.set(6, 4, -5);

    const platform = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.5, 0.12, this.lowPower ? 32 : 64), this.platformMaterial);
    platform.position.y = -0.06;
    platform.receiveShadow = !this.lowPower;
    this.scene.add(platform);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(5.05, this.lowPower ? 32 : 64),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.3 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    shadow.receiveShadow = !this.lowPower;
    this.scene.add(shadow);

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    requestAnimationFrame(this.tick);
  }

  setCustomization(customization: CarCustomization) {
    if (this.vehicle) {
      this.pivot.remove(this.vehicle);
      this.disposeObject(this.vehicle);
    }
    const vehicle = createCar(customization.color, false, customization);
    const initialBox = new THREE.Box3().setFromObject(vehicle);
    const size = initialBox.getSize(new THREE.Vector3());
    const scale = 5.35 / Math.max(size.x, size.z, size.y * 1.28);
    vehicle.scale.setScalar(scale);
    const fittedBox = new THREE.Box3().setFromObject(vehicle);
    const center = fittedBox.getCenter(new THREE.Vector3());
    vehicle.position.set(-center.x, -fittedBox.min.y + 0.13, -center.z);
    vehicle.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = !this.lowPower;
      object.receiveShadow = !this.lowPower;
    });
    this.vehicle = vehicle;
    this.pivot.clear();
    this.pivot.add(vehicle);
    this.pivot.rotation.y = -0.62;
    this.canvas.classList.remove('is-changing');
    void this.canvas.offsetWidth;
    this.canvas.classList.add('is-changing');
  }

  setWorldMap(map: WorldMapId) {
    const style = MAP_STYLE[map];
    this.platformMaterial.color.setHex(style.platform);
    this.hemi.color.setHex(style.hemi);
    this.hemi.groundColor.setHex(style.ground);
    this.key.color.setHex(style.key);
    this.rim.color.setHex(style.rim);
  }

  setActive(active: boolean) {
    this.active = active;
    if (active) this.lastTime = performance.now();
  }

  private readonly tick = (time: number) => {
    requestAnimationFrame(this.tick);
    if (!this.active || document.hidden) return;
    if (this.lowPower && time - this.lastFrame < 1000 / 30) return;
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    this.lastFrame = time;
    if (!this.reducedMotion) this.pivot.rotation.y += dt * 0.22;
    this.renderer.render(this.scene, this.camera);
  };

  private resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private disposeObject(root: THREE.Object3D) {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  }
}
