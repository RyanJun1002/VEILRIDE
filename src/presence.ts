import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { loadPeerConstructor, PEER_OPTIONS } from './multiplayer';

type PresenceCountPacket = {
  type: 'presence-count';
  count: number;
};

type PresenceHeartbeatPacket = {
  type: 'presence-heartbeat';
};

type PresencePacket = PresenceCountPacket | PresenceHeartbeatPacket;

const PRESENCE_HUB_ID = 'mistline-veilride-global-presence-v1';
const CONNECTION_TIMEOUT = 25000;
const HEARTBEAT_INTERVAL = 4000;
const CLIENT_EXPIRY = 12000;
const PRESENCE_OPTIONS = { ...PEER_OPTIONS, debug: 0 as const };

export class PresenceSession {
  private peer: Peer | null = null;
  private hubConnection: DataConnection | null = null;
  private readonly clients = new Map<string, { connection: DataConnection; lastSeen: number }>();
  private retryTimer = 0;
  private heartbeatTimer = 0;
  private sweepTimer = 0;
  private generation = 0;
  private stopped = true;
  onCount: (count: number | null) => void = () => undefined;

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.retryTimer);
    this.destroyConnections();
  }

  private async connect() {
    if (this.stopped) return;
    const generation = ++this.generation;
    this.onCount(null);
    try {
      const PeerConstructor = await loadPeerConstructor();
      if (this.stopped || generation !== this.generation) return;
      const hubCandidate = new PeerConstructor(PRESENCE_HUB_ID, PRESENCE_OPTIONS);
      this.peer = hubCandidate;
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled || generation !== this.generation) return;
        settled = true;
        this.scheduleReconnect();
      }, CONNECTION_TIMEOUT);
      hubCandidate.once('open', () => {
        if (settled || generation !== this.generation) return;
        settled = true;
        clearTimeout(timeout);
        this.becomeHub(hubCandidate, generation);
      });
      hubCandidate.once('error', error => {
        if (settled || generation !== this.generation) return;
        settled = true;
        clearTimeout(timeout);
        if (error.type === 'unavailable-id') {
          hubCandidate.destroy();
          void this.connectAsClient(PeerConstructor, generation);
        } else {
          this.scheduleReconnect();
        }
      });
    } catch {
      if (generation === this.generation) this.scheduleReconnect();
    }
  }

  private becomeHub(peer: Peer, generation: number) {
    if (this.stopped || generation !== this.generation) return;
    this.peer = peer;
    this.onCount(1);
    peer.on('connection', connection => this.registerClient(connection, generation));
    this.sweepTimer = window.setInterval(() => {
      if (generation !== this.generation) return;
      const now = performance.now();
      let changed = false;
      for (const [id, client] of this.clients) {
        if (now - client.lastSeen <= CLIENT_EXPIRY) continue;
        client.connection.close();
        this.clients.delete(id);
        changed = true;
      }
      if (changed) this.broadcastCount();
    }, HEARTBEAT_INTERVAL);
    peer.on('disconnected', () => {
      if (!peer.destroyed) window.setTimeout(() => {
        if (!peer.destroyed && peer.disconnected) peer.reconnect();
      }, 1000);
    });
    peer.on('close', () => {
      if (generation === this.generation) this.scheduleReconnect();
    });
  }

  private registerClient(connection: DataConnection, generation: number) {
    const addClient = () => {
      if (this.stopped || generation !== this.generation) return;
      this.clients.set(connection.peer, { connection, lastSeen: performance.now() });
      this.broadcastCount();
    };
    if (connection.open) addClient();
    else connection.once('open', addClient);
    connection.on('data', data => {
      const packet = data as PresencePacket;
      if (packet?.type !== 'presence-heartbeat') return;
      const client = this.clients.get(connection.peer);
      if (client) client.lastSeen = performance.now();
    });
    connection.on('close', () => {
      this.clients.delete(connection.peer);
      if (generation === this.generation) this.broadcastCount();
    });
    connection.on('error', () => {
      this.clients.delete(connection.peer);
      if (generation === this.generation) this.broadcastCount();
    });
  }

  private async connectAsClient(
    PeerConstructor: typeof import('peerjs').default,
    parentGeneration: number,
  ) {
    if (this.stopped || parentGeneration !== this.generation) return;
    const generation = ++this.generation;
    const peer = new PeerConstructor(PRESENCE_OPTIONS);
    this.peer = peer;
    const timeout = window.setTimeout(() => {
      if (generation === this.generation) this.scheduleReconnect();
    }, CONNECTION_TIMEOUT);
    peer.once('open', () => {
      if (this.stopped || generation !== this.generation) return;
      const connection = peer.connect(PRESENCE_HUB_ID, {
        reliable: true,
        serialization: 'json',
      });
      this.hubConnection = connection;
      connection.once('open', () => {
        clearTimeout(timeout);
        const heartbeat: PresenceHeartbeatPacket = { type: 'presence-heartbeat' };
        connection.send(heartbeat);
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = window.setInterval(() => {
          if (connection.open) connection.send(heartbeat);
        }, HEARTBEAT_INTERVAL);
      });
      connection.on('data', data => {
        const packet = data as PresencePacket;
        if (packet?.type === 'presence-count' && Number.isFinite(packet.count)) {
          this.onCount(Math.max(1, Math.round(packet.count)));
        }
      });
      connection.on('close', () => {
        if (generation === this.generation) this.scheduleReconnect();
      });
      connection.on('error', () => {
        if (generation === this.generation) this.scheduleReconnect();
      });
    });
    peer.once('error', () => {
      clearTimeout(timeout);
      if (generation === this.generation) this.scheduleReconnect();
    });
    peer.on('disconnected', () => {
      if (!peer.destroyed) window.setTimeout(() => {
        if (!peer.destroyed && peer.disconnected) peer.reconnect();
      }, 1000);
    });
  }

  private broadcastCount() {
    const count = this.clients.size + 1;
    this.onCount(count);
    const packet: PresenceCountPacket = { type: 'presence-count', count };
    for (const client of this.clients.values()) {
      if (client.connection.open) client.connection.send(packet);
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.generation++;
    clearTimeout(this.retryTimer);
    this.destroyConnections();
    this.onCount(null);
    this.retryTimer = window.setTimeout(() => void this.connect(), 700 + Math.random() * 1500);
  }

  private destroyConnections() {
    clearInterval(this.heartbeatTimer);
    clearInterval(this.sweepTimer);
    this.heartbeatTimer = 0;
    this.sweepTimer = 0;
    this.hubConnection?.close();
    this.hubConnection = null;
    for (const client of this.clients.values()) client.connection.close();
    this.clients.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}
