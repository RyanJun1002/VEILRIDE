import { CAR_SPECS, type CarModelId } from './cars';

export type InputState = {
  throttle: number;
  boost: number;
  brake: number;
  steer: number;
  handbrake: boolean;
};

export type VehicleState = {
  x: number;
  z: number;
  heading: number;
  forwardSpeed: number;
  lateralSpeed: number;
  yawRate: number;
  steerAngle: number;
  wheelAngle: number;
  totalScore: number;
  distance: number;
};

export type TrafficState = {
  id: number;
  z: number;
  lane: number;
  speed: number;
  direction: 1 | -1;
  color: number;
  passed: boolean;
};

export const roadCenter = (z: number) =>
  Math.sin(z * 0.0031) * 34 + Math.sin(z * 0.0083 + 1.2) * 10 + Math.sin(z * 0.0011) * 24;

export const roadTangent = (z: number) => {
  const d = 1;
  return Math.atan2(roadCenter(z - d) - roadCenter(z + d), 2 * d);
};

export class DrivingSimulation {
  player: VehicleState = this.freshPlayer();
  traffic: TrafficState[] = [];
  nearMiss = false;
  collision = false;
  private carSpec = CAR_SPECS['mist-gt'];

  constructor() {
    const colors = [0xe8e2d8, 0x19282c, 0xc64b36, 0xd9a441, 0x526d78, 0x6c4a63];
    for (let i = 0; i < 13; i++) {
      const direction = i % 3 === 2 ? -1 : 1;
      this.traffic.push({
        id: i,
        z: -30 - i * 65 - Math.random() * 18,
        lane: direction === 1 ? -2 : 2,
        speed: direction === 1 ? 17 + Math.random() * 11 : 23 + Math.random() * 8,
        direction,
        color: colors[i % colors.length],
        passed: false,
      });
    }
  }

  private freshPlayer(): VehicleState {
    return {
      x: roadCenter(0) - 2,
      z: 0,
      heading: roadTangent(0),
      forwardSpeed: 0,
      lateralSpeed: 0,
      yawRate: 0,
      steerAngle: 0,
      wheelAngle: 0,
      totalScore: 0,
      distance: 0,
    };
  }

  reset() {
    const p = this.player;
    p.x = roadCenter(p.z) - 2;
    p.heading = roadTangent(p.z);
    p.forwardSpeed = Math.min(p.forwardSpeed, 18);
    p.lateralSpeed = 0;
    p.yawRate = 0;
    p.steerAngle = 0;
    p.wheelAngle = 0;
  }

  setCarModel(model: CarModelId) {
    this.carSpec = CAR_SPECS[model];
  }

  restart() {
    this.player = this.freshPlayer();
    this.traffic.forEach((car, i) => {
      car.z = -60 - i * 70;
      car.passed = false;
    });
  }

  update(dt: number, input: InputState) {
    const p = this.player;
    this.nearMiss = false;
    this.collision = false;

    const offroad = Math.abs(p.x - roadCenter(p.z)) > 4.3;
    const speed = Math.abs(p.forwardSpeed);
    const dynamics = this.carSpec.dynamics;
    const baseSpeedLimit = Math.min(25, this.carSpec.maxSpeed); // 일반 가속은 최대 90 km/h
    const boostPowerCurve = Math.max(0, 1 - speed / (this.carSpec.maxSpeed + 6));
    const engineAcceleration = input.boost
      ? this.carSpec.boostAcceleration * boostPowerCurve
      : speed < baseSpeedLimit ? this.carSpec.acceleration : 0;
    const acceleration = input.throttle * engineAcceleration - input.brake * dynamics.brakePower;
    const drag = dynamics.rollingResistance
      + speed * dynamics.linearDrag
      + speed * speed * dynamics.aeroDrag
      + (offroad ? 2.2 + dynamics.rollingResistance * 2 : 0);
    p.forwardSpeed += acceleration * dt;
    if (input.throttle && !input.boost && speed <= baseSpeedLimit && p.forwardSpeed > baseSpeedLimit) {
      p.forwardSpeed = baseSpeedLimit;
    }
    if (input.handbrake) {
      const handbrakeDeceleration = dynamics.brakePower * (1.02 - dynamics.handbrakeRearGrip * 0.35);
      p.forwardSpeed -= Math.sign(p.forwardSpeed) * Math.min(Math.abs(p.forwardSpeed), handbrakeDeceleration * dt);
    }
    p.forwardSpeed -= Math.sign(p.forwardSpeed) * Math.min(Math.abs(p.forwardSpeed), drag * dt);
    p.forwardSpeed = Math.max(-6, Math.min(offroad ? this.carSpec.maxSpeed * 0.55 : this.carSpec.maxSpeed, p.forwardSpeed));

    const speedFactor = Math.min(Math.abs(p.forwardSpeed) / 80, 1);
    p.steerAngle += (input.steer - p.steerAngle) * Math.min(1, dt * dynamics.steeringResponse);

    // Dynamic bicycle model. The tires create lateral force only up to their
    // friction limit; beyond it, steering input becomes understeer or a slide.
    const mass = this.carSpec.mass;
    const wheelbase = dynamics.wheelbase;
    const frontAxle = wheelbase * (1 - dynamics.frontWeight);
    const rearAxle = wheelbase * dynamics.frontWeight;
    const yawInertia = mass * wheelbase * wheelbase * dynamics.yawInertiaFactor;
    const maxWheelAngle = (
      dynamics.lowSpeedSteer
      + (dynamics.highSpeedSteer - dynamics.lowSpeedSteer) * speedFactor
    ) * this.carSpec.steering;
    const wheelAngle = p.steerAngle * maxWheelAngle;
    p.wheelAngle = wheelAngle;
    const longitudinalSpeed = p.forwardSpeed;

    if (Math.abs(longitudinalSpeed) < 3) {
      const targetYawRate = (longitudinalSpeed / wheelbase) * Math.tan(wheelAngle);
      p.yawRate += (targetYawRate - p.yawRate) * Math.min(1, dt * (2.5 + dynamics.steeringResponse));
      p.lateralSpeed *= Math.max(0, 1 - dt * (4 + dynamics.stabilityAssist));
    } else {
      const gravity = 9.81;
      const roadGrip = offroad ? this.carSpec.offroadGrip : this.carSpec.grip;
      const frontGrip = offroad ? roadGrip : roadGrip * 0.94;
      const rearGrip = input.handbrake
        ? roadGrip * dynamics.handbrakeRearGrip
        : offroad ? roadGrip : roadGrip * 1.18;
      const frontLoad = mass * gravity * (rearAxle / wheelbase);
      const rearLoad = mass * gravity * (frontAxle / wheelbase);
      const corneringStiffnessFront = dynamics.frontCorneringStiffness;
      const corneringStiffnessRear = dynamics.rearCorneringStiffness;
      const safeSpeed = Math.max(3, Math.abs(longitudinalSpeed));
      const frontSlip = Math.atan2(
        p.lateralSpeed + frontAxle * p.yawRate,
        safeSpeed,
      ) - wheelAngle;
      const rearSlip = Math.atan2(
        p.lateralSpeed - rearAxle * p.yawRate,
        safeSpeed,
      );
      const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
      const frontForce = clamp(-corneringStiffnessFront * frontSlip, frontGrip * frontLoad);
      const rearForce = clamp(-corneringStiffnessRear * rearSlip, rearGrip * rearLoad);
      const lateralAcceleration = (frontForce + rearForce) / mass - longitudinalSpeed * p.yawRate;
      const yawAcceleration = (frontAxle * frontForce - rearAxle * rearForce) / yawInertia;
      p.lateralSpeed += clamp(lateralAcceleration, 20) * dt;
      p.yawRate += clamp(yawAcceleration, 12) * dt;
      const stabilityAssist = input.handbrake
        ? dynamics.stabilityAssist * 0.27
        : offroad ? dynamics.offroadStability : dynamics.stabilityAssist;
      p.lateralSpeed *= Math.max(0, 1 - dt * stabilityAssist);
      const yawDamping = input.handbrake
        ? 0.16 + dynamics.handbrakeRearGrip * 0.12
        : offroad
          ? 0.2 + dynamics.offroadStability * 0.09
          : 0.22 + dynamics.stabilityAssist * 0.13;
      p.yawRate *= Math.max(0, 1 - dt * yawDamping);
      p.lateralSpeed = clamp(p.lateralSpeed, 20);
      p.yawRate = clamp(p.yawRate, 1.45);

      const tireScrub = Math.min(
        Math.abs(p.forwardSpeed),
        (Math.abs(frontSlip) + Math.abs(rearSlip)) * safeSpeed * 0.07 * dt,
      );
      p.forwardSpeed -= Math.sign(p.forwardSpeed) * tireScrub;
    }
    p.heading += p.yawRate * dt;

    const sin = Math.sin(p.heading);
    const cos = Math.cos(p.heading);
    p.x += (sin * p.forwardSpeed + cos * p.lateralSpeed) * dt;
    p.z -= (cos * p.forwardSpeed - sin * p.lateralSpeed) * dt;
    p.distance += Math.max(0, p.forwardSpeed) * dt;

    for (const car of this.traffic) {
      car.z -= car.speed * car.direction * dt;
      const recycleBehind = car.z > p.z + 110;
      const recycleAhead = car.z < p.z - 980;
      if (recycleBehind || recycleAhead) {
        car.z = p.z - 480 - Math.random() * 460;
        car.direction = Math.random() < 0.28 ? -1 : 1;
        car.lane = car.direction === 1 ? -2 : 2;
        car.speed = car.direction === 1 ? 17 + Math.random() * 12 : 22 + Math.random() * 10;
        car.passed = false;
      }

      const carX = roadCenter(car.z) + car.lane;
      const dz = Math.abs(car.z - p.z);
      const dx = Math.abs(carX - p.x);
      if (dz < 4.2 && dx < 1.75) {
        p.forwardSpeed *= -0.16;
        p.lateralSpeed += (p.x < carX ? -1 : 1) * 7;
        p.yawRate += (p.x < carX ? -1 : 1) * 0.65;
        this.collision = true;
      } else if (!car.passed && dz < 3.4 && dx < 3.5 && dx > 1.75) {
        car.passed = true;
        this.nearMiss = true;
        p.totalScore += 500;
      }
    }

    if (Math.abs(p.x - roadCenter(p.z)) > 32) this.reset();
  }
}
