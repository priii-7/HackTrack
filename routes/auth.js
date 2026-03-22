const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Hackathon = require('../models/Hackathon');
const auth = require('../middleware/authMiddleware');

function generateToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// ── REGISTER ───────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'All fields are required' });
    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    const exists = await User.findOne({ email });
    if (exists)
      return res.status(400).json({ success: false, message: 'Email already registered' });

    const user = await User.create({ name, email, password });
    res.status(201).json({
      success: true,
      message: 'Account created!',
      token: generateToken(user._id),
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── LOGIN ──────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    const user = await User.findOne({ email });
    if (!user || !(await user.matchPassword(password)))
      return res.status(401).json({ success: false, message: 'Invalid email or password' });

    res.json({
      success: true,
      message: 'Logged in!',
      token: generateToken(user._id),
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET PROFILE ────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      subscribed_hackathons: req.user.subscribed_hackathons
    }
  });
});

// ── SUBSCRIBE to hackathon deadline emails ─────────────
// POST /api/auth/subscribe/:hackathonId
router.post('/subscribe/:hackathonId', auth, async (req, res) => {
  try {
    const { hackathonId } = req.params;
    const user = req.user;

    const hackathon = await Hackathon.findById(hackathonId);
    if (!hackathon)
      return res.status(404).json({ success: false, message: 'Hackathon not found' });

    // Add to user's subscription list
    if (!user.subscribed_hackathons.includes(hackathonId)) {
      user.subscribed_hackathons.push(hackathonId);
      await user.save();
    }

    // Also add email to hackathon's reminder_emails (for existing reminderService)
    if (!hackathon.reminder_emails.includes(user.email)) {
      hackathon.reminder_emails.push(user.email);
      hackathon.reminder_sent = false; // reset so cron re-evaluates
      await hackathon.save();
    }

    res.json({ success: true, message: `You'll get deadline reminders for "${hackathon.name}" at ${user.email}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── UNSUBSCRIBE from hackathon deadline emails ─────────
router.delete('/subscribe/:hackathonId', auth, async (req, res) => {
  try {
    const { hackathonId } = req.params;
    const user = req.user;

    const hackathon = await Hackathon.findById(hackathonId);
    if (!hackathon)
      return res.status(404).json({ success: false, message: 'Hackathon not found' });

    // Remove from user's subscriptions
    user.subscribed_hackathons = user.subscribed_hackathons.filter(
      id => id.toString() !== hackathonId
    );
    await user.save();

    // Remove from hackathon's reminder_emails
    hackathon.reminder_emails = hackathon.reminder_emails.filter(e => e !== user.email);
    await hackathon.save();

    res.json({ success: true, message: `Unsubscribed from "${hackathon.name}"` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET subscribed hackathons for logged-in user ───────
router.get('/subscriptions', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('subscribed_hackathons');
    res.json({ success: true, data: user.subscribed_hackathons });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;