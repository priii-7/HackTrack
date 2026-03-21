const express = require('express');
const router = express.Router();
const Hackathon = require('../models/Hackathon');
 
// GET all hackathons (upcoming only, sorted by reg_deadline)
router.get('/', async (req, res) => {
  try {
    const { tag, mode, search } = req.query;
    let filter = {};
 
    if (tag) filter.tags = tag;
    if (mode) filter.mode = mode;
    if (search) filter.name = { $regex: search, $options: 'i' };
 
    const hackathons = await Hackathon.find(filter).sort({ reg_deadline: 1 });
    res.json({ success: true, data: hackathons });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
 
// GET single hackathon
router.get('/:id', async (req, res) => {
  try {
    const hackathon = await Hackathon.findById(req.params.id);
    if (!hackathon) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: hackathon });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
 
// POST create new hackathon
router.post('/', async (req, res) => {
  try {
    const hackathon = new Hackathon(req.body);
    await hackathon.save();
    res.status(201).json({ success: true, data: hackathon });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});
 
// PUT update hackathon
router.put('/:id', async (req, res) => {
  try {
    const hackathon = await Hackathon.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!hackathon) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: hackathon });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});
 
// DELETE hackathon
router.delete('/:id', async (req, res) => {
  try {
    const hackathon = await Hackathon.findByIdAndDelete(req.params.id);
    if (!hackathon) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
 
// POST subscribe email to a hackathon's reminders
router.post('/:id/subscribe', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });
 
    const hackathon = await Hackathon.findById(req.params.id);
    if (!hackathon) return res.status(404).json({ success: false, message: 'Not found' });
 
    if (!hackathon.reminder_emails.includes(email)) {
      hackathon.reminder_emails.push(email);
      await hackathon.save();
    }
    res.json({ success: true, message: 'Subscribed for reminders!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
 
// POST add review
router.post('/:id/review', async (req, res) => {
  try {
    const { rating, comment, author } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ success: false, message: 'Rating must be 1–5' });
 
    const hackathon = await Hackathon.findById(req.params.id);
    if (!hackathon) return res.status(404).json({ success: false, message: 'Not found' });
 
    hackathon.reviews.push({ rating, comment, author });
    hackathon.updateAvgRating();
    await hackathon.save();
 
    res.json({ success: true, avg_rating: hackathon.avg_rating, total: hackathon.reviews.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
 
// GET reviews for a hackathon
router.get('/:id/reviews', async (req, res) => {
  try {
    const hackathon = await Hackathon.findById(req.params.id).select('reviews avg_rating name');
    if (!hackathon) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, reviews: hackathon.reviews, avg_rating: hackathon.avg_rating });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
 
module.exports = router;
