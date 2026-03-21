const mongoose = require('mongoose');
 
const reviewSchema = new mongoose.Schema({
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, trim: true, maxlength: 500 },
  author: { type: String, trim: true, default: 'Anonymous' },
  created_at: { type: Date, default: Date.now }
});
 
const linkSchema = new mongoose.Schema({
  label: { type: String, trim: true, required: true },  // e.g. "Registration Form", "Problem Statements"
  url: { type: String, trim: true, required: true }
});
 
const dateSchema = new mongoose.Schema({
  label: { type: String, trim: true, required: true },  // e.g. "Final Round", "Mentoring Session"
  date: { type: Date, required: true }
});
 
const hackathonSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  organizer: { type: String, trim: true },
  theme: { type: String, trim: true },
  description: { type: String, trim: true },
  reg_deadline: { type: Date, required: true },
  sub_deadline: { type: Date, required: true },
  extra_dates: [dateSchema],       // Final round, shortlist announcement, etc.
  prize: { type: String, trim: true },
  team_size: { type: String, trim: true },
  mode: { type: String, enum: ['Online', 'Offline', 'Hybrid'], default: 'Online' },
  url: { type: String, trim: true },
  extra_links: [linkSchema],       // Registration form, problem statement, etc.
  tags: [String],
  source: { type: String, default: 'manual' },
  reminder_emails: [String],
  reminder_sent: { type: Boolean, default: false },
  reviews: [reviewSchema],
  avg_rating: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
});
 
hackathonSchema.methods.updateAvgRating = function () {
  if (this.reviews.length === 0) { this.avg_rating = 0; return; }
  const sum = this.reviews.reduce((acc, r) => acc + r.rating, 0);
  this.avg_rating = Math.round((sum / this.reviews.length) * 10) / 10;
};
 
module.exports = mongoose.model('Hackathon', hackathonSchema);
