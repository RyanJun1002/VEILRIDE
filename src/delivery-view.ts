import * as THREE from 'three';
import type { DeliveryRun } from './delivery';
import type { VehicleState } from './simulation';

/** A modest roadside delivery bay, never a blocking object in the travel lane. */
export class DeliveryView {
  private readonly bay = new THREE.Group();
  constructor(scene: THREE.Scene, run: DeliveryRun) {
    const surface = new THREE.Mesh(new THREE.BoxGeometry(5, .025, 24), new THREE.MeshStandardMaterial({ color: 0x537e71, roughness: .92 }));
    surface.position.y = .055;
    this.bay.add(surface);
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xb9edd9 });
    for (const side of [-1, 1]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(.08, .025, 24), lineMaterial);
      line.position.set(side * 2.45, .078, 0);
      this.bay.add(line);
    }
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 512; signCanvas.height = 256;
    const ctx = signCanvas.getContext('2d')!;
    ctx.fillStyle = '#173c33'; ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#b9edd9'; ctx.lineWidth = 10; ctx.strokeRect(8, 8, 496, 240);
    ctx.fillStyle = '#eef5e9'; ctx.textAlign = 'center';
    ctx.font = 'bold 52px Arial'; ctx.fillText('MIST BAKERY', 256, 105);
    ctx.font = '32px Arial'; ctx.fillText('DELIVERY  /  STOP', 256, 174);
    const texture = new THREE.CanvasTexture(signCanvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    sign.position.set(-2.5, 2.4, -10);
    this.bay.add(sign);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, 2.4, 8), new THREE.MeshStandardMaterial({ color: 0x3b4745 }));
    pole.position.set(-2.5, 1.2, -10); this.bay.add(pole);
    this.bay.position.set(run.targetX, 0, run.targetZ);
    scene.add(this.bay);
    this.bay.visible = false;
  }

  update(run: DeliveryRun, player: VehicleState, playing: boolean) {
    this.bay.visible = playing && run.enabled && run.distance(player) < 550;
  }
}
