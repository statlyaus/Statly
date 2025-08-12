#!/usr/bin/env node

import { createServer } from 'http';

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello World\n');
});

const PORT = 3002;

// Add error handling
httpServer.on('error', (error) => {
  console.error('Server error:', error);
  process.exit(1);
});

httpServer.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  httpServer.close(() => {
    console.log('Process terminated');
  });
});
