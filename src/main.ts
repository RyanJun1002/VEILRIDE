import './style.css';
import { DrivingSimulation, type InputState } from './simulation';
import { GameRenderer } from './renderer';

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

const simulation = new DrivingSimulation();
const view = new GameRenderer(canvas);
view.setTraffic(simulation.traffic);

const keys = new Set<string>();
const touch = new Set<string>();
let running = false;
let paused = false;
let startedAt = 0;
let lastTime = performance.now();
let hitFlash = 0;
let audio: EngineAudio | null = null;

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
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0,
    brake: keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0,
    steer: (left ? -1 : 0) + (right ? 1 : 0),
    handbrake: keys.has('Space'),
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
  };
  const up = () => touch.delete(action);
  button.addEventListener('pointerdown', down);
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
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
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  const input = getInput();

  if (running && !paused) {
    simulation.update(dt, input);
    if (simulation.collision) {
      hitFlash = 1;
      flashToast('충돌 — 리듬을 되찾으세요');
    }
    if (simulation.nearMiss) {
      nearMiss.classList.remove('show');
      requestAnimationFrame(() => nearMiss.classList.add('show'));
    }
    audio?.update(simulation.player.forwardSpeed, Math.min(1, input.throttle + input.boost * 0.7));
    updateHud();
  } else if (!running) {
    const idleInput: InputState = { throttle: 0, boost: 0, brake: 0, steer: 0, handbrake: false };
    if (now - startedAt > 0) void idleInput;
  }

  view.update(simulation.player, simulation.traffic, dt);
  view.render();
  hitFlash = Math.max(0, hitFlash - dt * 2.8);
  document.documentElement.style.setProperty('--impact', hitFlash.toFixed(3));
}

requestAnimationFrame(loop);
