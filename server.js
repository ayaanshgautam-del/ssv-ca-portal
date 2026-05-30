require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
const RSSParser = require('rss-parser');

const app = express();
const PORT = process.env.PORT || 3001;
const parser = new RSSParser({ timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SSV-CA-Portal/2.0)' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Health Check ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', firm: 'Saxena Singhal & Vaid', version: '2.0', apiKey: !!process.env.ANTHROPIC_API_KEY }));

// ── AI Tax Assistant — Real Claude API ───────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, history = [], mode = 'tax' } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('paste-your-key')) {
    return res.status(200).json({ reply: null, reason: 'no_key' });
  }

  try {
    const messages = [
      ...history.slice(-8).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: mode === 'chat'
          ? `You are a fun, friendly and witty assistant called SSV Assistant at Saxena Singhal & Vaid CA firm. In this Chat Mode you can talk about absolutely anything the user wants — IPL cricket scores, Bollywood gossip, Netflix recommendations, food, travel, jokes, trivia, motivation, tech, news, anything! Be like a fun best friend. Use emojis naturally. Keep responses short snappy and engaging. If asked about taxes offer to help but suggest switching to Tax Mode for detailed answers.`
          : `You are a senior Chartered Accountant assistant at Saxena Singhal & Vaid CA firm in India. Help clients with Indian tax queries — GST, Income Tax, TDS, ITR, MCA, FEMA, financial planning. Answer clearly and accurately. Use rupee symbol for amounts, mention relevant IT Act and GST Act sections. Format with bullet points using HTML br and strong tags. Be professional warm and helpful. Keep answers under 200 words. Current context: FY 2025-26, AY 2026-27.`,
        messages
      })
    });

    if (!response.ok) {
      const err = await response.json();
      if (err.error?.type === 'insufficient_quota' || response.status === 402) {
        return res.json({ reply: null, reason: 'no_credits' });
      }
      throw new Error('API error ' + response.status);
    }

    const data = await response.json();
    const reply = data.content?.find(c => c.type === 'text')?.text || '';
    res.json({ reply });

  } catch (err) {
    console.error('Chat error:', err.message);
    res.json({ reply: null, reason: 'error' });
  }
});

// ── RSS News ─────────────────────────────────────────────────
const RSS_FEEDS = [
  { url: 'https://economictimes.indiatimes.com/topic/income-tax/rss.cms', source: 'Economic Times', tag: 'Income Tax', tagColor: '#1B4F72' },
  { url: 'https://economictimes.indiatimes.com/topic/gst/rss.cms', source: 'Economic Times', tag: 'GST', tagColor: '#117A65' },
  { url: 'https://economictimes.indiatimes.com/topic/tds/rss.cms', source: 'Economic Times', tag: 'TDS', tagColor: '#884EA0' },
  { url: 'https://www.livemint.com/rss/money', source: 'Live Mint', tag: 'Finance', tagColor: '#B7950B' },
];

app.post('/api/news', async (req, res) => {
  try {
    const results = [];
    for (const feed of RSS_FEEDS) {
      try {
        const parsed = await parser.parseURL(feed.url);
        for (const item of parsed.items.slice(0, 2)) {
          const headline = (item.title || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
          if (!headline) continue;
          const date = item.pubDate ? new Date(item.pubDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Today';
          const h = headline.toLowerCase();
          const impact = ['deadline','penalty','mandatory','last date','new rule','amendment','tax rate'].some(w => h.includes(w)) ? 'High' : ['guide','tips','how to','explained'].some(w => h.includes(w)) ? 'Low' : 'Medium';
          results.push({ tag: feed.tag, tagColor: feed.tagColor, headline, impact, date, source: feed.source, link: item.link || '' });
        }
      } catch (e) { continue; }
    }
    res.json({ news: results.length > 0 ? results.slice(0, 6) : getFallback(), source: results.length > 0 ? 'rss' : 'fallback' });
  } catch (e) { res.json({ news: getFallback(), source: 'fallback' }); }
});

function getFallback() {
  return [
    { tag: 'GST', tagColor: '#117A65', headline: 'GSTN reminds taxpayers to file GSTR-3B before monthly due date to avoid late fees and interest.', impact: 'High', date: 'May 2025', source: 'GST Council', link: '' },
    { tag: 'Income Tax', tagColor: '#1B4F72', headline: 'CBDT advises verifying Form 26AS and AIS before ITR filing for Assessment Year 2025-26.', impact: 'High', date: 'May 2025', source: 'CBDT', link: '' },
    { tag: 'TDS', tagColor: '#884EA0', headline: 'Form 16 must be issued to all salaried employees by May 31, 2025 for FY 2024-25.', impact: 'High', date: 'May 2025', source: 'Income Tax Dept.', link: '' },
    { tag: 'MCA', tagColor: '#B7950B', headline: 'Annual ROC filings for FY 2024-25 must be completed on time to avoid additional fees.', impact: 'Medium', date: 'May 2025', source: 'MCA', link: '' },
    { tag: 'Budget', tagColor: '#C0392B', headline: 'New income tax regime continues — taxpayers advised to compare old vs new regime before filing.', impact: 'Medium', date: 'May 2025', source: 'Finance Ministry', link: '' },
    { tag: 'GST', tagColor: '#117A65', headline: 'ITC can only be claimed if invoice appears in GSTR-2B — proper reconciliation is mandatory.', impact: 'Medium', date: 'May 2025', source: 'GST Council', link: '' },
  ];
}

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log('\n  ┌──────────────────────────────────────────────┐');
  console.log('  │  Saxena Singhal & Vaid — CA Portal v2.0      │');
  console.log(`  │  Running → http://localhost:${PORT}              │`);
  console.log('  └──────────────────────────────────────────────┘\n');
  const hasKey = process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('paste-your-key');
  console.log(hasKey ? '  ✓ AI Tax Assistant: Claude AI (Full power!)' : '  ⚡ AI Tax Assistant: Smart local answers (add API key for Claude AI)');
  console.log('  ✓ News: Free RSS feeds (Economic Times + Live Mint)\n');
});
