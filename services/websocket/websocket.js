// services/websocket/websocket.js
const { WebSocketServer } = require('ws');
let wss = null;

function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg);
        switch (data.typews) {
          case 'sensor':
            if (data.sensor_id) {
              ws.subscribedSensorId = data.sensor_id;
            }
            break;
          case 'plant':
            if (data.plant_id) {
              ws.subscribedPlantId = data.plant_id;
              ws.wsType = 'plant';
            }
            break;
          case 'device':
            if (data.device_id) {
              ws.subscribedDeviceId = data.device_id;
              ws.wsType = 'device';
            }
            break;
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    });

    ws.on('close', () => {});
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });
}

// Notifica a clientes suscritos a un sensor específico
function notifySensorData(sensor_id, payload) {
  if (!wss) {
    console.warn('WebSocket server not initialized');
    return;
  }
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.subscribedSensorId == sensor_id) {
      client.send(JSON.stringify(payload));
    }
  });
}

// Notifica a clientes suscritos a una planta (todos los sensores de la planta)
function notifyPlantData(plant_id, payload) {
  if (!wss) {
    console.warn('WebSocket server not initialized');
    return;
  }
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.subscribedPlantId == plant_id && client.wsType === 'plant') {
      client.send(JSON.stringify(payload));
    }
  });
}

// Notifica a clientes suscritos a un dispositivo
function notifyDeviceData(device_id, payload) {
  if (!wss) {
    console.warn('WebSocket server not initialized');
    return;
  }
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.subscribedDeviceId == device_id && client.wsType === 'device') {
      client.send(JSON.stringify(payload));
    }
  });
}

module.exports = {
  initWebSocket,
  notifySensorData,
  notifyPlantData,
  notifyDeviceData
};