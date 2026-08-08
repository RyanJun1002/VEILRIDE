import './style.css';
import { DrivingSimulation, roadCenter, type InputState } from './simulation';
import { GameRenderer } from './renderer';
import {
  CAR_COLORS,
  CAR_SPECS,
  DEFAULT_CUSTOMIZATION,
  WHEEL_COLORS,
  cloneCustomization,
  type CarCustomization,
  type CarModelId,
} from './cars';
import { MultiplayerSession, cleanRoomCode } from './multiplayer';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const menu = document.querySelector<HTMLElement>('#menu')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const pause = document.querySelector<HTMLElement>('#pause')!;
const speedEl = document.querySelector<HTMLElement>('#speed')!;
const gearEl = document.querySelector<HTMLElement>('#gear')!;
const distanceEl = document.querySelector<HTMLElement>('#distance')!;
const speedBar = document.querySelector<HTMLElement>('#speedBar')!;
const nearMiss = document.querySelector<HTMLElement>('#nearMiss')!;
const hint = document.querySelector<HTMLElement>('#hint')!;
const toast = document.querySelector<HTMLElement>('#toast')!;
const paintPicker = document.querySelector<HTMLElement>('#paintPicker')!;
const wheelPicker = document.querySelector<HTMLElement>('#wheelPicker')!;
const spoilerToggle = document.querySelector<HTMLInputElement>('#spoilerToggle')!;
const selectedClass = document.querySelector<HTMLElement>('#selectedClass')!;
const accelStat = document.querySelector<HTMLElement>('#accelStat')!;
const topSpeedStat = document.querySelector<HTMLElement>('#speedStat')!;
const gripStat = document.querySelector<HTMLElement>('#gripStat')!;
const networkStatus = document.querySelector<HTMLElement>('#networkStatus')!;
const multiplayerHud = document.querySelector<HTMLElement>('#multiplayerHud')!;
const roomCodeInput = document.querySelector<HTMLInputElement>('#roomCodeInput')!;
const roomCodeDisplay = document.querySelector<HTMLButtonElement>('#roomCodeDisplay')!;
const soloButton = document.querySelector<HTMLButtonElement>('#soloButton')!;
const hostButton = document.querySelector<HTMLButtonElement>('#hostButton')!;
const joinButton = document.querySelector<HTMLButtonElement>('#joinButton')!;

function loadCustomization(): CarCustomization {
  try {
    const saved = JSON.parse(localStorage.getItem('mistline-car') ?? '') as Partial<CarCustomization>;
    if (saved.model && saved.model in CAR_SPECS) {
      return {
        model: saved.model,
        color: typeof saved.color === 'number' ? saved.color : DEFAULT_CUSTOMIZATION.color,
        wheelColor: typeof saved.wheelColor === 'number' ? saved.wheelColor : DEFAULT_CUSTOMIZATION.wheelColor,
        spoiler: typeof saved.spoiler === 'boolean' ? saved.spoiler : DEFAULT_CUSTOMIZATION.spoiler,
      };
    }
  } catch {
    // Ignore invalid saved garage data and use the factory setup.
  }
  return cloneCustomization(DEFAULT_CUSTOMIZATION);
}

let customization = loadCustomization();

const simulation = new DrivingSimulation();
const view = new GameRenderer(canvas);
document.documentElement.dataset.quality = view.lowPower ? 'low' : 'high';
simulation.setCarModel(customization.model);
view.setPlayerCustomization(customization);
view.setTraffic(simulation.traffic);
const multiplayer = new MultiplayerSession();

const keys = new Set<string>();
const touch = new Set<string>();
let running = false;
let paused = false;
let startedAt = 0;
let lastTime = performance.now();
let hitFlash = 0;
let audio: EngineAudio | null = null;
let nextNetworkSync = 0;
let lastVisualFrame = 0;
let simulationAccumulator = 0;
const SIMULATION_STEP = 1 / 60;
const MAX_SIMULATION_STEPS = 6;

function hexColor(value: number) {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function updateGarageUi() {
  const spec = CAR_SPECS[customization.model];
  document.querySelectorAll<HTMLButtonElement>('[data-car]').forEach(button => {
    button.classList.toggle('is-selected', button.dataset.car === customization.model);
  });
  paintPicker.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    button.classList.toggle('is-selected', Number(button.dataset.color) === customization.color);
  });
  wheelPicker.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    button.classList.toggle('is-selected', Number(button.dataset.color) === customization.wheelColor);
  });
  spoilerToggle.checked = customization.spoiler;
  selectedClass.textContent = spec.className;
  accelStat.style.transform = `scaleX(${spec.acceleration / 10})`;
  topSpeedStat.style.transform = `scaleX(${spec.maxSpeed / 90})`;
  gripStat.style.transform = `scaleX(${spec.grip / 1.25})`;
}

function applyCustomization() {
  localStorage.setItem('mistline-car', JSON.stringify(customization));
  simulation.setCarModel(customization.model);
  view.setPlayerCustomization(customization);
  if (!running) view.resetCamera();
  updateGarageUi();
}

for (const paint of CAR_COLORS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = paint.name;
  button.dataset.color = paint.value.toString();
  button.style.setProperty('--swatch', hexColor(paint.value));
  button.addEventListener('click', () => {
    customization = { ...customization, color: paint.value };
    applyCustomization();
  });
  paintPicker.append(button);
}

for (const wheelColor of WHEEL_COLORS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.color = wheelColor.toString();
  button.style.setProperty('--swatch', hexColor(wheelColor));
  button.addEventListener('click', () => {
    customization = { ...customization, wheelColor };
    applyCustomization();
  });
  wheelPicker.append(button);
}

document.querySelectorAll<HTMLButtonElement>('[data-car]').forEach(button => {
  button.addEventListener('click', () => {
    customization = { ...customization, model: button.dataset.car as CarModelId };
    applyCustomization();
  });
});

spoilerToggle.addEventListener('change', () => {
  customization = { ...customization, spoiler: spoilerToggle.checked };
  applyCustomization();
});

updateGarageUi();

function setOnlineControls(mode: 'solo' | 'host' | 'join') {
  soloButton.classList.toggle('is-selected', mode === 'solo');
  hostButton.classList.toggle('is-selected', mode === 'host');
  joinButton.classList.toggle('is-selected', mode === 'join');
}

multiplayer.onStatus = (message, connected) => {
  networkStatus.textContent = message;
  multiplayerHud.classList.toggle('is-hidden', !connected);
  roomCodeDisplay.classList.toggle('is-hidden', !multiplayer.code);
  roomCodeDisplay.textContent = multiplayer.code ? `ROOM ${multiplayer.code}` : '';
};

multiplayer.onPlayerCount = count => {
  const label = multiplayerHud.querySelector('span')!;
  label.textContent = `${count} PLAYER${count > 1 ? 'S' : ''}`;
};

soloButton.addEventListener('click', () => {
  multiplayer.disconnect();
  simulation.player.x = roadCenter(simulation.player.z) - 2;
  setOnlineControls('solo');
});

hostButton.addEventListener('click', async () => {
  hostButton.disabled = true;
  try {
    await multiplayer.createRoom();
    simulation.player.x = roadCenter(simulation.player.z) - 2;
    setOnlineControls('host');
  } catch (error) {
    multiplayer.disconnect();
    flashToast(error instanceof Error ? error.message : '방 생성에 실패했습니다.');
  } finally {
    hostButton.disabled = false;
  }
});

joinButton.addEventListener('click', async () => {
  const code = cleanRoomCode(roomCodeInput.value);
  roomCodeInput.value = code;
  joinButton.disabled = true;
  try {
    await multiplayer.joinRoom(code);
    simulation.player.x = roadCenter(simulation.player.z) + 2;
    setOnlineControls('join');
  } catch (error) {
    multiplayer.disconnect();
    setOnlineControls('solo');
    flashToast(error instanceof Error ? error.message : '방 참가에 실패했습니다.');
  } finally {
    joinButton.disabled = false;
  }
});

roomCodeDisplay.addEventListener('click', async () => {
  if (!multiplayer.code) return;
  await navigator.clipboard.writeText(multiplayer.code);
  flashToast(`방 코드 ${multiplayer.code} 복사됨`);
});

roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = cleanRoomCode(roomCodeInput.value);
});

addEventListener('beforeunload', () => multiplayer.disconnect());

class EngineAudio {
  private context = new AudioContext();
  private oscillator = this.context.createOscillator();
  private oscillator2 = this.context.createOscillator();
  private gain = this.context.createGain();
  private filter = this.context.createBiquadFilter();

  constructor() {
    this.oscillator.type = 'sawtooth';
    this.oscillator2.type = 'triangle';
    this.oscillator.detune.value = -7;
    this.oscillator2.detune.value = 7;
    this.filter.type = 'lowpass';
    this.filter.Q.value = 3.2;
    this.gain.gain.value = 0.0001;
    this.oscillator.connect(this.filter);
    this.oscillator2.connect(this.filter);
    this.filter.connect(this.gain).connect(this.context.destination);
    this.oscillator.start();
    this.oscillator2.start();
  }

  start() {
    this.context.resume();
    this.gain.gain.setTargetAtTime(0.035, this.context.currentTime, 0.3);
  }

  stop() {
    this.gain.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.12);
  }

  update(speed: number, throttle: number) {
    const rpm = 52 + Math.abs(speed) * 4.3 + throttle * 32;
    this.oscillator.frequency.setTargetAtTime(rpm, this.context.currentTime, 0.045);
    this.oscillator2.frequency.setTargetAtTime(rpm * 0.5, this.context.currentTime, 0.05);
    this.filter.frequency.setTargetAtTime(260 + Math.abs(speed) * 18 + throttle * 320, this.context.currentTime, 0.08);
    this.gain.gain.setTargetAtTime(0.026 + Math.abs(speed) * 0.0007, this.context.currentTime, 0.09);
  }
}

function getInput(): InputState {
  const left = keys.has('KeyA') || keys.has('ArrowLeft') || touch.has('left');
  const right = keys.has('KeyD') || keys.has('ArrowRight') || touch.has('right');
  return {
    throttle: keys.has('KeyW') || keys.has('ArrowUp') || touch.has('gas') ? 1 : 0,
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.has('boost') ? 1 : 0,
    brake: keys.has('KeyS') || keys.has('ArrowDown') || touch.has('brake') ? 1 : 0,
    steer: (left ? -1 : 0) + (right ? 1 : 0),
    handbrake: keys.has('Space') || touch.has('handbrake'),
  };
}

function start() {
  running = true;
  paused = false;
  startedAt = performance.now();
  menu.classList.add('is-gone');
  hud.classList.remove('is-hidden');
  pause.classList.add('is-hidden');
  audio ??= new EngineAudio();
  audio.start();
  setTimeout(() => hint.classList.add('is-gone'), 6500);
}

function setPause(value: boolean) {
  if (!running) return;
  paused = value;
  pause.classList.toggle('is-hidden', !paused);
  hud.classList.toggle('is-dimmed', paused);
  keys.clear();
  touch.clear();
}

function returnToMainMenu() {
  running = false;
  paused = false;
  keys.clear();
  touch.clear();
  simulation.restart();
  multiplayer.disconnect();
  setOnlineControls('solo');
  roomCodeInput.value = '';
  view.setRemotePlayers([]);
  view.resetCamera();
  audio?.stop();
  updateHud();
  pause.classList.add('is-hidden');
  hud.classList.add('is-hidden');
  hud.classList.remove('is-dimmed');
  hint.classList.remove('is-gone');
  menu.classList.remove('is-gone');
}

function flashToast(message: string) {
  toast.textContent = message;
  toast.classList.remove('show');
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.classList.remove('show'), 1600);
}

document.querySelector('#startButton')!.addEventListener('click', start);
document.querySelector('#pauseButton')!.addEventListener('click', () => setPause(true));
document.querySelector('#resumeButton')!.addEventListener('click', () => setPause(false));
document.querySelector('#restartButton')!.addEventListener('click', () => {
  simulation.restart();
  setPause(false);
  flashToast('새로운 여정을 시작합니다');
});
document.querySelector('#mainMenuButton')!.addEventListener('click', returnToMainMenu);

addEventListener('keydown', (event) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  if (event.code === 'Escape') setPause(!paused);
  if (event.code === 'KeyC' && !event.repeat) {
    view.cycleCamera();
    flashToast('카메라 시점 변경');
  }
  if (event.code === 'KeyR' && !event.repeat) {
    simulation.reset();
    flashToast('도로로 복귀했습니다');
  }
  if (event.code === 'KeyQ' && !event.repeat) {
    flashToast(`시간대 · ${view.cycleTime()}`);
  }
  if (event.code === 'KeyE' && !event.repeat) {
    flashToast(`계절 · ${view.cycleSeason()}`);
  }
  keys.add(event.code);
});
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('blur', () => { if (running && !paused) setPause(true); });

document.querySelectorAll<HTMLButtonElement>('[data-touch]').forEach(button => {
  const action = button.dataset.touch!;
  const down = (event: PointerEvent) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    touch.add(action);
    button.classList.add('is-active');
  };
  const up = () => {
    touch.delete(action);
    button.classList.remove('is-active');
  };
  button.addEventListener('pointerdown', down);
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('lostpointercapture', up);
  button.addEventListener('contextmenu', event => event.preventDefault());
});

function updateHud() {
  const p = simulation.player;
  const kmh = Math.round(Math.abs(p.forwardSpeed) * 3.6);
  speedEl.textContent = kmh.toString().padStart(3, '0');
  gearEl.textContent = p.forwardSpeed < -0.5 ? 'R' : p.forwardSpeed < 1 ? 'N' : 'D';
  distanceEl.textContent = `${(p.distance / 1000).toFixed(1)} KM`;
  speedBar.style.transform = `scaleX(${Math.min(1, kmh / 290)})`;
  nearMiss.classList.toggle('show', simulation.nearMiss);
}

function loop(now: number) {
  requestAnimationFrame(loop);
  const frameDt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  const input = getInput();

  if (running && !paused) {
    simulationAccumulator = Math.min(
      simulationAccumulator + frameDt,
      SIMULATION_STEP * MAX_SIMULATION_STEPS,
    );
    let collisionThisFrame = false;
    let nearMissThisFrame = false;
    let simulationSteps = 0;
    while (simulationAccumulator >= SIMULATION_STEP && simulationSteps < MAX_SIMULATION_STEPS) {
      simulation.update(SIMULATION_STEP, input);
      collisionThisFrame ||= simulation.collision;
      nearMissThisFrame ||= simulation.nearMiss;
      simulationAccumulator -= SIMULATION_STEP;
      simulationSteps++;
    }
    if (collisionThisFrame) {
      hitFlash = 1;
      flashToast('충돌 — 리듬을 되찾으세요');
    }
    if (nearMissThisFrame) {
      nearMiss.classList.remove('show');
      requestAnimationFrame(() => nearMiss.classList.add('show'));
    }
    audio?.update(simulation.player.forwardSpeed, Math.min(1, input.throttle + input.boost * 0.7));
    updateHud();
  } else if (!running) {
    simulationAccumulator = 0;
    const idleInput: InputState = { throttle: 0, boost: 0, brake: 0, steer: 0, handbrake: false };
    if (now - startedAt > 0) void idleInput;
  }

  if (multiplayer.active && now >= nextNetworkSync) {
    const player = simulation.player;
    multiplayer.sendState({
      x: player.x,
      z: player.z,
      heading: player.heading,
      forwardSpeed: player.forwardSpeed,
      wheelAngle: player.wheelAngle,
      appearance: { ...customization },
    });
    nextNetworkSync = now + 66;
  }
  const visualInterval = view.lowPower ? 1000 / 30 : 0;
  if (!visualInterval || now - lastVisualFrame >= visualInterval) {
    const visualDt = lastVisualFrame ? Math.min(0.08, (now - lastVisualFrame) / 1000) : frameDt;
    lastVisualFrame = now;
    view.setRemotePlayers(multiplayer.getRemotePlayers());
    view.update(simulation.player, simulation.traffic, visualDt);
    view.render();
  }
  hitFlash = Math.max(0, hitFlash - frameDt * 2.8);
  document.documentElement.style.setProperty('--impact', hitFlash.toFixed(3));
}

requestAnimationFrame(loop);
