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
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
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

// ── SAFE DATE PARSER ───────────────────────────────────
// Uses Date.UTC() for ALL formats so the date stored in MongoDB
// is always UTC noon — no timezone shift regardless of server location.
function safeParseDate(dateStr) {
  if (!dateStr) return null;

  const months = {
    jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
    jul:6, aug:7, sep:8, oct:9, nov:10, dec:11
  };

  // YYYY-MM-DD
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(Date.UTC(
      Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 12, 0, 0
    ));
  }

  // DD/MM/YYYY
  const dmyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    return new Date(Date.UTC(
      Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]), 12, 0, 0
    ));
  }

  // "15 Apr 2026" or "15 April 2026"
  const dmy = dateStr.match(/(\d{1,2})\s+([a-z]+)\.?\s*,?\s*(\d{4})/i);
  if (dmy) {
    const mon = months[dmy[2].toLowerCase().slice(0, 3)];
    if (mon !== undefined) {
      return new Date(Date.UTC(Number(dmy[3]), mon, Number(dmy[1]), 12, 0, 0));
    }
  }

  // "Apr 15, 2026" or "April 15 2026"
  const mdy = dateStr.match(/([a-z]+)\.?\s+(\d{1,2}),?\s*(\d{4})/i);
  if (mdy) {
    const mon = months[mdy[1].toLowerCase().slice(0, 3)];
    if (mon !== undefined) {
      return new Date(Date.UTC(Number(mdy[3]), mon, Number(mdy[2]), 12, 0, 0));
    }
  }

  return null;
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

  // Higher priority: dates near deadline keywords
  const chunks = text.split(/\s+/);
  for (let i = 0; i < chunks.length; i++) {
    if (deadlineKeywords.test(chunks[i])) {
      const nearby = chunks.slice(Math.max(0, i - 2), i + 15).join(' ');
      for (const pattern of datePatterns) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(nearby)) !== null) {
          const d = safeParseDate(m[0]);
          if (d && d > now) foundDates.push({ date: d, priority: 1 });
        }
      }
    }
  }

  // Lower priority: all dates in full text
  for (const pattern of datePatterns) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const d = safeParseDate(m[0]);
      if (d && d > now && d < new Date(now.getFullYear() + 2, 11, 31)) {
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
  console.log(`  📄 Fetching: ${result.url.substring(0, 60)}...`);

  const html = await fetchPage(result.url);
  const dates = html ? extractDatesFromHTML(html, result.url) : [];

  let reg_deadline, sub_deadline;

  if (dates.length >= 2) {
    reg_deadline = dates[0];
    sub_deadline = dates[1];
  } else if (dates.length === 1) {
    reg_deadline = dates[0];
    // Add exactly 7 days in UTC to avoid DST issues
    sub_deadline = new Date(reg_deadline.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else {
    console.log(`  ⚠️ No dates found for: ${result.title.substring(0, 40)}`);
    return null;
  }

  const text = (result.title + ' ' + result.content).toLowerCase();
  const mode = text.includes('offline') || text.includes('in-person') ? 'Offline'
             : text.includes('hybrid') ? 'Hybrid' : 'Online';

  let source = 'web', tags = ['AI-discovered'];
  if (result.url.includes('unstop'))       { source = 'unstop';      tags = ['Unstop'];      }
  else if (result.url.includes('devpost'))      { source = 'devpost';     tags = ['Devpost'];     }
  else if (result.url.includes('hackerearth'))  { source = 'hackerearth'; tags = ['HackerEarth']; }
  else if (result.url.includes('devfolio'))     { source = 'devfolio';    tags = ['Devfolio'];    }
  else if (result.url.includes('mlh'))          { source = 'mlh';         tags = ['MLH'];         }

  return {
    name: result.title.replace(/\s*[-|].*$/, '').trim().substring(0, 100),
    description: (result.content || '').substring(0, 300),
    url: result.url,
    reg_deadline,
    sub_deadline,
    mode,
    source,
    tags
  };
}

// ── MAIN ROUTE ─────────────────────────────────────────
router.post('/', async (req, res) => {
  console.log('\n=== DISCOVER STARTED ===');
  try {
    const queries = [
      'hackathon 2026 open registration India site:unstop.com OR site:devfolio.co',
      'hackathon 2026 open registration India site:devpost.com OR site:hackerearth.com',
      'upcoming hackathon India 2026 register now deadline',
      'hackathon April May 2026 India registration open'
    ];

    const seen = new Set();
    const allResults = [];

    for (const query of queries) {
      console.log(`🔍 Searching: "${query.substring(0, 50)}..."`);
      const data = await searchSerper(query);
      const organic = data.organic || [];
      console.log(`   Got ${organic.length} results`);
      for (const r of organic) {
        if (!seen.has(r.link) && r.title) {
          const text = (r.title + ' ' + (r.snippet || '')).toLowerCase();
          if (text.includes('hackathon') || text.includes('hack')) {
            seen.add(r.link);
            allResults.push({ url: r.link, title: r.title, content: r.snippet || '' });
          }
        }
      }
    }

    console.log(`\nTotal unique results: ${allResults.length}`);

    let saved = 0, skipped = 0, noDate = 0;

    for (const result of allResults.slice(0, 8)) {
      try {
        const h = await buildHackathonFromURL(result);
        if (!h) { noDate++; continue; }

        if (new Date(h.reg_deadline) < new Date()) {
          console.log(`  ⏰ Deadline passed, skipping: ${h.name.substring(0, 50)}`);
          noDate++;
          continue;
        }

        const safeName = h.name.substring(0, 15).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const exists = await Hackathon.findOne({ name: { $regex: new RegExp(safeName, 'i') } });

        if (!exists) {
          await new Hackathon(h).save();
          saved++;
          console.log(`  ✅ Saved: ${h.name.substring(0, 50)} | Reg: ${h.reg_deadline.toISOString()}`);
        } else {
          skipped++;
          console.log(`  ⏭ Already exists: ${h.name.substring(0, 50)}`);
        }
      } catch(e) {
        console.log(`  ❌ Error: ${e.message}`);
      }
    }

    console.log(`\n=== DONE: saved=${saved} skipped=${skipped} noDates=${noDate} ===\n`);

    res.json({
      success: true,
      message: saved > 0
        ? `Found & saved ${saved} new hackathons!`
        : skipped > 0
          ? `Found ${skipped} hackathons but they already exist!`
          : `No new hackathons found this time. Try again later!`
    });

  } catch(err) {
    console.error('DISCOVER ERROR:', err.message);
    res.json({ success: false, message: 'Error: ' + err.message });
  }
});

module.exports = router;