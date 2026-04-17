require('dotenv').config();
const app = require('./app');
const http = require('http');
const { initSocket } = require('./services/socket.service');
const { createWorkers } = require('./services/mediasoup.service');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

async function main() {
  try {
    // Initialize mediasoup workers
    await createWorkers();
    logger.info('mediasoup workers initialized');

    const server = http.createServer(app);

    // Initialize Socket.io
    initSocket(server);
    logger.info('Socket.io initialized');

    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      server.close(() => process.exit(0));
    });
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

main();
