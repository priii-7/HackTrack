const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const Hackathon = require('../models/Hackathon');

// ── SERPER SEARCH ──────────────────────────────────────
function searchSerper(query) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ q: query, num: 10, gl: 'in', hl: 'en' });
    const req = https.request({
      hostname: 'google.serper.dev',
      path: '/search',
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { console.log('Serper parse error'); resolve({}); }
      });
    });
    req.on('error', e => { console.log('Serper error:', e.message); resolve({}); });
    req.write(body); req.end();
  });
}

// ── FETCH PAGE CONTENT ─────────────────────────────────
function fetchPage(url) {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'text/html'
        },
        timeout: 8000
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchPage(res.headers.location).then(resolve);
        }
        let raw = '';
        res.on('data', c => { if (raw.length < 50000) raw += c; });
        res.on('end', () => resolve(raw));
      });
      req.on('error', () => resolve(''));
      req.on('timeout', () => { req.destroy(); resolve(''); });
    } catch(e) { resolve(''); }
  });
}

// ── SAFE DATE PARSER (FIXED) ───────────────────────────
function safeParseDate(dateStr) {
  if (!dateStr) return null;

  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3]),
      12, 0, 0
    );
  }

  const dmyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    return new Date(
      Number(dmyMatch[3]),
      Number(dmyMatch[2]) - 1,
      Number(dmyMatch[1]),
      12, 0, 0
    );
  }

  const parsed = new Date(dateStr);
  if (isNaN(parsed)) return null;

  return new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    12, 0, 0
  );
}

// ── EXTRACT DATES FROM HTML ────────────────────────────
function extractDatesFromHTML(html, url) {
  const now = new Date();
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const deadlineKeywords = /(?:registr|deadline|last date|apply by|closes?|ends?|due)/i;

  const datePatterns = [
    /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(\d{4})/gi,
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})/gi,
    /(\d{4})-(\d{2})-(\d{2})/g,
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/g,
  ];

  const foundDates = [];

  const chunks = text.split(/\s+/);
  for (let i = 0; i < chunks.length; i++) {
    if (deadlineKeywords.test(chunks[i])) {
      const nearby = chunks.slice(Math.max(0, i - 2), i + 15).join(' ');

      for (const pattern of datePatterns) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(nearby)) !== null) {
          const d = safeParseDate(m[0]);
          if (d && d > now) {
            foundDates.push({ date: d, priority: 1 });
          }
        }
      }
    }
  }

  for (const pattern of datePatterns) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const d = safeParseDate(m[0]);
      if (
        d &&
        d > now &&
        d < new Date(now.getFullYear() + 2, 11, 31)
      ) {
        foundDates.push({ date: d, priority: 0 });
      }
    }
  }

  foundDates.sort((a, b) => b.priority - a.priority || a.date - b.date);

  const uniqueDates = [
    ...new Map(foundDates.map(d => [d.date.toDateString(), d])).values()
  ].map(d => d.date);

  return uniqueDates.slice(0, 5);
}

// ── BUILD HACKATHON FROM URL ───────────────────────────
async function buildHackathonFromURL(result) {
  const html = await fetchPage(result.url);
  const dates = html ? extractDatesFromHTML(html, result.url) : [];

  let reg_deadline, sub_deadline;

  if (dates.length >= 2) {
    reg_deadline = dates[0];
    sub_deadline = dates[1];
  } else if (dates.length === 1) {
    reg_deadline = dates[0];
    sub_deadline = new Date(dates[0]);
    sub_deadline.setDate(sub_deadline.getDate() + 7);
  } else {
    return null;
  }

  return {
    name: result.title,
    description: result.content,
    url: result.url,
    reg_deadline,
    sub_deadline
  };
}

// ── MAIN ROUTE ─────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const data = await searchSerper('hackathons 2026 India');
    const results = data.organic || [];

    let saved = 0;

    for (const r of results.slice(0, 5)) {
      const h = await buildHackathonFromURL({
        url: r.link,
        title: r.title,
        content: r.snippet
      });

      if (!h) continue;

      if (h.reg_deadline < new Date()) continue;

      const exists = await Hackathon.findOne({ name: h.name });

      if (!exists) {
        await new Hackathon({
          ...h,
          reg_deadline: h.reg_deadline,
          sub_deadline: h.sub_deadline
        }).save();

        saved++;
      }
    }

    res.json({ success: true, saved });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;