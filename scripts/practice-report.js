#!/usr/bin/env node
// Summary of Practice mode rounds: npm run practice-report [-- path/to/practice-log.jsonl]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { questionLanguage } = require('../src/services/question-filter');

const file = process.argv[2] || path.join(os.homedir(), 'Library/Application Support/Interviewer Helper/practice-log.jsonl');
if (!fs.existsSync(file)) {
  console.log(`No practice log yet (${file}). Turn on ··· → Practice mode first.`);
  process.exit(0);
}
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const words = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9ñ]+/g) || [];
// Misheard: fewer than 60% of the question's words made it into the transcript
const heardShare = (r) => { const q = words(r.question); const t = new Set(words(r.transcript)); return q.length ? q.filter((w) => t.has(w)).length / q.length : 1; };
const shown = (r) => !!String(r.answer || '').replace(/[\s.…]/g, '');
const wrongWhy = (r) => {
  if (r.expect === 'none') return shown(r) ? 'answered a non-question' : '';
  if (!shown(r)) return 'no answer';
  const want = r.lang === 'en' ? 'English' : 'Spanish';
  return questionLanguage(r.answer) !== want ? `answered in the wrong language` : '';
};
const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const s = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(2)} s`);

const misheard = rows.filter((r) => heardShare(r) < 0.6);
const wrong = rows.map((r) => [r, wrongWhy(r)]).filter(([, why]) => why);
console.log(`${rows.length} practice rounds (${file})`);
console.log(`speech end → question: median ${s(median(rows.map((r) => r.toQuestionMs)))}, worst ${s(Math.max(...rows.map((r) => r.toQuestionMs || 0)))}`);
console.log(`question → first word: median ${s(median(rows.map((r) => r.toFirstWordMs)))}, worst ${s(Math.max(...rows.map((r) => r.toFirstWordMs || 0)))}`);
console.log(`answers from profile facts: ${rows.filter((r) => /profile facts/.test(r.source)).length}, with [tu ejemplo] placeholders: ${rows.filter((r) => /tu ejemplo/.test(r.source)).length}`);
console.log(`misheard: ${misheard.length}`);
for (const r of misheard) console.log(`  · "${r.question}" → heard "${r.transcript || '(nothing)'}"`);
console.log(`answered wrongly: ${wrong.length}`);
for (const [r, why] of wrong) console.log(`  · "${r.question}": ${why}`);
