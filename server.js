require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const hackathonRoutes = require('./routes/hackathons');
const discoverRoutes  = require('./routes/discover');
const authRoutes      = require('./routes/auth');
const { startReminderJob } = require('./services/reminderService');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API ROUTES ─────────────────────────────────────────
app.use('/api/hackathons', hackathonRoutes);
app.use('/api/discover',   discoverRoutes);
app.use('/api/auth',       authRoutes);

// ── CATCH-ALL — serve frontend ─────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ──────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
      startReminderJob();
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });