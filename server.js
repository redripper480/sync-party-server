// server.js
// Run with: node server.js
// Make sure you did: npm init -y && npm install ws

const WebSocket = require('ws');

const PORT = 8090;

const wss = new WebSocket.Server({ port: PORT });

/**
 * rooms: Map<roomId, { url: string, clients: Set<WebSocket>, createdAt: Date }>
 */
const rooms = new Map();

console.log(`[SyncParty][SERVER] WebSocket server running on ws://localhost:${PORT}`);

wss.on('connection', (ws, req) => {
  ws.clientId = null;
  ws.currentRoomId = null;

  console.log('[SyncParty][SERVER] New connection from', req.socket.remoteAddress);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      console.error('[SyncParty][SERVER] Failed to parse message:', data.toString(), err);
      return;
    }

    if (msg.clientId) {
      ws.clientId = msg.clientId;
    }

    console.log('[SyncParty][SERVER] Received:', msg);

    if (!msg.type) {
      console.warn('[SyncParty][SERVER] Message without type, ignoring.');
      return;
    }

    switch (msg.type) {
      case 'CREATE_ROOM':
        handleCreateRoom(ws, msg);
        break;
      case 'JOIN_ROOM':
        handleJoinRoom(ws, msg);
        break;
      case 'VIDEO_EVENT':
        handleVideoEvent(ws, msg);
        break;
      default:
        console.warn('[SyncParty][SERVER] Unknown message type:', msg.type);
    }
  });

  ws.on('close', (code, reason) => {
    console.warn(
      '[SyncParty][SERVER] Connection closed. clientId=',
      ws.clientId,
      'code=',
      code,
      'reason=',
      reason.toString()
    );
    detachFromRoom(ws);
  });

  ws.on('error', (err) => {
    console.error('[SyncParty][SERVER] WebSocket error for client', ws.clientId, ':', err);
  });
});

function handleCreateRoom(ws, msg) {
  const { roomId, url, requestId } = msg;
  if (!roomId || !requestId) {
    console.error('[SyncParty][SERVER] CREATE_ROOM missing roomId or requestId:', msg);
    safeSend(ws, {
      type: 'ROOM_CREATED',
      ok: false,
      roomId: roomId || null,
      requestId,
      reason: 'Missing roomId or requestId'
    });
    return;
  }

  if (rooms.has(roomId)) {
    console.warn('[SyncParty][SERVER] Room already exists:', roomId);
    safeSend(ws, {
      type: 'ROOM_CREATED',
      ok: false,
      roomId,
      requestId,
      reason: 'Room already exists'
    });
    return;
  }

  const room = {
    url: url || null,
    clients: new Set([ws]),
    createdAt: new Date()
  };
  rooms.set(roomId, room);
  ws.currentRoomId = roomId;

  console.log('[SyncParty][SERVER] Room created:', roomId, 'url=', room.url);

  safeSend(ws, {
    type: 'ROOM_CREATED',
    ok: true,
    roomId,
    requestId,
    url: room.url
  });
}

function handleJoinRoom(ws, msg) {
  const { roomId, requestId } = msg;
  if (!roomId || !requestId) {
    console.error('[SyncParty][SERVER] JOIN_ROOM missing roomId or requestId:', msg);
    safeSend(ws, {
      type: 'ROOM_JOINED',
      ok: false,
      roomId: roomId || null,
      requestId,
      reason: 'Missing roomId or requestId'
    });
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    console.warn('[SyncParty][SERVER] JOIN_ROOM requested for non-existent room:', roomId);
    safeSend(ws, {
      type: 'ROOM_JOINED',
      ok: false,
      roomId,
      requestId,
      reason: 'Room not found'
    });
    return;
  }

  room.clients.add(ws);
  ws.currentRoomId = roomId;

  console.log('[SyncParty][SERVER] Client joined room:', roomId, 'clientId=', ws.clientId);

  safeSend(ws, {
    type: 'ROOM_JOINED',
    ok: true,
    roomId,
    requestId,
    url: room.url
  });
}

function handleVideoEvent(ws, msg) {
  const { roomId, event, time, playing } = msg;
  if (!roomId || !event) {
    console.error('[SyncParty][SERVER] VIDEO_EVENT missing roomId or event:', msg);
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    console.warn('[SyncParty][SERVER] VIDEO_EVENT for non-existent room:', roomId);
    return;
  }

  console.log('[SyncParty][SERVER] VIDEO_EVENT', {
    roomId,
    event,
    time,
    playing,
    from: ws.clientId
  });

  for (const client of room.clients) {
    if (client === ws) continue;
    if (client.readyState !== WebSocket.OPEN) continue;

    safeSend(client, {
      type: 'VIDEO_EVENT',
      roomId,
      event,
      time,
      playing,
      fromClientId: ws.clientId || null
    });
  }
}

function detachFromRoom(ws) {
  const roomId = ws.currentRoomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (!room) return;

  room.clients.delete(ws);
  ws.currentRoomId = null;

  console.log(
    '[SyncParty][SERVER] Client removed from room:',
    roomId,
    'remaining size=',
    room.clients.size
  );

  if (room.clients.size === 0) {
    rooms.delete(roomId);
    console.log('[SyncParty][SERVER] Room deleted because empty:', roomId);
  }
}

function safeSend(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch (err) {
    console.error('[SyncParty][SERVER] Error sending to client:', err, obj);
  }
}
