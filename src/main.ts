import './style.css';
import { DrivingSimulation, roadCenter, type InputState } from './simulation';
import { GameRenderer, type WorldMapId } from './renderer';
import {
  CAR_COLORS,
  CAR_SPECS,
  DEFAULT_CUSTOMIZATION,
  WHEEL_COLORS,
  cloneCustomization,
  type CarCustomization,
  type CarModelId,
} from './cars';
import { MultiplayerSession, cleanRoomCode, type NetworkPlayerState } from './multiplayer';
import { PresenceSession } from './presence';

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
const locatorBar = document.querySelector<HTMLElement>('#locatorBar')!;
const locatorLabel = document.querySelector<HTMLElement>('#locatorLabel')!;
const locatorSummary = document.querySelector<HTMLElement>('#locatorSummary')!;
const locatorLeft = document.querySelector<HTMLElement>('#locatorLeft')!;
const locatorFront = document.querySelector<HTMLElement>('#locatorFront')!;
const locatorRight = document.querySelector<HTMLElement>('#locatorRight')!;
const locatorMarkers = document.querySelector<HTMLElement>('#locatorMarkers')!;
const roomCodeInput = document.querySelector<HTMLInputElement>('#roomCodeInput')!;
const roomCodeDisplay = document.querySelector<HTMLButtonElement>('#roomCodeDisplay')!;
const soloButton = document.querySelector<HTMLButtonElement>('#soloButton')!;
const hostButton = document.querySelector<HTMLButtonElement>('#hostButton')!;
const joinButton = document.querySelector<HTMLButtonElement>('#joinButton')!;
const trafficToggle = document.querySelector<HTMLInputElement>('#trafficToggle')!;
const trafficLabel = document.querySelector<HTMLElement>('#trafficLabel')!;
const trafficValue = document.querySelector<HTMLElement>('#trafficValue')!;
const languageSelect = document.querySelector<HTMLSelectElement>('#languageSelect')!;
const languageLabel = document.querySelector<HTMLElement>('#languageLabel')!;
const settingsState = document.querySelector<HTMLElement>('#settingsState')!;
const onlinePresence = document.querySelector<HTMLElement>('#onlinePresence')!;
const onlineCount = document.querySelector<HTMLElement>('#onlineCount')!;
const onlineLabel = document.querySelector<HTMLElement>('#onlineLabel')!;
const mapSelectLabel = document.querySelector<HTMLElement>('#mapSelectLabel')!;
const selectedMapLabel = document.querySelector<HTMLElement>('#selectedMapLabel')!;
const routeName = document.querySelector<HTMLElement>('#routeName')!;

type Language = 'ko' | 'en';

const WORLD_MAP_DETAILS: Record<WorldMapId, {
  name: string;
  route: string;
  ko: string;
  en: string;
}> = {
  mountain: { name: 'MOUNTAIN PASS', route: 'RIDGEWAY 09', ko: '숲과 높은 산맥', en: 'FORESTS & HIGH PEAKS' },
  city: { name: 'METRO CITY', route: 'METRO LOOP 07', ko: '빌딩과 가로등', en: 'SKYLINE & STREETLIGHTS' },
  desert: { name: 'DESERT RUN', route: 'SUNSCAR 66', ko: '모래와 메사 지형', en: 'SAND & RED MESAS' },
};

const UI_COPY = {
  ko: {
    tagline: '안개가 머무는 능선. 엔진 소리. 그리고 끝나지 않는 코너.',
    accel: '가속', speed: '최고속도', grip: '그립', host: '방 만들기', join: '참가',
    roomPlaceholder: '6자리 숫자', roomLabel: '6자리 방 코드',
    multiplayerHelp: '6자리 숫자를 친구에게 보내세요. 연결되면 양쪽에 <b>2 PLAYERS</b>가 표시됩니다.',
    engineStart: '엔진 시동', traffic: 'NPC 차량', language: '언어', on: '켜짐', off: '꺼짐',
    pause: '일시정지', pauseHeading: '잠시 숨을 고르세요.', resume: '계속 달리기', restart: '처음부터', mainMenu: '메인 화면으로',
    controls: ['전진', '추가 가속', '방향 전환', '브레이크', '핸드브레이크', '시간대', '계절', '카메라', '복귀'],
    hint: '<kbd>W</kbd> 90 KM/H &nbsp; <kbd>SHIFT</kbd> 제한 해제',
    vehicleTypes: ['균형형', '스포츠', '랠리', '그랜드 투어러', '픽업트럭', '시내버스', '오토바이'],
    soloDrive: '솔로 드라이브', cameraChanged: '카메라 시점 변경', roadReset: '도로로 복귀했습니다',
    newJourney: '새로운 여정을 시작합니다', collision: '충돌 — 리듬을 되찾으세요',
    trafficOnToast: 'NPC 차량을 켰습니다', trafficOffToast: 'NPC 차량을 껐습니다', time: '시간대', season: '계절',
    roomCreateFailed: '방 생성에 실패했습니다.', roomJoinFailed: '방 참가에 실패했습니다.', roomCopied: '복사됨',
    online: '온라인', onlineConnecting: '온라인 인원 연결 중', onlineTitle: (count: number) => `현재 ${count}명 온라인`,
  },
  en: {
    tagline: 'A mist-covered ridge. The engine note. And corners without end.',
    accel: 'ACCELERATION', speed: 'TOP SPEED', grip: 'GRIP', host: 'CREATE ROOM', join: 'JOIN',
    roomPlaceholder: '6 DIGITS', roomLabel: '6-digit room code',
    multiplayerHelp: 'Send the 6-digit code to a friend. Both screens show <b>2 PLAYERS</b> when connected.',
    engineStart: 'START ENGINE', traffic: 'NPC TRAFFIC', language: 'LANGUAGE', on: 'ON', off: 'OFF',
    pause: 'Pause', pauseHeading: 'Take a breath.', resume: 'RESUME DRIVE', restart: 'RESTART', mainMenu: 'MAIN MENU',
    controls: ['THROTTLE', 'BOOST', 'STEER', 'BRAKE', 'HANDBRAKE', 'TIME', 'SEASON', 'CAMERA', 'RESET'],
    hint: '<kbd>W</kbd> UP TO 90 KM/H &nbsp; <kbd>SHIFT</kbd> UNLOCK SPEED',
    vehicleTypes: ['BALANCED', 'SPORT', 'RALLY', 'GRAND TOURER', 'PICKUP', 'CITY BUS', 'MOTORCYCLE'],
    soloDrive: 'SOLO DRIVE', cameraChanged: 'Camera view changed', roadReset: 'Returned to the road',
    newJourney: 'A new journey begins', collision: 'COLLISION — FIND YOUR RHYTHM',
    trafficOnToast: 'NPC traffic enabled', trafficOffToast: 'NPC traffic disabled', time: 'TIME', season: 'SEASON',
    roomCreateFailed: 'Could not create the room.', roomJoinFailed: 'Could not join the room.', roomCopied: 'COPIED',
    online: 'ONLINE', onlineConnecting: 'Connecting online count', onlineTitle: (count: number) => `${count} player${count === 1 ? '' : 's'} online`,
  },
} as const;

function loadLanguage(): Language {
  return localStorage.getItem('mistline-language') === 'en' ? 'en' : 'ko';
}

function loadTrafficEnabled() {
  return localStorage.getItem('mistline-traffic') !== 'off';
}

function loadWorldMap(): WorldMapId {
  const saved = localStorage.getItem('mistline-map');
  return saved === 'city' || saved === 'desert' ? saved : 'mountain';
}

let language = loadLanguage();
let selectedMap = loadWorldMap();
let lastNetworkMessage = '';
let currentOnlineCount: number | null = null;

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
simulation.setTrafficEnabled(loadTrafficEnabled());
view.setPlayerCustomization(customization);
view.setTraffic(simulation.traffic);
view.setTrafficEnabled(simulation.trafficEnabled);
view.setWorldMap(selectedMap);
const multiplayer = new MultiplayerSession();
const presence = new PresenceSession();

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
const locatorMarkerElements = new Map<string, HTMLElement>();
const SIMULATION_STEP = 1 / 60;
const MAX_SIMULATION_STEPS = 6;

function hexColor(value: number) {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function localizeNetworkMessage(message: string) {
  if (language === 'ko') return message;
  const room = message.match(/방 (\d{6})/i)?.[1] ?? '';
  if (message === '솔로 드라이브') return 'SOLO DRIVE';
  if (message.includes('방을 만드는 중')) return 'CREATING ROOM...';
  if (message.includes('친구를 기다리는 중')) return `ROOM ${room} · WAITING FOR A FRIEND`;
  if (message.includes('플레이어 연결됨')) return `ROOM ${room} · PLAYER CONNECTED`;
  if (message.includes('접속 중')) return `ROOM ${room} · CONNECTING...`;
  if (message.includes('연결됨')) return `ROOM ${room} · CONNECTED`;
  if (message.includes('재연결')) return 'RECONNECTING...';
  if (message.includes('연결이 끊겼')) return 'CONNECTION LOST';
  if (message.includes('찾을 수 없')) return 'ROOM NOT FOUND';
  if (message.includes('P2P 연결 실패')) return 'P2P FAILED · CREATE A NEW ROOM';
  if (message.includes('연결 오류')) return 'MULTIPLAYER CONNECTION ERROR';
  return message;
}

function localizeError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (language === 'ko') return error.message;
  if (error.message.includes('6자리')) return 'Enter a 6-digit room code.';
  if (error.message.includes('사용 중')) return 'That room code is already in use.';
  if (error.message.includes('시간이 초과')) return 'The network connection timed out.';
  if (error.message.includes('찾을 수 없')) return 'Room not found or the connection was blocked.';
  if (error.message.includes('서버')) return 'Could not connect to the multiplayer server.';
  if (error.message.includes('연결')) return 'Multiplayer connection failed.';
  return fallback;
}

function updatePresenceUi(count: number | null) {
  currentOnlineCount = count;
  const copy = UI_COPY[language];
  onlineCount.textContent = count === null ? '--' : count.toLocaleString(language);
  onlineLabel.textContent = copy.online;
  onlinePresence.classList.toggle('is-live', count !== null);
  onlinePresence.classList.toggle('is-connecting', count === null);
  onlinePresence.title = count === null ? copy.onlineConnecting : copy.onlineTitle(count);
  onlinePresence.setAttribute('aria-label', onlinePresence.title);
}

function applyLanguage() {
  const copy = UI_COPY[language];
  document.documentElement.lang = language;
  languageSelect.value = language;
  document.querySelector<HTMLElement>('#tagline')!.textContent = copy.tagline;
  document.querySelector<HTMLElement>('#accelLabel')!.textContent = copy.accel;
  document.querySelector<HTMLElement>('#speedLabel')!.textContent = copy.speed;
  document.querySelector<HTMLElement>('#gripLabel')!.textContent = copy.grip;
  hostButton.textContent = copy.host;
  joinButton.textContent = copy.join;
  roomCodeInput.placeholder = copy.roomPlaceholder;
  roomCodeInput.setAttribute('aria-label', copy.roomLabel);
  document.querySelector<HTMLElement>('#multiplayerHelp')!.innerHTML = copy.multiplayerHelp;
  document.querySelector<HTMLElement>('#startLabel')!.textContent = copy.engineStart;
  trafficLabel.textContent = copy.traffic;
  trafficValue.textContent = simulation.trafficEnabled ? copy.on : copy.off;
  languageLabel.textContent = copy.language;
  updateMapUi();
  updatePresenceUi(currentOnlineCount);
  locatorLabel.textContent = language === 'ko' ? '팀 로케이터' : 'ALLY LOCATOR';
  locatorLeft.textContent = language === 'ko' ? '좌' : 'L';
  locatorFront.textContent = language === 'ko' ? '전방' : 'FRONT';
  locatorRight.textContent = language === 'ko' ? '우' : 'R';
  document.querySelectorAll<HTMLElement>('.menu__controls span').forEach((label, index) => {
    label.textContent = copy.controls[index] ?? label.textContent;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-car]').forEach((button, index) => {
    button.querySelector('small')!.textContent = copy.vehicleTypes[index] ?? '';
  });
  hint.innerHTML = copy.hint;
  document.querySelector<HTMLButtonElement>('#pauseButton')!.setAttribute('aria-label', copy.pause);
  pause.querySelector('h2')!.textContent = copy.pauseHeading;
  document.querySelector<HTMLButtonElement>('#resumeButton')!.textContent = copy.resume;
  document.querySelector<HTMLButtonElement>('#restartButton')!.textContent = copy.restart;
  document.querySelector<HTMLButtonElement>('#mainMenuButton')!.textContent = copy.mainMenu;
  networkStatus.textContent = multiplayer.active
    ? localizeNetworkMessage(lastNetworkMessage)
    : copy.soloDrive;
}

function updateMapUi() {
  const details = WORLD_MAP_DETAILS[selectedMap];
  mapSelectLabel.textContent = language === 'ko' ? '월드 맵' : 'WORLD MAP';
  selectedMapLabel.textContent = details.name;
  routeName.textContent = details.route;
  settingsState.textContent = `${details.name} · TRAFFIC ${simulation.trafficEnabled ? 'ON' : 'OFF'} · ${language === 'ko' ? '한국어' : 'ENGLISH'}`;
  document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(button => {
    const map = button.dataset.map as WorldMapId;
    const mapDetails = WORLD_MAP_DETAILS[map];
    button.classList.toggle('is-selected', map === selectedMap);
    button.querySelector('small')!.textContent = mapDetails[language];
    button.setAttribute('aria-label', `${mapDetails.name}, ${mapDetails[language]}`);
  });
}

function formatLocatorDistance(distance: number) {
  if (distance < 1000) return `${Math.max(1, Math.round(distance))} m`;
  return `${(distance / 1000).toFixed(distance < 10000 ? 1 : 0)} km`;
}

function updateLocator(remotePlayers: NetworkPlayerState[]) {
  const visibleIds = new Set(remotePlayers.map(player => player.id));
  locatorMarkerElements.forEach((marker, id) => {
    if (visibleIds.has(id)) return;
    marker.remove();
    locatorMarkerElements.delete(id);
  });

  locatorBar.classList.toggle('is-hidden', remotePlayers.length === 0);
  locatorSummary.textContent = `${remotePlayers.length} PLAYER${remotePlayers.length === 1 ? '' : 'S'}`;

  remotePlayers.forEach((remotePlayer, index) => {
    let marker = locatorMarkerElements.get(remotePlayer.id);
    if (!marker) {
      marker = document.createElement('span');
      marker.className = 'locator-marker';
      marker.innerHTML = '<b></b><small></small>';
      locatorMarkers.append(marker);
      locatorMarkerElements.set(remotePlayer.id, marker);
    }

    const dx = remotePlayer.x - simulation.player.x;
    const dz = remotePlayer.z - simulation.player.z;
    const targetHeading = Math.atan2(dx, -dz);
    const relativeHeading = Math.atan2(
      Math.sin(targetHeading - simulation.player.heading),
      Math.cos(targetHeading - simulation.player.heading),
    );
    const isBehind = Math.abs(relativeHeading) > Math.PI * 0.72;
    const position = 50 + (relativeHeading / Math.PI) * 46;
    const distance = Math.hypot(dx, dz);
    const direction = isBehind
      ? (language === 'ko' ? '후방' : 'BEHIND')
      : (language === 'ko' ? '전방' : 'FRONT');
    const distanceLabel = formatLocatorDistance(distance);

    marker.style.setProperty('--locator-position', `${position.toFixed(2)}%`);
    marker.style.setProperty('--locator-color', `var(--locator-${index % 4})`);
    marker.classList.toggle('is-behind', isBehind);
    marker.querySelector('b')!.textContent = `P${index + 1}`;
    marker.querySelector('small')!.textContent = distanceLabel;
    marker.setAttribute('aria-label', `P${index + 1}, ${direction}, ${distanceLabel}`);
  });
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
  audio?.setModel(customization.model);
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

document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(button => {
  button.addEventListener('click', () => {
    selectedMap = button.dataset.map as WorldMapId;
    localStorage.setItem('mistline-map', selectedMap);
    view.setWorldMap(selectedMap);
    simulation.restart();
    updateMapUi();
  });
});

trafficToggle.checked = simulation.trafficEnabled;
trafficToggle.addEventListener('change', () => {
  simulation.setTrafficEnabled(trafficToggle.checked);
  view.setTrafficEnabled(trafficToggle.checked);
  localStorage.setItem('mistline-traffic', trafficToggle.checked ? 'on' : 'off');
  applyLanguage();
  flashToast(trafficToggle.checked ? UI_COPY[language].trafficOnToast : UI_COPY[language].trafficOffToast);
});

languageSelect.addEventListener('change', () => {
  language = languageSelect.value === 'en' ? 'en' : 'ko';
  localStorage.setItem('mistline-language', language);
  applyLanguage();
});

updateGarageUi();
applyLanguage();

function setOnlineControls(mode: 'solo' | 'host' | 'join') {
  soloButton.classList.toggle('is-selected', mode === 'solo');
  hostButton.classList.toggle('is-selected', mode === 'host');
  joinButton.classList.toggle('is-selected', mode === 'join');
}

multiplayer.onStatus = (message, connected) => {
  lastNetworkMessage = message;
  networkStatus.textContent = localizeNetworkMessage(message);
  multiplayerHud.classList.toggle('is-hidden', !connected);
  if (!connected) updateLocator([]);
  roomCodeDisplay.classList.toggle('is-hidden', !multiplayer.code);
  roomCodeDisplay.textContent = multiplayer.code ? `ROOM ${multiplayer.code}` : '';
};

multiplayer.onPlayerCount = count => {
  const label = multiplayerHud.querySelector('span')!;
  label.textContent = `${count} PLAYER${count > 1 ? 'S' : ''}`;
  if (count <= 1) updateLocator([]);
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
    flashToast(localizeError(error, UI_COPY[language].roomCreateFailed));
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
    flashToast(localizeError(error, UI_COPY[language].roomJoinFailed));
  } finally {
    joinButton.disabled = false;
  }
});

roomCodeDisplay.addEventListener('click', async () => {
  if (!multiplayer.code) return;
  await navigator.clipboard.writeText(multiplayer.code);
  flashToast(language === 'ko'
    ? `방 코드 ${multiplayer.code} ${UI_COPY.ko.roomCopied}`
    : `ROOM ${multiplayer.code} ${UI_COPY.en.roomCopied}`);
});

roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = cleanRoomCode(roomCodeInput.value);
});
roomCodeInput.addEventListener('keydown', event => {
  event.stopPropagation();
  if (event.key === 'Enter' && !event.repeat) {
    event.preventDefault();
    joinButton.click();
  }
});
roomCodeInput.addEventListener('keyup', event => event.stopPropagation());

presence.onCount = updatePresenceUi;
window.setTimeout(() => presence.start(), view.lowPower ? 2400 : 900);

addEventListener('beforeunload', () => {
  presence.stop();
  multiplayer.disconnect();
});

type EngineSoundProfile = {
  ratios: [number, number, number];
  detunes: [number, number, number];
  voices: [number, number, number];
  harmonicRolloff: number;
  toneCut: number;
  idleRpm: number;
  redlineRpm: number;
  cylinders: number;
  shiftKmh: number[];
  filterBase: number;
  filterRpm: number;
  resonance: number;
  bodyFrequency: number;
  bodyGain: number;
  intake: number;
  roughness: number;
  overrun: number;
  volume: number;
};

const ENGINE_SOUNDS: Record<CarModelId, EngineSoundProfile> = {
  'mist-gt': {
    ratios: [0.72, 0.36, 1], detunes: [-5, 6, 0], voices: [0.54, 0.34, 0], harmonicRolloff: 3, toneCut: -15,
    idleRpm: 780, redlineRpm: 6800, cylinders: 6, shiftKmh: [38, 70, 108, 152, 205, 260],
    filterBase: 300, filterRpm: 0.08, resonance: 1.4, bodyFrequency: 82, bodyGain: 7.2, intake: 0.06, roughness: 0.16, overrun: 0.16, volume: 0.032,
  },
  'apex-r': {
    ratios: [0.56, 0.28, 1], detunes: [-3, 4, 0], voices: [0.56, 0.34, 0], harmonicRolloff: 3.1, toneCut: -16,
    idleRpm: 920, redlineRpm: 8400, cylinders: 8, shiftKmh: [44, 82, 126, 178, 235, 305],
    filterBase: 280, filterRpm: 0.07, resonance: 1.2, bodyFrequency: 74, bodyGain: 8.2, intake: 0.05, roughness: 0.18, overrun: 0.18, volume: 0.034,
  },
  'ridge-x': {
    ratios: [0.82, 1.52, 0.41], detunes: [-12, 9, -4], voices: [0.44, 0.16, 0.43], harmonicRolloff: 2.08, toneCut: -7,
    idleRpm: 840, redlineRpm: 6400, cylinders: 4, shiftKmh: [30, 58, 91, 128, 170, 215],
    filterBase: 290, filterRpm: 0.11, resonance: 1.8, bodyFrequency: 78, bodyGain: 6.8, intake: 0.31, roughness: 0.34, overrun: 0.22, volume: 0.036,
  },
  'touring-s': {
    ratios: [0.75, 0.375, 1.38], detunes: [-7, 5, 3], voices: [0.46, 0.42, 0.14], harmonicRolloff: 2.2, toneCut: -6,
    idleRpm: 720, redlineRpm: 6200, cylinders: 6, shiftKmh: [35, 66, 101, 142, 190, 245],
    filterBase: 300, filterRpm: 0.11, resonance: 1.9, bodyFrequency: 86, bodyGain: 5.2, intake: 0.26, roughness: 0.12, overrun: 0.12, volume: 0.032,
  },
  'trail-pickup': {
    ratios: [0.62, 1.18, 0.31], detunes: [-11, 8, -2], voices: [0.46, 0.12, 0.5], harmonicRolloff: 2.05, toneCut: -7.5,
    idleRpm: 650, redlineRpm: 5200, cylinders: 8, shiftKmh: [27, 52, 82, 116, 154, 195],
    filterBase: 240, filterRpm: 0.1, resonance: 1.8, bodyFrequency: 66, bodyGain: 8.5, intake: 0.36, roughness: 0.3, overrun: 0.32, volume: 0.039,
  },
  'metro-bus': {
    ratios: [0.5, 1, 0.25], detunes: [-14, 6, -5], voices: [0.3, 0.22, 0.58], harmonicRolloff: 2.38, toneCut: -8.5,
    idleRpm: 580, redlineRpm: 2800, cylinders: 6, shiftKmh: [25, 45, 70, 100, 130, 160],
    filterBase: 170, filterRpm: 0.08, resonance: 1.3, bodyFrequency: 52, bodyGain: 9.5, intake: 0.38, roughness: 0.48, overrun: 0.08, volume: 0.043,
  },
  'storm-moto': {
    ratios: [0.56, 0.28, 1], detunes: [-2, 3, 0], voices: [0.55, 0.35, 0], harmonicRolloff: 3.2, toneCut: -18,
    idleRpm: 1350, redlineRpm: 13200, cylinders: 4, shiftKmh: [48, 86, 128, 174, 225, 285],
    filterBase: 320, filterRpm: 0.07, resonance: 1.4, bodyFrequency: 86, bodyGain: 7.6, intake: 0.05, roughness: 0.12, overrun: 0.15, volume: 0.03,
  },
};

function makeSaturationCurve(amount: number) {
  const samples = 512;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

class EngineAudio {
  private context = new AudioContext();
  private oscillators = [
    this.context.createOscillator(),
    this.context.createOscillator(),
    this.context.createOscillator(),
  ];
  private voiceGains = [
    this.context.createGain(),
    this.context.createGain(),
    this.context.createGain(),
  ];
  private engineBus = this.context.createGain();
  private gain = this.context.createGain();
  private saturation = this.context.createWaveShaper();
  private filter = this.context.createBiquadFilter();
  private bodyFilter = this.context.createBiquadFilter();
  private toneFilter = this.context.createBiquadFilter();
  private compressor = this.context.createDynamicsCompressor();
  private noiseSource = this.context.createBufferSource();
  private noiseFilter = this.context.createBiquadFilter();
  private noiseGain = this.context.createGain();
  private noiseBuffer = this.makeNoiseBuffer();
  private profile = ENGINE_SOUNDS['mist-gt'];
  private smoothedRpm = this.profile.idleRpm;
  private previousThrottle = 0;
  private popCooldown = 0;
  private pauseToken = 0;

  constructor(model: CarModelId) {
    this.filter.type = 'lowpass';
    this.bodyFilter.type = 'peaking';
    this.toneFilter.type = 'highshelf';
    this.toneFilter.frequency.value = 1800;
    this.noiseFilter.type = 'bandpass';
    this.gain.gain.value = 0.0001;
    this.engineBus.gain.value = 0.72;
    this.noiseGain.gain.value = 0.0001;
    this.saturation.oversample = '2x';
    this.compressor.threshold.value = -20;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 4.5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.13;
    this.oscillators.forEach((oscillator, index) => {
      oscillator.connect(this.voiceGains[index]).connect(this.engineBus);
      oscillator.start();
    });
    this.engineBus
      .connect(this.saturation)
      .connect(this.filter)
      .connect(this.bodyFilter)
      .connect(this.toneFilter)
      .connect(this.compressor);
    this.noiseSource.buffer = this.noiseBuffer;
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.noiseFilter).connect(this.noiseGain).connect(this.compressor);
    this.noiseSource.start();
    this.compressor.connect(this.gain).connect(this.context.destination);
    this.setModel(model);
  }

  private makeNoiseBuffer() {
    const length = Math.floor(this.context.sampleRate * 2);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let filtered = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      filtered = filtered * 0.86 + white * 0.14;
      channel[i] = white * 0.28 + filtered * 0.72;
    }
    return buffer;
  }

  private makeEngineWave(voiceIndex: number) {
    const harmonicCount = 14;
    const real = new Float32Array(harmonicCount + 1);
    const imaginary = new Float32Array(harmonicCount + 1);
    const rolloff = this.profile.harmonicRolloff + (voiceIndex === 1 ? 0.72 : voiceIndex * 0.18);
    for (let harmonic = 1; harmonic <= harmonicCount; harmonic++) {
      const amplitude = 1 / Math.pow(harmonic, rolloff);
      const phase = harmonic * (0.37 + this.profile.roughness * 0.16) + voiceIndex * 1.1;
      real[harmonic] = Math.cos(phase) * amplitude;
      imaginary[harmonic] = Math.sin(phase) * amplitude;
    }
    return this.context.createPeriodicWave(real, imaginary, { disableNormalization: false });
  }

  setModel(model: CarModelId) {
    this.profile = ENGINE_SOUNDS[model];
    const now = this.context.currentTime;
    this.smoothedRpm = Math.max(this.profile.idleRpm, Math.min(this.smoothedRpm, this.profile.redlineRpm));
    this.oscillators.forEach((oscillator, index) => {
      oscillator.setPeriodicWave(this.makeEngineWave(index));
      oscillator.detune.setTargetAtTime(this.profile.detunes[index], now, 0.08);
      this.voiceGains[index].gain.setTargetAtTime(this.profile.voices[index], now, 0.08);
    });
    this.filter.Q.setTargetAtTime(this.profile.resonance, now, 0.08);
    this.bodyFilter.frequency.setTargetAtTime(this.profile.bodyFrequency, now, 0.08);
    this.bodyFilter.Q.setTargetAtTime(1.1 + this.profile.roughness * 1.6, now, 0.08);
    this.bodyFilter.gain.setTargetAtTime(this.profile.bodyGain, now, 0.08);
    this.toneFilter.gain.setTargetAtTime(this.profile.toneCut, now, 0.08);
    this.noiseFilter.Q.setTargetAtTime(0.55 + this.profile.intake * 0.7, now, 0.08);
    this.saturation.curve = makeSaturationCurve(0.72 + this.profile.roughness * 2.6);
  }

  start() {
    const token = ++this.pauseToken;
    void this.context.resume().then(() => {
      if (token !== this.pauseToken) return;
      const now = this.context.currentTime;
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setTargetAtTime(this.profile.volume, now, 0.18);
    });
  }

  pause() {
    const token = ++this.pauseToken;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0.0001, now);
    this.previousThrottle = 0;
    void this.context.suspend().then(() => {
      if (token !== this.pauseToken) void this.context.resume();
    });
  }

  stop(immediate = false) {
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    if (immediate) {
      this.gain.gain.setValueAtTime(Math.max(0.0001, this.gain.gain.value), now);
      this.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
    } else {
      this.gain.gain.setTargetAtTime(0.0001, now, 0.12);
    }
    this.previousThrottle = 0;
  }

  update(speed: number, throttle: number, braking = false) {
    const driveThrottle = braking ? 0 : throttle;
    const absoluteSpeed = Math.abs(speed);
    const kmh = absoluteSpeed * 3.6;
    let gear = this.profile.shiftKmh.findIndex(limit => kmh < limit);
    if (gear < 0) gear = this.profile.shiftKmh.length - 1;
    const lowerLimit = gear === 0 ? 0 : this.profile.shiftKmh[gear - 1];
    const upperLimit = this.profile.shiftKmh[gear] ?? lowerLimit + 60;
    const gearProgress = Math.max(0, Math.min(1, (kmh - lowerLimit) / Math.max(1, upperLimit - lowerLimit)));
    const rpmRange = this.profile.redlineRpm - this.profile.idleRpm;
    const rollingRpm = this.profile.idleRpm + rpmRange * (0.28 + gearProgress * 0.66);
    const launchRpm = this.profile.idleRpm + driveThrottle * Math.min(1500, rpmRange * 0.24);
    const drivingRpm = kmh < 2
      ? launchRpm
      : Math.min(this.profile.redlineRpm, rollingRpm + driveThrottle * rpmRange * 0.06);
    const brakingRpm = this.profile.idleRpm + Math.min(rpmRange * 0.2, kmh * 8);
    const targetRpm = braking
      ? Math.min(this.smoothedRpm, brakingRpm)
      : drivingRpm;
    const rpmResponse = braking ? 0.24 : driveThrottle > this.previousThrottle ? 0.16 : 0.09;
    this.smoothedRpm += (targetRpm - this.smoothedRpm) * rpmResponse;

    const rpmRatio = Math.max(0, Math.min(1, (this.smoothedRpm - this.profile.idleRpm) / rpmRange));
    const firingFrequency = (this.smoothedRpm / 60) * (this.profile.cylinders / 2);
    const now = this.context.currentTime;
    this.oscillators.forEach((oscillator, index) => {
      oscillator.frequency.setTargetAtTime(
        firingFrequency * this.profile.ratios[index],
        now,
        0.035 + index * 0.008,
      );
      const combustionWobble = Math.sin(now * (2.6 + index * 0.7) + index * 1.4)
        * this.profile.roughness
        * 5;
      oscillator.detune.setTargetAtTime(
        this.profile.detunes[index] + combustionWobble,
        now,
        0.08,
      );
    });
    this.filter.frequency.setTargetAtTime(
      Math.min(3200, this.profile.filterBase + this.smoothedRpm * this.profile.filterRpm + driveThrottle * 360),
      now,
      0.06,
    );
    this.noiseFilter.frequency.setTargetAtTime(
      Math.min(2600, 380 + this.smoothedRpm * 0.18),
      now,
      0.065,
    );
    this.noiseGain.gain.setTargetAtTime(
      braking ? 0.0001 : 0.01 + this.profile.intake * (driveThrottle * 0.075 + rpmRatio * 0.026),
      now,
      braking ? 0.018 : 0.045,
    );
    this.engineBus.gain.setTargetAtTime(
      0.58 + driveThrottle * 0.26 + rpmRatio * 0.12,
      now,
      0.05,
    );
    this.gain.gain.setTargetAtTime(
      this.profile.volume * (0.82 + driveThrottle * 0.28 + rpmRatio * 0.16),
      now,
      0.07,
    );

    if (
      this.previousThrottle > 0.62
      && driveThrottle < 0.18
      && kmh > 24
      && now >= this.popCooldown
      && this.profile.overrun > 0.15
      && !braking
    ) {
      this.triggerOverrunPop(now, firingFrequency);
      this.popCooldown = now + 0.22 + Math.random() * 0.18;
    }
    this.previousThrottle = driveThrottle;
  }

  private triggerOverrunPop(now: number, firingFrequency: number) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const popGain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = Math.min(360, 92 + firingFrequency * 0.82);
    filter.Q.value = 0.75 + this.profile.roughness * 1.2;
    popGain.gain.setValueAtTime(0.0001, now);
    popGain.gain.exponentialRampToValueAtTime(0.17 * this.profile.overrun, now + 0.012);
    popGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    source.connect(filter).connect(popGain).connect(this.compressor);
    source.start(now, Math.random() * 1.6, 0.15);
    source.stop(now + 0.16);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      popGain.disconnect();
    };
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
  audio ??= new EngineAudio(customization.model);
  audio.setModel(customization.model);
  audio.start();
  setTimeout(() => hint.classList.add('is-gone'), 6500);
}

function clearTouchInput() {
  touch.clear();
  document.querySelectorAll<HTMLButtonElement>('[data-touch]').forEach(button => {
    button.classList.remove('is-active', 'is-latched');
    if (button.dataset.touch === 'boost') button.querySelector('small')!.textContent = 'BOOST';
  });
}

function setPause(value: boolean) {
  if (!running) return;
  paused = value;
  if (paused) audio?.pause();
  else audio?.start();
  pause.classList.toggle('is-hidden', !paused);
  hud.classList.toggle('is-dimmed', paused);
  keys.clear();
  clearTouchInput();
}

function returnToMainMenu() {
  running = false;
  paused = false;
  keys.clear();
  clearTouchInput();
  simulation.restart();
  multiplayer.disconnect();
  setOnlineControls('solo');
  roomCodeInput.value = '';
  view.setRemotePlayers([]);
  updateLocator([]);
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
  flashToast(UI_COPY[language].newJourney);
});
document.querySelector('#mainMenuButton')!.addEventListener('click', returnToMainMenu);

addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  if (event.code === 'Escape' && !event.repeat) setPause(!paused);
  if (event.code === 'KeyC' && !event.repeat) {
    view.cycleCamera();
    flashToast(UI_COPY[language].cameraChanged);
  }
  if (event.code === 'KeyR' && !event.repeat) {
    simulation.reset();
    flashToast(UI_COPY[language].roadReset);
  }
  if (event.code === 'KeyQ' && !event.repeat) {
    const timeName = view.cycleTime();
    const localizedTime = language === 'en'
      ? ({ 새벽: 'DAWN', 낮: 'DAY', 노을: 'SUNSET', 밤: 'NIGHT' } as Record<string, string>)[timeName] ?? timeName
      : timeName;
    flashToast(`${UI_COPY[language].time} · ${localizedTime}`);
  }
  if (event.code === 'KeyE' && !event.repeat) {
    const seasonName = view.cycleSeason();
    const localizedSeason = language === 'en'
      ? ({ 봄: 'SPRING', 여름: 'SUMMER', 가을: 'AUTUMN', 겨울: 'WINTER' } as Record<string, string>)[seasonName] ?? seasonName
      : seasonName;
    flashToast(`${UI_COPY[language].season} · ${localizedSeason}`);
  }
  keys.add(event.code);
});
addEventListener('keyup', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  keys.delete(event.code);
});
addEventListener('blur', () => { if (running && !paused) setPause(true); });

document.querySelectorAll<HTMLButtonElement>('[data-touch]').forEach(button => {
  const action = button.dataset.touch!;
  const down = (event: PointerEvent) => {
    event.preventDefault();
    if (action === 'boost') {
      const enabled = !touch.has(action);
      if (enabled) touch.add(action);
      else touch.delete(action);
      button.classList.toggle('is-latched', enabled);
      button.querySelector('small')!.textContent = enabled ? 'BOOST ON' : 'BOOST';
      return;
    }
    button.setPointerCapture(event.pointerId);
    touch.add(action);
    button.classList.add('is-active');
  };
  const up = () => {
    if (action === 'boost') return;
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
    let collisionThisFrame = false;
    let nearMissThisFrame = false;
    if (view.lowPower) {
      simulationAccumulator = Math.min(
        simulationAccumulator + frameDt,
        SIMULATION_STEP * MAX_SIMULATION_STEPS,
      );
      let simulationSteps = 0;
      while (simulationAccumulator >= SIMULATION_STEP && simulationSteps < MAX_SIMULATION_STEPS) {
        simulation.update(SIMULATION_STEP, input);
        collisionThisFrame ||= simulation.collision;
        nearMissThisFrame ||= simulation.nearMiss;
        simulationAccumulator -= SIMULATION_STEP;
        simulationSteps++;
      }
    } else {
      // Desktop renders every animation frame. Matching physics to that frame
      // avoids the 0/2 fixed-step cadence that made the car and camera jitter.
      simulationAccumulator = 0;
      simulation.update(Math.min(frameDt, 0.05), input);
      collisionThisFrame = simulation.collision;
      nearMissThisFrame = simulation.nearMiss;
    }
    if (collisionThisFrame) {
      hitFlash = 1;
      flashToast(UI_COPY[language].collision);
    }
    if (nearMissThisFrame) {
      nearMiss.classList.remove('show');
      requestAnimationFrame(() => nearMiss.classList.add('show'));
    }
    audio?.update(
      simulation.player.forwardSpeed,
      Math.min(1, input.throttle + input.boost * 0.7),
      input.brake > 0 || input.handbrake,
    );
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
    const remotePlayers = multiplayer.getRemotePlayers();
    view.setRemotePlayers(remotePlayers);
    updateLocator(remotePlayers);
    view.update(
      simulation.player,
      simulation.trafficEnabled ? simulation.traffic : [],
      visualDt,
    );
    view.render();
  }
  hitFlash = Math.max(0, hitFlash - frameDt * 2.8);
  document.documentElement.style.setProperty('--impact', hitFlash.toFixed(3));
}

requestAnimationFrame(loop);
