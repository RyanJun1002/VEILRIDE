import Peer, { type DataConnection } from 'peerjs';
import type { CarCustomization } from './cars';

export type NetworkPlayerState = {
  id: string;
  x: number;
  z: number;
  heading: number;
  forwardSpeed: number;
  wheelAngle: number;
  appearance: CarCustomization;
  updatedAt: number;
};

type StatePacket = {
  type: 'state';
  state: Omit<NetworkPlayerState, 'updatedAt'>;
};

type LeavePacket = {
  type: 'leave';
  id: string;
};

type NetworkPacket = StatePacket | LeavePacket;

const ROOM_PREFIX = 'mistline-';

function cleanRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export class MultiplayerSession {
  private peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private remotePlayers = new Map<string, NetworkPlayerState>();
  private host = false;
  private roomCode = '';
  onStatus: (message: string, connected: boolean) => void = () => undefined;
  onPlayerCount: (count: number) => void = () => undefined;

  get active() {
    return this.peer !== null && !this.peer.destroyed;
  }

  get code() {
    return this.roomCode;
  }

  get localId() {
    return this.peer?.id ?? '';
  }

  async createRoom(preferredCode = '') {
    this.disconnect();
    this.host = true;
    this.roomCode = cleanRoomCode(preferredCode) || makeRoomCode();
    this.onStatus('방을 만드는 중...', false);
    this.peer = await this.openPeer(`${ROOM_PREFIX}${this.roomCode.toLowerCase()}`);
    this.peer.on('connection', connection => this.registerConnection(connection));
    this.onStatus(`방 ${this.roomCode} · 친구를 기다리는 중`, true);
    this.updatePlayerCount();
    return this.roomCode;
  }

  async joinRoom(code: string) {
    const cleanCode = cleanRoomCode(code);
    if (cleanCode.length < 4) throw new Error('방 코드를 입력하세요.');
    this.disconnect();
    this.host = false;
    this.roomCode = cleanCode;
    this.onStatus(`방 ${cleanCode}에 접속 중...`, false);
    this.peer = await this.openPeer();
    const connection = this.peer.connect(`${ROOM_PREFIX}${cleanCode.toLowerCase()}`, {
      reliable: true,
      serialization: 'json',
    });
    this.registerConnection(connection);
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('방을 찾을 수 없습니다.')), 9000);
      connection.once('open', () => {
        clearTimeout(timeout);
        this.onStatus(`방 ${cleanCode} · 연결됨`, true);
        resolve();
      });
      connection.once('error', () => {
        clearTimeout(timeout);
        reject(new Error('멀티플레이 연결에 실패했습니다.'));
      });
    });
  }

  sendState(state: Omit<NetworkPlayerState, 'id' | 'updatedAt'>) {
    if (!this.peer?.id) return;
    const packet: StatePacket = {
      type: 'state',
      state: { id: this.peer.id, ...state },
    };
    this.broadcast(packet);
  }

  getRemotePlayers() {
    const now = performance.now();
    for (const [id, state] of this.remotePlayers) {
      if (now - state.updatedAt > 6000) this.removeRemotePlayer(id);
    }
    return [...this.remotePlayers.values()];
  }

  disconnect() {
    if (this.peer?.id) this.broadcast({ type: 'leave', id: this.peer.id });
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.remotePlayers.clear();
    this.peer?.destroy();
    this.peer = null;
    this.roomCode = '';
    this.host = false;
    this.onStatus('솔로 드라이브', false);
    this.updatePlayerCount();
  }

  private openPeer(id?: string) {
    return new Promise<Peer>((resolve, reject) => {
      const peer = id ? new Peer(id) : new Peer();
      const timeout = window.setTimeout(() => {
        peer.destroy();
        reject(new Error('네트워크 연결 시간이 초과됐습니다.'));
      }, 10000);
      peer.once('open', () => {
        clearTimeout(timeout);
        resolve(peer);
      });
      peer.once('error', error => {
        clearTimeout(timeout);
        if (error.type === 'unavailable-id') reject(new Error('이미 사용 중인 방 코드입니다.'));
        else reject(new Error('멀티플레이 서버에 연결할 수 없습니다.'));
      });
    });
  }

  private registerConnection(connection: DataConnection) {
    this.connections.set(connection.peer, connection);
    connection.on('open', () => {
      if (this.host) this.onStatus(`방 ${this.roomCode} · 플레이어 연결됨`, true);
      this.updatePlayerCount();
    });
    connection.on('data', data => this.handlePacket(data as NetworkPacket, connection));
    connection.on('close', () => {
      this.connections.delete(connection.peer);
      this.removeRemotePlayer(connection.peer);
      if (!this.host && this.active) this.onStatus('방장과 연결이 끊겼습니다.', false);
      this.updatePlayerCount();
    });
    connection.on('error', () => this.onStatus('플레이어 연결 오류', false));
  }

  private handlePacket(packet: NetworkPacket, source: DataConnection) {
    if (!packet || typeof packet !== 'object') return;
    if (packet.type === 'leave') {
      this.removeRemotePlayer(packet.id);
      if (this.host) this.broadcast(packet, source.peer);
      return;
    }
    if (packet.type !== 'state' || packet.state.id === this.peer?.id) return;
    this.remotePlayers.set(packet.state.id, {
      ...packet.state,
      updatedAt: performance.now(),
    });
    if (this.host) this.broadcast(packet, source.peer);
    this.updatePlayerCount();
  }

  private broadcast(packet: NetworkPacket, exceptPeer = '') {
    for (const [peerId, connection] of this.connections) {
      if (peerId !== exceptPeer && connection.open) connection.send(packet);
    }
  }

  private removeRemotePlayer(id: string) {
    this.remotePlayers.delete(id);
    this.updatePlayerCount();
  }

  private updatePlayerCount() {
    this.onPlayerCount(this.active ? this.remotePlayers.size + 1 : 1);
  }
}

export { cleanRoomCode };
