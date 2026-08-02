const { io } = require("socket.io-client");

const SERVER_URL = "https://tn-safety-app.onrender.com";

// Simulate the Mobile App
const mobileSocket = io(SERVER_URL, {
  extraHeaders: { 'Bypass-Tunnel-Reminder': 'true' }
});

mobileSocket.on("connect", () => {
  console.log("Mobile App Simulator Connected");
  
  console.log("1. Triggering SOS...");
  mobileSocket.emit('sos-alert', {
    userId: 'user_123',
    latitude: 11.0168,
    longitude: 76.9558,
    timestamp: new Date().toISOString()
  });

  setTimeout(() => {
    console.log("2. Emitting cancel-sos...");
    mobileSocket.emit('cancel-sos', { userId: 'user_123' });
    
    setTimeout(() => {
      console.log("3. Disconnecting...");
      mobileSocket.disconnect();
      process.exit(0);
    }, 2000);
  }, 3000);
});
