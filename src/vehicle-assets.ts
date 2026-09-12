import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CarCustomization, CarModelId } from './cars';

// Only selected vehicles stream in. Traffic retains its inexpensive LOD models.
const prefabs = new Map<CarModelId, THREE.Group>();
const pending = new Map<CarModelId, Promise<void>>();
export function loadVehicleAsset(model: CarModelId): Promise<void> {
  if (prefabs.has(model)) return Promise.resolve();
  if (pending.has(model)) return pending.get(model)!;
  const request = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/vehicles/${model}.glb`)
    .then(gltf => { prefabs.set(model, gltf.scene); })
    .finally(() => { pending.delete(model); });
  pending.set(model, request);
  return request;
}

export function hasVehicleAsset(model: CarModelId) { return prefabs.has(model); }

export function upgradeVehicle(root: THREE.Group, appearance: CarCustomization) {
  const source = prefabs.get(appearance.model);
  if (!source) return root;
  const cockpit = root.userData.cockpit as THREE.Object3D | undefined;
  for (const part of [...root.children]) {
    if (part === cockpit) continue;
    root.remove(part);
    part.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    });
  }
  const model = source.clone(true);
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const materials = new Map<THREE.Material, THREE.Material>();
  model.traverse(object => {
    // GLTFLoader strips dots from Blender's automatically numbered node names.
    if (!(object instanceof THREE.Mesh) && /^Spin_(FL|FR|RL|RR|F|R)(\.?\d+)?$/.test(object.name)) wheels.push(object);
    if (!(object instanceof THREE.Mesh) && /^Steer_F(L|R)?(\.?\d+)?$/.test(object.name)) frontWheels.push(object);
    if (object.userData.wheelRadius) root.userData.wheelRadius = object.userData.wheelRadius;
    if (object.userData.optionalWing) object.visible = appearance.spoiler;
    if (!(object instanceof THREE.Mesh)) return;
    // Instances own resources so replacing a paint/vehicle cannot dispose a cached prefab.
    object.geometry = object.geometry.clone();
    const original = object.material as THREE.MeshStandardMaterial;
    let material = materials.get(original) as THREE.MeshStandardMaterial | undefined;
    if (!material) {
      material = original.clone();
      if (material.name === 'Paint') material.color.setHex(appearance.color);
      if (material.name === 'WheelFinish') material.color.setHex(appearance.wheelColor);
      material.envMapIntensity = .72;
      materials.set(original, material);
    }
    object.material = material;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  root.add(model);
  root.userData.wheels = wheels;
  root.userData.frontWheels = frontWheels;
  root.userData.firstPersonHidden = [model];
  root.userData.rideHeight = 0;
  root.userData.assetVersion = 'delivery-atelier-1';
  return root;
}
