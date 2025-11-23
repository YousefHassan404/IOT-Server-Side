// backend/index.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const morgan = require('morgan');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// In-memory store (keep it small; use DB for persistence)
const MAX_READINGS = 5000;
const readings = []; // { sensorId, distance, timestamp, status, extra }

// REST: receive readings from ESP
app.post('/api/ultrasonic', (req, res) => {
  /*
    Expected JSON:
    {
      "sensorId": "esp-01",
      "distance": 23.5,
      "timestamp": 1680000000000, // optional unix ms
      "status": "OK" // optional
      "meta": { "voltage": 4.9 }
    }
  */
  const payload = req.body;
  if (!payload || typeof payload.distance === 'undefined') {
    return res.status(400).json({ ok: false, message: "distance required" });
  }

  const record = {
    sensorId: payload.sensorId || 'unknown',
    distance: Number(payload.distance),
    timestamp: payload.timestamp ? Number(payload.timestamp) : Date.now(),
    status: payload.status || 'OK',
    meta: payload.meta || {}
  };

  // push and cap
  readings.push(record);
  if (readings.length > MAX_READINGS) {
    readings.shift();
  }

  // emit to connected clients
  io.emit('reading', record);

  return res.json({ ok: true, record });
});

// REST: get latest N readings
app.get('/api/readings', (req, res) => {
  const n = Math.max(1, Math.min(1000, Number(req.query.n) || 200));
  const last = readings.slice(-n);
  res.json({ ok: true, count: last.length, readings: last });
});

// optional: get active sensors summary
app.get('/api/sensors', (req, res) => {
  const bySensor = {};
  for (const r of readings) {
    bySensor[r.sensorId] = bySensor[r.sensorId] || { count: 0, last: null };
    bySensor[r.sensorId].count++;
    bySensor[r.sensorId].last = r;
  }
  res.json({ ok: true, sensors: bySensor });
});

// welcome endpoint
app.get('/', (req, res) => {
  res.send('Welcome to backend of the IOT client server');
});



// Socket.IO connection
io.on('connection', socket => {
  console.log('Client connected', socket.id);
  // send recent snapshot
  socket.emit('snapshot', readings.slice(-200));

  socket.on('disconnect', () => {
    console.log('Client disconnected', socket.id);
  });
});



const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
