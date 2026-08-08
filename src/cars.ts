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
  },
  'trail-pickup': {
    id: 'trail-pickup',
    name: 'TRAIL 4X4',
    className: 'PICKUP',
    acceleration: 7.3,
    boostAcceleration: 13.2,
    maxSpeed: 65,
    mass: 2180,
    grip: 1.2,
    offroadGrip: 0.9,
    steering: 0.88,
  },
  'metro-bus': {
    id: 'metro-bus',
    name: 'METRO 09',
    className: 'CITY BUS',
    acceleration: 4.8,
    boostAcceleration: 8.4,
    maxSpeed: 42,
    mass: 9200,
    grip: 1.26,
    offroadGrip: 0.42,
    steering: 0.66,
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
    steering: 1.22,
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
