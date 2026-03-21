const nodemailer = require('nodemailer');
const cron = require('node-cron');
const Hackathon = require('../models/Hackathon');

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

function emailHTML(hackathon, daysLeft) {
  const urgentColor = daysLeft <= 1 ? '#e74c3c' : daysLeft <= 3 ? '#e67e22' : '#2980b9';
  return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
    <div style="background: #1a1a2e; padding: 24px; text-align: center;">
      <h1 style="color: #fff; margin: 0; font-size: 22px;">⏰ Hackathon Deadline Reminder</h1>
    </div>
    <div style="padding: 24px;">
      <h2 style="color: #1a1a2e; margin-top: 0;">${hackathon.name}</h2>
      <p style="color: #555;">${hackathon.description || 'Get ready to hack!'}</p>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; color: #888; font-size: 13px;">Organizer</td>
            <td style="padding: 6px 0; font-weight: bold;">${hackathon.organizer || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #888; font-size: 13px;">Theme</td>
            <td style="padding: 6px 0; font-weight: bold;">${hackathon.theme || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #888; font-size: 13px;">Mode</td>
            <td style="padding: 6px 0; font-weight: bold;">${hackathon.mode}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #888; font-size: 13px;">Prize</td>
            <td style="padding: 6px 0; font-weight: bold;">${hackathon.prize || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #888; font-size: 13px;">Registration Deadline</td>
            <td style="padding: 6px 0; font-weight: bold; color: ${urgentColor};">
              ${new Date(hackathon.reg_deadline).toDateString()}
              (${daysLeft === 0 ? 'TODAY!' : daysLeft + ' day(s) left'})
            </td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #888; font-size: 13px;">Submission Deadline</td>
            <td style="padding: 6px 0; font-weight: bold;">${new Date(hackathon.sub_deadline).toDateString()}</td>
          </tr>
        </table>
      </div>
      ${hackathon.url ? `
      <div style="text-align: center; margin-top: 20px;">
        <a href="${hackathon.url}"
           style="background: #1a1a2e; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">
          Register Now →
        </a>
      </div>` : ''}
    </div>
    <div style="background: #f8f9fa; padding: 12px; text-align: center; font-size: 12px; color: #aaa;">
      You're receiving this because you subscribed to reminders on Hackathon Calendar.
    </div>
  </div>`;
}

async function sendReminders() {
  try {
    const reminderDays = parseInt(process.env.REMINDER_DAYS_BEFORE) || 3;
    const hackathons = await Hackathon.find({ reminder_sent: false });

    for (const h of hackathons) {
      const daysLeft = daysUntil(h.reg_deadline);

      if (daysLeft <= reminderDays && daysLeft >= 0 && h.reminder_emails.length > 0) {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: h.reminder_emails.join(','),
          subject: `⏰ ${daysLeft === 0 ? 'TODAY' : daysLeft + ' days left'}: ${h.name} registration deadline`,
          html: emailHTML(h, daysLeft)
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ Reminder sent for: ${h.name} to ${h.reminder_emails.length} subscriber(s)`);

        if (daysLeft === 0) {
          h.reminder_sent = true;
          await h.save();
        }
      }
    }
  } catch (err) {
    console.error('Reminder job error:', err.message);
  }
}

function startReminderJob() {
  cron.schedule('0 8 * * *', () => {
    console.log('🔔 Running daily reminder check...');
    sendReminders();
  });
  console.log('📅 Reminder cron job scheduled (daily at 8:00 AM)');
}

module.exports = { startReminderJob, sendReminders };