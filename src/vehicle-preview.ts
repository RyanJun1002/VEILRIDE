import * as THREE from 'three';
import { createCar, type WorldMapId } from './renderer';
import type { CarCustomization } from './cars';

const MAP_STYLE: Record<WorldMapId, { platform: number; hemi: number; ground: number; key: number; rim: number }> = {
  mountain: { platform: 0xb7bdb9, hemi: 0xcfe4d8, ground: 0x35443b, key: 0xffdfb5, rim: 0x9bd9bc },
  city: { platform: 0xb4bcc0, hemi: 0xc2d8dd, ground: 0x2b3539, key: 0xf1f7ff, rim: 0x8bd0e3 },
  desert: { platform: 0xc1bbb3, hemi: 0xffddba, ground: 0x584236, key: 0xffc994, rim: 0xf1a06f },
};

export class VehiclePreviewRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  private readonly pivot = new THREE.Group();
  private readonly platformMaterial = new THREE.MeshBasicMaterial({
    color: 0xb7bdb9,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  private readonly hemi = new THREE.HemisphereLight(0xcfe4d8, 0x35443b, 2.65);
  private readonly key = new THREE.DirectionalLight(0xffdfb5, 5.8);
  private readonly fill = new THREE.DirectionalLight(0xffffff, 2.25);
  private readonly rim = new THREE.DirectionalLight(0x9bd9bc, 3.55);
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
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.lowPower ? 1.25 : 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.enabled = !this.lowPower;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera.position.set(7.2, 3.8, 8.8);
    this.camera.lookAt(0, 1.05, 0);
    this.scene.add(this.pivot, this.hemi, this.key, this.fill, this.rim);
    this.key.position.set(-5, 8, 4);
    this.key.castShadow = !this.lowPower;
    this.key.shadow.mapSize.set(1024, 1024);
    this.fill.position.set(4.5, 5.5, 8.5);
    this.rim.position.set(6, 4, -5);

    const platform = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.5, 0.12, this.lowPower ? 32 : 64), this.platformMaterial);
    platform.position.y = -0.06;
    platform.receiveShadow = !this.lowPower;
    this.scene.add(platform);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(5.05, this.lowPower ? 32 : 64),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.22 }),
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
    // Keep the showroom vehicle on the road centerline in the full-page scene,
    // even though the preview canvas begins to the right of the selector panel.
    const rect = this.canvas.getBoundingClientRect();
    const targetLocalX = THREE.MathUtils.clamp(innerWidth * 0.5 - rect.left, width * 0.18, width * 0.82);
    const shiftPixels = width * 0.5 - targetLocalX;
    this.camera.filmOffset = shiftPixels / width * this.camera.getFilmWidth();
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
