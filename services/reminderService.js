const nodemailer = require('nodemailer');
const cron = require('node-cron');
const Hackathon = require('../models/Hackathon');
const User = require('../models/User');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

function daysUntil(date) {
  const now = new Date();
  const diff = new Date(date) - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function emailHTML(hackathon, daysLeft, userEmail) {
  const urgentColor = daysLeft <= 1 ? '#e74c3c' : daysLeft <= 3 ? '#e67e22' : '#2980b9';
  const appURL = process.env.APP_URL || 'http://localhost:5000';
  return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #7c3aed, #db2777); padding: 28px; text-align: center;">
      <h1 style="color: #fff; margin: 0; font-size: 22px;">🌸 HackTrack Reminder</h1>
      <p style="color: rgba(255,255,255,0.8); margin: 6px 0 0; font-size: 14px;">Deadline approaching!</p>
    </div>
    <div style="padding: 28px;">
      <h2 style="color: #2e1065; margin-top: 0;">${hackathon.name}</h2>
      <p style="color: #555;">${hackathon.description || 'Get ready to hack!'}</p>

      <div style="background: #fdf4ff; border: 1.5px solid #e9d5ff; border-radius: 10px; padding: 18px; margin: 18px 0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 7px 0; color: #7c6f8e; font-size: 13px; width: 45%;">Organizer</td>
            <td style="padding: 7px 0; font-weight: bold; color: #2e1065;">${hackathon.organizer || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #7c6f8e; font-size: 13px;">Theme</td>
            <td style="padding: 7px 0; font-weight: bold; color: #2e1065;">${hackathon.theme || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #7c6f8e; font-size: 13px;">Mode</td>
            <td style="padding: 7px 0; font-weight: bold; color: #2e1065;">${hackathon.mode}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #7c6f8e; font-size: 13px;">Prize</td>
            <td style="padding: 7px 0; font-weight: bold; color: #2e1065;">${hackathon.prize || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #7c6f8e; font-size: 13px;">Team Size</td>
            <td style="padding: 7px 0; font-weight: bold; color: #2e1065;">${hackathon.team_size || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #7c6f8e; font-size: 13px;">Registration Deadline</td>
            <td style="padding: 7px 0; font-weight: bold; color: ${urgentColor};">
              ${new Date(hackathon.reg_deadline).toDateString()}
              &nbsp;
              <span style="background:${urgentColor}; color:white; padding: 2px 8px; border-radius: 20px; font-size: 12px;">
                ${daysLeft === 0 ? 'TODAY!' : daysLeft + ' day(s) left'}
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #7c6f8e; font-size: 13px;">Submission Deadline</td>
            <td style="padding: 7px 0; font-weight: bold; color: #2e1065;">${new Date(hackathon.sub_deadline).toDateString()}</td>
          </tr>
        </table>
      </div>

      ${hackathon.extra_dates && hackathon.extra_dates.length ? `
      <div style="margin: 16px 0;">
        <p style="font-weight: bold; color: #7c3aed; margin-bottom: 8px;">📅 Other Important Dates</p>
        ${hackathon.extra_dates.map(d => `
          <div style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #f0e6ff; font-size: 13px;">
            <span style="color: #7c6f8e;">${d.label}</span>
            <span style="font-weight: bold;">${new Date(d.date).toDateString()}</span>
          </div>`).join('')}
      </div>` : ''}

      <div style="text-align: center; margin-top: 24px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
        ${hackathon.url ? `
        <a href="${hackathon.url}"
           style="background: linear-gradient(135deg, #7c3aed, #db2777); color: white; padding: 13px 28px; border-radius: 10px; text-decoration: none; font-weight: bold; display: inline-block;">
          Register Now →
        </a>` : ''}
        <a href="${appURL}"
           style="background: #f3e8ff; color: #7c3aed; padding: 13px 28px; border-radius: 10px; text-decoration: none; font-weight: bold; display: inline-block; border: 1.5px solid #e9d5ff;">
          Open HackTrack
        </a>
      </div>
    </div>

    <div style="background: #fdf4ff; padding: 16px; text-align: center; font-size: 12px; color: #9d8ec0; border-top: 1px solid #e9d5ff;">
      You're receiving this because you subscribed to reminders on HackTrack.<br/>
      <a href="${appURL}" style="color: #a78bfa;">Manage your subscriptions</a>
    </div>
  </div>`;
}

// ── SEND REMINDERS ─────────────────────────────────────
// Sends to all emails in hackathon.reminder_emails (which includes registered users)
async function sendReminders() {
  try {
    const reminderDays = parseInt(process.env.REMINDER_DAYS_BEFORE) || 3;

    // Find hackathons whose deadline is approaching and haven't sent final reminder yet
    const hackathons = await Hackathon.find({
      reminder_sent: false,
      reminder_emails: { $exists: true, $not: { $size: 0 } }
    });

    let totalSent = 0;

    for (const h of hackathons) {
      const daysLeft = daysUntil(h.reg_deadline);

      // Only send if within reminder window and not yet expired
      if (daysLeft <= reminderDays && daysLeft >= 0) {
        // Send individual email to each subscriber so we can personalise later
        for (const email of h.reminder_emails) {
          try {
            await transporter.sendMail({
              from: `"HackTrack 🌸" <${process.env.EMAIL_USER}>`,
              to: email,
              subject: `⏰ ${daysLeft === 0 ? 'TODAY' : daysLeft + ' day(s) left'}: ${h.name} registration closes soon!`,
              html: emailHTML(h, daysLeft, email)
            });
            totalSent++;
          } catch (mailErr) {
            console.error(`  ❌ Failed to email ${email}:`, mailErr.message);
          }
        }

        console.log(`✅ Reminders sent for: ${h.name} (${daysLeft}d left) → ${h.reminder_emails.length} subscriber(s)`);

        // Mark as fully sent only on deadline day
        if (daysLeft === 0) {
          h.reminder_sent = true;
          await h.save();
        }
      }
    }

    if (totalSent > 0) console.log(`📧 Total emails sent: ${totalSent}`);
    else console.log('📭 No reminders to send today.');

  } catch (err) {
    console.error('Reminder job error:', err.message);
  }
}

// ── SEND WELCOME EMAIL when user registers ─────────────
async function sendWelcomeEmail(user) {
  const appURL = process.env.APP_URL || 'http://localhost:5000';
  try {
    await transporter.sendMail({
      from: `"HackTrack 🌸" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: '🌸 Welcome to HackTrack!',
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #e9d5ff; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #7c3aed, #db2777); padding: 32px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 26px;">🌸 Welcome to HackTrack!</h1>
        </div>
        <div style="padding: 28px;">
          <p style="font-size: 16px; color: #2e1065;">Hey <strong>${user.name}</strong> 👋</p>
          <p style="color: #555; line-height: 1.6;">
            You're now set up to track hackathon deadlines and receive reminders before they close.
            Never miss a registration deadline again!
          </p>
          <ul style="color: #555; line-height: 2;">
            <li>📋 Browse all upcoming hackathons</li>
            <li>🔔 Click <strong>"Subscribe"</strong> on any hackathon to get deadline emails</li>
            <li>📅 View deadlines on the calendar</li>
            <li>🔖 Bookmark your favourites</li>
          </ul>
          <div style="text-align: center; margin-top: 24px;">
            <a href="${appURL}" style="background: linear-gradient(135deg, #7c3aed, #db2777); color: white; padding: 13px 32px; border-radius: 10px; text-decoration: none; font-weight: bold; display: inline-block;">
              Open HackTrack →
            </a>
          </div>
        </div>
        <div style="background: #fdf4ff; padding: 14px; text-align: center; font-size: 12px; color: #9d8ec0; border-top: 1px solid #e9d5ff;">
          HackTrack — Never miss a hackathon deadline 🌸
        </div>
      </div>`
    });
    console.log(`📧 Welcome email sent to ${user.email}`);
  } catch (err) {
    console.error('Welcome email error:', err.message);
  }
}

// ── CRON JOB — runs daily at 8:00 AM ──────────────────
function startReminderJob() {
  cron.schedule('0 8 * * *', () => {
    console.log('🔔 Running daily reminder check...');
    sendReminders();
  });
  console.log('📅 Reminder cron job scheduled (daily at 8:00 AM)');
}

module.exports = { startReminderJob, sendReminders, sendWelcomeEmail };