const mediasoup = require('mediasoup');
const config = require('../config/mediasoup.config');
const logger = require('../utils/logger');

// Mediasoup workers pool
const workers = [];
let workerIndex = 0;

// Map: roomId -> { router, peers: Map<socketId, peer> }
const rooms = new Map();

/**
 * Create mediasoup workers (one per CPU core up to config limit)
 */
async function createWorkers() {
  for (let i = 0; i < config.numWorkers; i++) {
    const worker = await mediasoup.createWorker(config.worker);

    worker.on('died', (error) => {
      logger.error(`mediasoup worker ${worker.pid} died`, error);
      setTimeout(() => process.exit(1), 2000);
    });

    workers.push(worker);
    logger.info(`mediasoup worker created [pid:${worker.pid}]`);
  }
}

/**
 * Round-robin worker selection
 */
function getNextWorker() {
  const worker = workers[workerIndex];
  workerIndex = (workerIndex + 1) % workers.length;
  return worker;
}

/**
 * Get or create a mediasoup Router for a room
 */
async function getOrCreateRouter(roomId) {
  if (rooms.has(roomId)) {
    return rooms.get(roomId).router;
  }

  const worker = getNextWorker();
  const router = await worker.createRouter({ mediaCodecs: config.router.mediaCodecs });

  rooms.set(roomId, {
    router,
    peers: new Map(),
  });

  logger.info(`Router created for room [roomId:${roomId}]`);
  return router;
}

/**
 * Create a WebRTC transport for a peer
 */
async function createWebRtcTransport(roomId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error(`Room ${roomId} not found`);

  const transport = await room.router.createWebRtcTransport(config.webRtcTransport);

  if (config.webRtcTransport.maxIncomingBitrate) {
    await transport.setMaxIncomingBitrate(config.webRtcTransport.maxIncomingBitrate);
  }

  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    },
  };
}

/**
 * Get router RTP capabilities for a room
 */
async function getRouterRtpCapabilities(roomId) {
  const router = await getOrCreateRouter(roomId);
  return router.rtpCapabilities;
}

/**
 * Add peer to room tracking
 */
function addPeer(roomId, socketId, peerData) {
  const room = rooms.get(roomId);
  if (room) {
    room.peers.set(socketId, {
      socketId,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      ...peerData,
    });
  }
}

/**
 * Remove peer from room and clean up
 */
function removePeer(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const peer = room.peers.get(socketId);
  if (peer) {
    peer.consumers.forEach((consumer) => consumer.close());
    peer.producers.forEach((producer) => producer.close());
    peer.transports.forEach((transport) => transport.close());
    room.peers.delete(socketId);
  }

  // Clean up empty rooms
  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(roomId);
    logger.info(`Room closed [roomId:${roomId}]`);
  }
}

/**
 * Get all producers in a room except for a specific peer
 */
function getOtherPeerProducers(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  const producers = [];
  room.peers.forEach((peer, peerId) => {
    if (peerId !== socketId) {
      peer.producers.forEach((producer) => {
        producers.push({
          producerId: producer.id,
          kind: producer.kind,
          peerId,
        });
      });
    }
  });
  return producers;
}

/**
 * Get room info
 */
function getRoomInfo(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return {
    participantCount: room.peers.size,
    participants: Array.from(room.peers.values()).map((p) => ({
      socketId: p.socketId,
      userId: p.userId,
      displayName: p.displayName,
      isMuted: p.isMuted,
      isVideoOff: p.isVideoOff,
    })),
  };
}

module.exports = {
  createWorkers,
  getOrCreateRouter,
  createWebRtcTransport,
  getRouterRtpCapabilities,
  addPeer,
  removePeer,
  getOtherPeerProducers,
  getRoomInfo,
  rooms,
};
