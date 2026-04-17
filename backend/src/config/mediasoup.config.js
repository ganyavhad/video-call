/**
 * mediasoup configuration
 * Tuned for production-grade group calls (20-30+ participants)
 */

module.exports = {
  // Number of workers — one per CPU core is recommended
  numWorkers: Math.min(Object.keys(require('os').cpus()).length, 4),

  worker: {
    rtcMinPort: parseInt(process.env.MEDIASOUP_MIN_PORT, 10) || 10000,
    rtcMaxPort: parseInt(process.env.MEDIASOUP_MAX_PORT, 10) || 10100,
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
  },

  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: { 'x-google-start-bitrate': 1000 },
      },
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000,
        },
      },
    ],
  },

  webRtcTransport: {
    listenInfos: [
      {
        protocol: 'udp',
        ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
        announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
      },
      {
        protocol: 'tcp',
        ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
        announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
      },
    ],
    initialAvailableOutgoingBitrate: 1000000,
    minimumAvailableOutgoingBitrate: 600000,
    maxSctpMessageSize: 262144,
    maxIncomingBitrate: 1500000,
  },
};
