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
      hostname: 'google.serper.dev', path: '/search', method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
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
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
        timeout: 8000
      }, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchPage(res.headers.location).then(resolve);
        }
        let raw = '';
        res.on('data', c => { if (raw.length < 50000) raw += c; }); // limit to 50kb
        res.on('end', () => resolve(raw));
      });
      req.on('error', () => resolve(''));
      req.on('timeout', () => { req.destroy(); resolve(''); });
    } catch(e) { resolve(''); }
  });
}

// ── EXTRACT DATES FROM HTML ────────────────────────────
function extractDatesFromHTML(html, url) {
  const now = new Date();
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Patterns to look for near deadline keywords
  const deadlineKeywords = /(?:registr|deadline|last date|apply by|closes?|ends?|due)/i;
  const datePatterns = [
    // DD Month YYYY or Month DD, YYYY
    /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(\d{4})/gi,
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})/gi,
    // YYYY-MM-DD
    /(\d{4})-(\d{2})-(\d{2})/g,
    // DD/MM/YYYY
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/g,
  ];

  const foundDates = [];

  // Search around deadline keywords first
  const chunks = text.split(/\s+/);
  for (let i = 0; i < chunks.length; i++) {
    if (deadlineKeywords.test(chunks[i])) {
      const nearby = chunks.slice(Math.max(0, i-2), i+15).join(' ');
      for (const pattern of datePatterns) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(nearby)) !== null) {
          const d = new Date(m[0]);
          if (!isNaN(d) && d > now) foundDates.push({ date: d, priority: 1 });
        }
      }
    }
  }

  // Also search entire text for any future dates
  for (const pattern of datePatterns) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const d = new Date(m[0]);
      if (!isNaN(d) && d > now && d < new Date(now.getFullYear() + 2, 11, 31)) {
        foundDates.push({ date: d, priority: 0 });
      }
    }
  }

  // Sort by priority then by date
  foundDates.sort((a, b) => b.priority - a.priority || a.date - b.date);
  const uniqueDates = [...new Map(foundDates.map(d => [d.date.toDateString(), d])).values()].map(d => d.date);

  // Site-specific extraction
  if (url.includes('unstop.com')) {
    const unstopDate = text.match(/Registration.*?(\d{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (unstopDate) { const d = new Date(unstopDate[1]); if (!isNaN(d) && d > now) uniqueDates.unshift(d); }
  }
  if (url.includes('devfolio.co')) {
    const devfolioDate = text.match(/Apply by.*?(\w+\s+\d{1,2},?\s+\d{4})/i);
    if (devfolioDate) { const d = new Date(devfolioDate[1]); if (!isNaN(d) && d > now) uniqueDates.unshift(d); }
  }

  return uniqueDates.slice(0, 5);
}

// ── EXTRACT PRIZE FROM HTML ────────────────────────────
function extractPrize(html) {
  const text = html.replace(/<[^>]+>/g, ' ');
  const m = text.match(/(?:prize|reward|win|pool)[^₹$\d]*([₹$][\d,]+(?:\s*(?:lakhs?|k|cr))?|[\d,]+\s*(?:USD|INR|lakhs?|cr))/i);
  return m ? m[1].trim() : '';
}

// ── EXTRACT ORGANIZER FROM HTML ────────────────────────
function extractOrganizer(html) {
  const m = html.match(/<(?:h1|h2)[^>]*>([^<]{3,80})<\/(?:h1|h2)>/i);
  return m ? m[1].replace(/<[^>]+>/g,'').trim() : '';
}

// ── BUILD HACKATHON FROM URL ───────────────────────────
async function buildHackathonFromURL(result) {
  const now = new Date();
  console.log(`  📄 Fetching: ${result.url.substring(0, 60)}...`);

  const html = await fetchPage(result.url);
  const dates = html ? extractDatesFromHTML(html, result.url) : [];

  let reg_deadline, sub_deadline;
  if (dates.length >= 2) {
    reg_deadline = dates[0]; sub_deadline = dates[1];
  } else if (dates.length === 1) {
    reg_deadline = dates[0];
    sub_deadline = new Date(dates[0]); sub_deadline.setDate(sub_deadline.getDate() + 7);
  } else {
    // No dates found — skip this result
    console.log(`  ⚠️ No dates found for: ${result.title.substring(0,40)}`);
    return null;
  }

  const prize = html ? extractPrize(html) : '';
  const text = (result.title + ' ' + result.content).toLowerCase();
  const mode = text.includes('offline') || text.includes('in-person') ? 'Offline' :
               text.includes('hybrid') ? 'Hybrid' : 'Online';

  let source = 'web', tags = ['AI-discovered'];
  if (result.url.includes('unstop')) { source = 'unstop'; tags = ['Unstop']; }
  else if (result.url.includes('devpost')) { source = 'devpost'; tags = ['Devpost']; }
  else if (result.url.includes('hackerearth')) { source = 'hackerearth'; tags = ['HackerEarth']; }
  else if (result.url.includes('devfolio')) { source = 'devfolio'; tags = ['Devfolio']; }
  else if (result.url.includes('mlh')) { source = 'mlh'; tags = ['MLH']; }

  return {
    name: result.title.replace(/\s*[-|].*$/, '').trim().substring(0, 100),
    description: result.content.substring(0, 300),
    url: result.url,
    reg_deadline, sub_deadline,
    prize, mode, source, tags
  };
}

// ── MAIN ROUTE ─────────────────────────────────────────
router.post('/', async (req, res) => {
  console.log('\n=== DISCOVER STARTED ===');

  try {
    const queries = [
      'hackathon 2026 open registration India site:unstop.com OR site:devfolio.co',
      'hackathon 2026 open registration India site:devpost.com OR site:hackerearth.com',
      'upcoming hackathon India 2026 register now deadline'
    ];

    // Collect all unique results from Serper
    const seen = new Set();
    const allResults = [];

    for (const query of queries) {
      console.log(`🔍 Searching: "${query.substring(0, 50)}..."`);
      const data = await searchSerper(query);
      const organic = data.organic || [];
      console.log(`   Got ${organic.length} results`);
      for (const r of organic) {
        if (!seen.has(r.link) && r.title) {
          const text = (r.title + ' ' + (r.snippet||'')).toLowerCase();
          if (text.includes('hackathon') || text.includes('hack')) {
            seen.add(r.link);
            allResults.push({ url: r.link, title: r.title, content: r.snippet || '' });
          }
        }
      }
    }

    console.log(`\nTotal unique hackathon results: ${allResults.length}`);
    console.log('Fetching individual pages for real dates...\n');

    // Fetch each page to get real dates (limit to 8 to avoid timeout)
    let saved = 0, skipped = 0, noDate = 0;

    for (const result of allResults.slice(0, 8)) {
      try {
        const h = await buildHackathonFromURL(result);
        if (!h) { noDate++; continue; }

        const safeName = h.name.substring(0, 15).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const exists = await Hackathon.findOne({ name: { $regex: new RegExp(safeName, 'i') } });
        if (!exists) {
          await new Hackathon(h).save();
          saved++;
          console.log(`  ✅ Saved: ${h.name.substring(0,50)} | Reg: ${h.reg_deadline.toDateString()}`);
        } else {
          skipped++;
          console.log(`  ⏭ Already exists: ${h.name.substring(0,50)}`);
        }
      } catch(e) {
        console.log(`  ❌ Error processing result: ${e.message}`);
      }
    }

    console.log(`\n=== DONE: saved=${saved} skipped=${skipped} noDates=${noDate} ===\n`);

    res.json({
      success: true,
      message: saved > 0
        ? `Found & saved ${saved} new hackathons with real deadlines!`
        : skipped > 0
          ? `Found ${skipped} hackathons but they already exist in your list!`
          : `No new hackathons found this time. Try again tomorrow!`
    });

  } catch(err) {
    console.error('DISCOVER ERROR:', err.message);
    res.json({ success: false, message: 'Error: ' + err.message });
  }
});

module.exports = router;