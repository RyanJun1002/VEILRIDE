import { roadCenter, type VehicleState } from './simulation';

/** Independent, deterministic cargo model. No meshes, wall-clock time, or input polling. */
export class DeliveryRun {
  enabled = true;
  status: 'driving' | 'delivered' = 'driving';
  integrity = 100;
  elapsed = 0;
  roll = 0;
  pitch = 0;
  load = 0;
  stopTime = 0;
  readonly targetZ = -900;
  readonly targetX = roadCenter(this.targetZ) - 6.8;
  private previousSpeed = 0;
  private rollVelocity = 0;
  private pitchVelocity = 0;
  private longitudinal = 0;
  private collisionCooldown = 0;

  reset(speed = 0) {
    this.status = 'driving';
    this.integrity = 100;
    this.elapsed = this.roll = this.pitch = this.load = this.stopTime = 0;
    this.rollVelocity = this.pitchVelocity = this.longitudinal = this.collisionCooldown = 0;
    this.previousSpeed = speed;
  }

  roadReset(speed: number) {
    this.previousSpeed = speed;
    this.longitudinal = 0;
    if (this.enabled && this.status === 'driving') this.integrity = Math.max(0, this.integrity - 3);
  }

  distance(player: Pick<VehicleState, 'x' | 'z'>) {
    return Math.hypot(player.x - this.targetX, player.z - this.targetZ);
  }

  update(dt: number, player: VehicleState, collision = false) {
    if (!this.enabled || this.status !== 'driving' || dt <= 0) return;
    dt = Math.min(dt, .05);
    this.elapsed += dt;
    const acceleration = (player.forwardSpeed - this.previousSpeed) / dt;
    this.previousSpeed = player.forwardSpeed;
    this.longitudinal += (acceleration - this.longitudinal) * (1 - Math.exp(-dt * 7));
    const lateral = player.forwardSpeed * player.yawRate;
    const targetRoll = Math.max(-.32, Math.min(.32, -lateral * .025));
    const targetPitch = Math.max(-.25, Math.min(.25, this.longitudinal * .018));
    // Damped spring. Substeps keep oscillation consistent at 30/60/120 Hz.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < steps; i++) {
      const h = dt / steps;
      this.rollVelocity += ((targetRoll - this.roll) * 65 - this.rollVelocity * 9) * h;
      this.pitchVelocity += ((targetPitch - this.pitch) * 65 - this.pitchVelocity * 9) * h;
      this.roll += this.rollVelocity * h;
      this.pitch += this.pitchVelocity * h;
    }
    this.load = Math.max(Math.abs(lateral) / 4, Math.abs(this.longitudinal) / 7);
    const harshness = Math.max(0, Math.abs(lateral) - 4) * .75
      + Math.max(0, Math.abs(this.longitudinal) - 7) * .45;
    this.integrity = Math.max(0, this.integrity - harshness * dt);
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    if (collision && this.collisionCooldown <= 0) {
      this.integrity = Math.max(0, this.integrity - 12);
      this.collisionCooldown = 1.5;
    }
    const inBay = Math.abs(player.z - this.targetZ) < 12 && Math.abs(player.x - this.targetX) < 2.6;
    this.stopTime = inBay && Math.abs(player.forwardSpeed) < .7 ? this.stopTime + dt : 0;
    if (this.stopTime >= 1.5) this.status = 'delivered';
  }

  get grade() { return this.integrity >= 95 ? 'S' : this.integrity >= 80 ? 'A' : this.integrity >= 60 ? 'B' : this.integrity > 0 ? 'C' : 'D'; }
}
