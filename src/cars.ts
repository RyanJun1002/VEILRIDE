export type CarModelId =
  | 'mist-gt'
  | 'apex-r'
  | 'ridge-x'
  | 'touring-s'
  | 'trail-pickup'
  | 'metro-bus'
  | 'storm-moto';

export type CarCustomization = {
  model: CarModelId;
  color: number;
  wheelColor: number;
  spoiler: boolean;
};

export type CarSpec = {
  id: CarModelId;
  name: string;
  className: string;
  acceleration: number;
  boostAcceleration: number;
  maxSpeed: number;
  mass: number;
  grip: number;
  offroadGrip: number;
  steering: number;
  dynamics: {
    wheelbase: number;
    frontWeight: number;
    yawInertiaFactor: number;
    frontCorneringStiffness: number;
    rearCorneringStiffness: number;
    steeringResponse: number;
    lowSpeedSteer: number;
    highSpeedSteer: number;
    stabilityAssist: number;
    offroadStability: number;
    brakePower: number;
    rollingResistance: number;
    linearDrag: number;
    aeroDrag: number;
    handbrakeRearGrip: number;
  };
};

export const CAR_SPECS: Record<CarModelId, CarSpec> = {
  'mist-gt': {
    id: 'mist-gt',
    name: 'MIST GT',
    className: 'BALANCED',
    acceleration: 8.2,
    boostAcceleration: 15,
    maxSpeed: 80,
    mass: 1450,
    grip: 1.14,
    offroadGrip: 0.58,
    steering: 1,
    dynamics: {
      wheelbase: 2.7, frontWeight: 0.53, yawInertiaFactor: 0.24,
      frontCorneringStiffness: 78000, rearCorneringStiffness: 108000,
      steeringResponse: 3.2, lowSpeedSteer: 0.46, highSpeedSteer: 0.035,
      stabilityAssist: 2.8, offroadStability: 0.6, brakePower: 13,
      rollingResistance: 0.18, linearDrag: 0.004, aeroDrag: 0.00022, handbrakeRearGrip: 0.46,
    },
  },
  'apex-r': {
    id: 'apex-r',
    name: 'APEX R',
    className: 'SPORT',
    acceleration: 9.2,
    boostAcceleration: 16.8,
    maxSpeed: 86,
    mass: 1320,
    grip: 1.11,
    offroadGrip: 0.54,
    steering: 1.06,
    dynamics: {
      wheelbase: 2.62, frontWeight: 0.49, yawInertiaFactor: 0.21,
      frontCorneringStiffness: 92000, rearCorneringStiffness: 118000,
      steeringResponse: 4.1, lowSpeedSteer: 0.48, highSpeedSteer: 0.042,
      stabilityAssist: 2.35, offroadStability: 0.52, brakePower: 15.5,
      rollingResistance: 0.15, linearDrag: 0.0036, aeroDrag: 0.0002, handbrakeRearGrip: 0.4,
    },
  },
  'ridge-x': {
    id: 'ridge-x',
    name: 'RIDGE X',
    className: 'RALLY',
    acceleration: 8.7,
    boostAcceleration: 14.6,
    maxSpeed: 75,
    mass: 1540,
    grip: 1.2,
    offroadGrip: 0.82,
    steering: 1.02,
    dynamics: {
      wheelbase: 2.74, frontWeight: 0.55, yawInertiaFactor: 0.27,
      frontCorneringStiffness: 76000, rearCorneringStiffness: 116000,
      steeringResponse: 3.45, lowSpeedSteer: 0.47, highSpeedSteer: 0.034,
      stabilityAssist: 3.25, offroadStability: 1.35, brakePower: 13.4,
      rollingResistance: 0.22, linearDrag: 0.0048, aeroDrag: 0.00027, handbrakeRearGrip: 0.5,
    },
  },
  'touring-s': {
    id: 'touring-s',
    name: 'TOURING S',
    className: 'GT',
    acceleration: 7.7,
    boostAcceleration: 15.7,
    maxSpeed: 83,
    mass: 1660,
    grip: 1.18,
    offroadGrip: 0.62,
    steering: 0.93,
    dynamics: {
      wheelbase: 2.98, frontWeight: 0.52, yawInertiaFactor: 0.27,
      frontCorneringStiffness: 86000, rearCorneringStiffness: 128000,
      steeringResponse: 2.7, lowSpeedSteer: 0.43, highSpeedSteer: 0.03,
      stabilityAssist: 3.5, offroadStability: 0.72, brakePower: 13.8,
      rollingResistance: 0.19, linearDrag: 0.0042, aeroDrag: 0.00023, handbrakeRearGrip: 0.52,
    },
  },
  'trail-pickup': {
    id: 'trail-pickup',
    name: 'TRAIL 4X4',
    className: 'PICKUP',
    acceleration: 5.2,
    boostAcceleration: 13.2,
    maxSpeed: 65,
    mass: 2180,
    grip: 1.2,
    offroadGrip: 0.9,
    steering: 0.88,
    dynamics: {
      wheelbase: 3.42, frontWeight: 0.57, yawInertiaFactor: 0.3,
      frontCorneringStiffness: 92000, rearCorneringStiffness: 148000,
      steeringResponse: 2.35, lowSpeedSteer: 0.42, highSpeedSteer: 0.026,
      stabilityAssist: 4.1, offroadStability: 1.55, brakePower: 12.2,
      rollingResistance: 0.28, linearDrag: 0.006, aeroDrag: 0.00034, handbrakeRearGrip: 0.58,
    },
  },
  'metro-bus': {
    id: 'metro-bus',
    name: 'METRO 09',
    className: 'CITY BUS',
    acceleration: 5,
    boostAcceleration: 10.2,
    maxSpeed: 52,
    mass: 9200,
    grip: 1.26,
    offroadGrip: 0.42,
    steering: 0.66,
    dynamics: {
      wheelbase: 5.95, frontWeight: 0.46, yawInertiaFactor: 0.29,
      frontCorneringStiffness: 205000, rearCorneringStiffness: 325000,
      steeringResponse: 1.35, lowSpeedSteer: 0.38, highSpeedSteer: 0.016,
      stabilityAssist: 6.4, offroadStability: 2.2, brakePower: 8.5,
      rollingResistance: 0.35, linearDrag: 0.008, aeroDrag: 0.0004, handbrakeRearGrip: 0.82,
    },
  },
  'storm-moto': {
    id: 'storm-moto',
    name: 'STORM R',
    className: 'MOTORCYCLE',
    acceleration: 10,
    boostAcceleration: 18.5,
    maxSpeed: 90,
    mass: 224,
    grip: 1.08,
    offroadGrip: 0.4,
    steering: 0.88,
    dynamics: {
      wheelbase: 2.04, frontWeight: 0.48, yawInertiaFactor: 0.19,
      frontCorneringStiffness: 26000, rearCorneringStiffness: 39000,
      steeringResponse: 3.1, lowSpeedSteer: 0.28, highSpeedSteer: 0.015,
      stabilityAssist: 2.55, offroadStability: 0.52, brakePower: 14.8,
      rollingResistance: 0.11, linearDrag: 0.003, aeroDrag: 0.00018, handbrakeRearGrip: 0.68,
    },
  },
};

export const DEFAULT_CUSTOMIZATION: CarCustomization = {
  model: 'mist-gt',
  color: 0xe95a35,
  wheelColor: 0x4c5957,
  spoiler: true,
};

export const CAR_COLORS = [
  { name: 'EMBER', value: 0xe95a35 },
  { name: 'MIST', value: 0xd9e2de },
  { name: 'MIDNIGHT', value: 0x17242b },
  { name: 'SOLAR', value: 0xe5ad35 },
  { name: 'FOREST', value: 0x365f4b },
  { name: 'VIOLET', value: 0x674d79 },
];

export const WHEEL_COLORS = [0x222928, 0x4c5957, 0xb8c1bd, 0xb98742];

export function cloneCustomization(value: CarCustomization): CarCustomization {
  return { ...value };
}
