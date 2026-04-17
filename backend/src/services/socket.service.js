const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const mediasoupService = require('./mediasoup.service');
const { query } = require('../config/database');

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:4200',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Authentication middleware for socket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.userName = decoded.name;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected [id:${socket.id}, userId:${socket.userId}]`);

    // ─── Join Room ───────────────────────────────────────────────────────────
    socket.on('join-room', async ({ roomId }, callback) => {
      try {
        const rtpCapabilities = await mediasoupService.getRouterRtpCapabilities(roomId);

        mediasoupService.addPeer(roomId, socket.id, {
          userId: socket.userId,
          displayName: socket.userName,
          isMuted: false,
          isVideoOff: false,
          roomId,
        });

        socket.join(roomId);
        socket.currentRoomId = roomId;

        // Notify others in room
        socket.to(roomId).emit('peer-joined', {
          socketId: socket.id,
          userId: socket.userId,
          displayName: socket.userName,
        });

        const roomInfo = mediasoupService.getRoomInfo(roomId);
        logger.info(`Peer joined room [roomId:${roomId}, socketId:${socket.id}]`);

        callback({ rtpCapabilities, roomInfo });
      } catch (err) {
        logger.error('join-room error', err);
        callback({ error: err.message });
      }
    });

    // ─── Create WebRTC Transport ──────────────────────────────────────────────
    socket.on('create-webrtc-transport', async ({ roomId, direction }, callback) => {
      try {
        const { transport, params } = await mediasoupService.createWebRtcTransport(roomId);

        const room = mediasoupService.rooms.get(roomId);
        const peer = room?.peers.get(socket.id);
        if (peer) {
          peer.transports.set(transport.id, transport);
        }

        callback({ params });
      } catch (err) {
        logger.error('create-webrtc-transport error', err);
        callback({ error: err.message });
      }
    });

    // ─── Connect Transport ────────────────────────────────────────────────────
    socket.on('connect-transport', async ({ roomId, transportId, dtlsParameters }, callback) => {
      try {
        const room = mediasoupService.rooms.get(roomId);
        const peer = room?.peers.get(socket.id);
        const transport = peer?.transports.get(transportId);
        if (!transport) throw new Error('Transport not found');

        await transport.connect({ dtlsParameters });
        callback({ connected: true });
      } catch (err) {
        logger.error('connect-transport error', err);
        callback({ error: err.message });
      }
    });

    // ─── Produce (send media) ─────────────────────────────────────────────────
    socket.on('produce', async ({ roomId, transportId, kind, rtpParameters, appData }, callback) => {
      try {
        const room = mediasoupService.rooms.get(roomId);
        const peer = room?.peers.get(socket.id);
        const transport = peer?.transports.get(transportId);
        if (!transport) throw new Error('Transport not found');

        const producer = await transport.produce({ kind, rtpParameters, appData });
        peer.producers.set(producer.id, producer);

        producer.on('transportclose', () => {
          producer.close();
          peer.producers.delete(producer.id);
        });

        // Notify all peers in room about new producer
        socket.to(roomId).emit('new-producer', {
          producerId: producer.id,
          kind: producer.kind,
          peerId: socket.id,
          userId: socket.userId,
          displayName: socket.userName,
          appData,
        });

        logger.info(`Producer created [id:${producer.id}, kind:${kind}, peerId:${socket.id}]`);
        callback({ producerId: producer.id });
      } catch (err) {
        logger.error('produce error', err);
        callback({ error: err.message });
      }
    });

    // ─── Consume (receive media) ──────────────────────────────────────────────
    socket.on('consume', async ({ roomId, transportId, producerId, rtpCapabilities }, callback) => {
      try {
        const room = mediasoupService.rooms.get(roomId);
        const peer = room?.peers.get(socket.id);
        const transport = peer?.transports.get(transportId);
        if (!transport) throw new Error('Transport not found');

        if (!room.router.canConsume({ producerId, rtpCapabilities })) {
          throw new Error('Cannot consume this producer');
        }

        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: true, // start paused, resume after client signals ready
        });

        peer.consumers.set(consumer.id, consumer);

        consumer.on('transportclose', () => {
          consumer.close();
          peer.consumers.delete(consumer.id);
        });

        consumer.on('producerclose', () => {
          consumer.close();
          peer.consumers.delete(consumer.id);
          socket.emit('consumer-closed', { consumerId: consumer.id });
        });

        callback({
          consumerId: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          type: consumer.type,
          producerPaused: consumer.producerPaused,
        });
      } catch (err) {
        logger.error('consume error', err);
        callback({ error: err.message });
      }
    });

    // ─── Resume Consumer ──────────────────────────────────────────────────────
    socket.on('resume-consumer', async ({ roomId, consumerId }, callback) => {
      try {
        const room = mediasoupService.rooms.get(roomId);
        const peer = room?.peers.get(socket.id);
        const consumer = peer?.consumers.get(consumerId);
        if (!consumer) throw new Error('Consumer not found');

        await consumer.resume();
        callback({ resumed: true });
      } catch (err) {
        logger.error('resume-consumer error', err);
        callback({ error: err.message });
      }
    });

    // ─── Get Existing Producers ───────────────────────────────────────────────
    socket.on('get-producers', ({ roomId }, callback) => {
      const producers = mediasoupService.getOtherPeerProducers(roomId, socket.id);
      callback({ producers });
    });

    // ─── Toggle Audio ─────────────────────────────────────────────────────────
    socket.on('toggle-audio', ({ roomId, isMuted }) => {
      const room = mediasoupService.rooms.get(roomId);
      const peer = room?.peers.get(socket.id);
      if (peer) {
        peer.isMuted = isMuted;
        io.to(roomId).emit('peer-audio-toggled', {
          socketId: socket.id,
          userId: socket.userId,
          isMuted,
        });
      }
    });

    // ─── Toggle Video ─────────────────────────────────────────────────────────
    socket.on('toggle-video', ({ roomId, isVideoOff }) => {
      const room = mediasoupService.rooms.get(roomId);
      const peer = room?.peers.get(socket.id);
      if (peer) {
        peer.isVideoOff = isVideoOff;
        io.to(roomId).emit('peer-video-toggled', {
          socketId: socket.id,
          userId: socket.userId,
          isVideoOff,
        });
      }
    });

    // ─── Screen Share ─────────────────────────────────────────────────────────
    socket.on('screen-share-start', ({ roomId }) => {
      socket.to(roomId).emit('peer-screen-share-started', {
        socketId: socket.id,
        userId: socket.userId,
        displayName: socket.userName,
      });
    });

    socket.on('screen-share-stop', ({ roomId }) => {
      socket.to(roomId).emit('peer-screen-share-stopped', {
        socketId: socket.id,
        userId: socket.userId,
      });
    });

    // ─── Chat ─────────────────────────────────────────────────────────────────
    socket.on('chat-message', async ({ roomId, meetingId, message }) => {
      if (!message || typeof message !== 'string' || message.trim().length === 0) return;
      const sanitized = message.trim().substring(0, 2000);

      const payload = {
        socketId: socket.id,
        userId: socket.userId,
        displayName: socket.userName,
        message: sanitized,
        timestamp: new Date().toISOString(),
      };

      // Persist to DB if meetingId is provided
      if (meetingId) {
        try {
          await query(
            'INSERT INTO chat_messages (meeting_id, user_id, message) VALUES ($1, $2, $3)',
            [meetingId, socket.userId, sanitized]
          );
        } catch (err) {
          logger.error('Failed to persist chat message', err);
        }
      }

      io.to(roomId).emit('chat-message', payload);
    });

    // ─── Host Controls ────────────────────────────────────────────────────────
    socket.on('kick-participant', ({ roomId, targetSocketId }) => {
      const room = mediasoupService.rooms.get(roomId);
      const peer = room?.peers.get(socket.id);
      // Only host can kick (first peer or designated host)
      io.to(targetSocketId).emit('kicked', { by: socket.userId });
    });

    socket.on('mute-participant', ({ roomId, targetSocketId }) => {
      io.to(targetSocketId).emit('force-mute');
    });

    // ─── Leave Room ───────────────────────────────────────────────────────────
    socket.on('leave-room', ({ roomId }) => {
      handlePeerLeave(socket, roomId);
    });

    // ─── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      if (socket.currentRoomId) {
        handlePeerLeave(socket, socket.currentRoomId);
      }
      logger.info(`Socket disconnected [id:${socket.id}]`);
    });
  });

  return io;
}

function handlePeerLeave(socket, roomId) {
  mediasoupService.removePeer(roomId, socket.id);
  socket.leave(roomId);
  socket.to(roomId).emit('peer-left', {
    socketId: socket.id,
    userId: socket.userId,
  });
  logger.info(`Peer left room [roomId:${roomId}, socketId:${socket.id}]`);
}

function getIO() {
  return io;
}

module.exports = { initSocket, getIO };
