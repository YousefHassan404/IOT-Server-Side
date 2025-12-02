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

const MAX_READINGS = 5000;
const readings = [];

// تخزين أوامر التحكم لكل جهاز
const deviceControls = {
  'esp-01': {
    led: 'off',
    buzzer: 'off',
    servo: 'enabled',
    servoAngle: 90,
    lastUpdated: Date.now()
  }
};

//==================== Routes ====================//

// استقبال بيانات المستشعرات
app.post('/api/ultrasonic', (req, res) => {
  const payload = req.body;
  
  if (!payload || typeof payload.distance === 'undefined') {
    return res.status(400).json({ ok: false, message: "distance required" });
  }

  const record = {
    sensorId: payload.sensorId || 'unknown',
    distance: Number(payload.distance),
    temperature: Number(payload.temperature) || 0,
    humidity: Number(payload.humidity) || 0,
    gas: Number(payload.gas) || 0,
    ledState: payload.ledState || 'off',
    buzzerState: payload.buzzerState || 'off',
    servoEnabled: payload.servoEnabled || false,
    servoAngle: Number(payload.servoAngle) || 90,
    timestamp: payload.timestamp ? Number(payload.timestamp) : Date.now(),
    status: payload.status || 'OK',
    meta: payload.meta || {}
  };

  // حفظ القراءة
  readings.push(record);
  if (readings.length > MAX_READINGS) {
    readings.shift();
  }

  // تحديث حالة الجهاز
  if (deviceControls[record.sensorId]) {
    deviceControls[record.sensorId].led = record.ledState;
    deviceControls[record.sensorId].buzzer = record.buzzerState;
    deviceControls[record.sensorId].servo = record.servoEnabled ? 'enabled' : 'disabled';
    deviceControls[record.sensorId].servoAngle = record.servoAngle;
    deviceControls[record.sensorId].lastUpdated = Date.now();
  }

  // إرسال للعملاء المتصلين
  io.emit('reading', record);
  io.emit('deviceUpdate', {
    sensorId: record.sensorId,
    controls: deviceControls[record.sensorId]
  });

  return res.json({ ok: true, record });
});

// REST: الحصول على أحدث القراءات
app.get('/api/readings', (req, res) => {
  const n = Math.max(1, Math.min(1000, Number(req.query.n) || 200));
  const last = readings.slice(-n);
  res.json({ ok: true, count: last.length, readings: last });
});

//==================== Control Endpoints ====================//

// الحصول على أوامر التحكم للجهاز
app.get('/api/control/:sensorId', (req, res) => {
  const { sensorId } = req.params;
  
  if (!deviceControls[sensorId]) {
    deviceControls[sensorId] = {
      led: 'off',
      buzzer: 'off',
      servo: 'enabled',
      servoAngle: 90,
      lastUpdated: Date.now()
    };
  }

  res.json({
    ok: true,
    sensorId,
    controls: deviceControls[sensorId]
  });
});

// تحديث أوامر التحكم للجهاز
app.post('/api/control/:sensorId', (req, res) => {
  const { sensorId } = req.params;
  const { led, buzzer, servo, servoAngle } = req.body;

  if (!deviceControls[sensorId]) {
    deviceControls[sensorId] = {
      led: 'off',
      buzzer: 'off',
      servo: 'enabled',
      servoAngle: 90,
      lastUpdated: Date.now()
    };
  }

  // تحديث الأوامر
  if (led === 'on' || led === 'off') {
    deviceControls[sensorId].led = led;
  }
  
  if (buzzer === 'on' || buzzer === 'off' || buzzer === 'beep') {
    deviceControls[sensorId].buzzer = buzzer;
  }
  
  if (servo === 'enabled' || servo === 'disabled') {
    deviceControls[sensorId].servo = servo;
  }
  
  if (servoAngle >= 0 && servoAngle <= 180) {
    deviceControls[sensorId].servoAngle = servoAngle;
  }

  deviceControls[sensorId].lastUpdated = Date.now();

  // إرسال تحديث عبر Socket.IO
  io.emit('controlUpdate', {
    sensorId,
    controls: deviceControls[sensorId]
  });

  res.json({
    ok: true,
    message: 'Control commands updated',
    controls: deviceControls[sensorId]
  });
});

// الحصول على حالة جميع الأجهزة
app.get('/api/devices', (req, res) => {
  res.json({
    ok: true,
    devices: deviceControls,
    readingsCount: readings.length
  });
});

// التحكم المباشر في جهاز محدد
app.post('/api/control/:sensorId/action', (req, res) => {
  const { sensorId } = req.params;
  const { action, value } = req.body;

  if (!deviceControls[sensorId]) {
    return res.status(404).json({ ok: false, message: 'Device not found' });
  }

  switch (action) {
    case 'led':
      if (value === 'on' || value === 'off') {
        deviceControls[sensorId].led = value;
      }
      break;
    
    case 'buzzer':
      if (value === 'on' || value === 'off' || value === 'beep') {
        deviceControls[sensorId].buzzer = value;
      }
      break;
    
    case 'servo':
      if (value === 'enable' || value === 'disable') {
        deviceControls[sensorId].servo = value === 'enable' ? 'enabled' : 'disabled';
      }
      break;
    
    case 'servoAngle':
      if (value >= 0 && value <= 180) {
        deviceControls[sensorId].servoAngle = value;
      }
      break;
  }

  deviceControls[sensorId].lastUpdated = Date.now();

  io.emit('controlUpdate', {
    sensorId,
    controls: deviceControls[sensorId]
  });

  res.json({
    ok: true,
    message: 'Action executed',
    controls: deviceControls[sensorId]
  });
});

//==================== Socket.IO ====================//
io.on('connection', socket => {
  console.log('Client connected', socket.id);
  
  // إرسال البيانات الحالية
  socket.emit('snapshot', readings.slice(-200));
  socket.emit('devicesSnapshot', deviceControls);

  socket.on('controlDevice', (data) => {
    const { sensorId, command, value } = data;
    
    if (deviceControls[sensorId]) {
      // تحديث الأوامر
      switch (command) {
        case 'led':
          deviceControls[sensorId].led = value;
          break;
        case 'buzzer':
          deviceControls[sensorId].buzzer = value;
          break;
        case 'servo':
          deviceControls[sensorId].servo = value;
          break;
        case 'servoAngle':
          deviceControls[sensorId].servoAngle = value;
          break;
      }
      
      deviceControls[sensorId].lastUpdated = Date.now();
      
      // بث التحديث لجميع العملاء
      io.emit('controlUpdate', {
        sensorId,
        controls: deviceControls[sensorId]
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected', socket.id);
  });
});

//==================== Start Server ====================//
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log(`  GET  /api/readings - Get sensor readings`);
  console.log(`  GET  /api/devices - Get all devices status`);
  console.log(`  GET  /api/control/:sensorId - Get device controls`);
  console.log(`  POST /api/control/:sensorId - Update device controls`);
  console.log(`  POST /api/control/:sensorId/action - Direct control action`);
});