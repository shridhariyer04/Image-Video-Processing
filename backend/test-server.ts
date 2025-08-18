// test-server.ts - Minimal server to test basic functionality
import app from './src/app';
import { PORT } from './src/config/env';
import logger from './src/utils/logger';

console.log('🚀 Starting test server...');
console.log('PORT from config:', PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Test server is running on http://localhost:${PORT}`);
  console.log('🔗 Try: http://localhost:' + PORT + '/health');
  
  logger.info(`Test server started successfully`, {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
  });
});

server.on('error', (error: any) => {
  console.error('❌ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use!`);
  } else if (error.code === 'EACCES') {
    console.error(`Permission denied to bind to port ${PORT}`);
  }
  process.exit(1);
});

server.on('listening', () => {
  console.log('🎯 Server is now listening...');
});

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});