// Practice mode: the Mac reads a random interview question out loud through the speakers, so the
// real pipeline (mic → live words → Whisper → answer) runs end to end, and each round is timed
// and logged to <userData>/practice-log.jsonl (summary: npm run practice-report).
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../core/logger').createServiceLogger('PRACTICE');

const VOICES = { es: 'Mónica', en: 'Samantha' };
// expect: 'answer' = should get a card; 'none' = must show nothing
const BANK = [
  ['es', '¿Cuál ha sido el proyecto más difícil en el que has trabajado?'],
  ['es', 'Cuéntame un poco sobre ti.'],
  ['es', '¿Por qué quieres trabajar en banca de inversión?'],
  ['es', '¿Por qué consultoría y no banca?'],
  ['es', '¿Qué experiencia tienes con Python?'],
  ['es', 'Háblame de tus últimas prácticas.'],
  ['es', 'Cuéntame una vez que fracasaste y qué aprendiste.'],
  ['es', 'Una empresa tiene un EBITDA de 50 millones, cotiza a 8 veces EBITDA y tiene 100 millones de deuda neta. ¿Cuál es el valor del equity?'],
  ['es', '¿Cuál es tu mayor debilidad?'],
  ['es', '¿Dónde te ves dentro de cinco años?'],
  ['es', 'Hola, ¿me oyes bien?', 'none'],
  ['en', 'Tell me about yourself.'],
  ['en', 'Why investment banking?'],
  ['en', 'Why do you want to work in tech?'],
  ["en", "What's your biggest weakness?"],
  ['en', 'Walk me through a DCF.'],
  ['en', 'Tell me about a time you worked in a team under pressure.'],
  ['en', 'What is WACC and how do you calculate it?'],
  ['en', 'How would you value a company that has no profits yet?'],
  ['en', 'Why should we hire you?'],
  ['en', 'Can you hear me okay?', 'none']
].map(([lang, q, expect = 'answer']) => ({ lang, q, expect }));

// An answer that names a proper noun from the user's profile (<userData>/profile.md) used it
const profileWords = () => {
  let text = '';
  try { text = fs.readFileSync(path.join(require('electron').app.getPath('userData'), 'profile.md'), 'utf8'); } catch (_) { /* no profile */ }
  return new Set((text.match(/\b[A-Z][\w-]{2,}\b/g) || []).map((w) => w.toLowerCase()));
};
const PLACEHOLDER = /\[(tu|your)[^\]]*\]/i;

const sec = (ms) => (ms == null ? '–' : (ms / 1000).toFixed(2));

class Practice {
  /** ingest(chunk): feed 16 kHz PCM16 into the app; send(state): update the window; listen(): make sure
   *  the mic is on; clear(): drop words heard before the round so they don't merge into its question. */
  init({ ingest, send, listen, clear, logPath }) {
    Object.assign(this, { ingest, send, listen, clear, logPath });
    this.on = false;
    this.round = null;
    this.order = [];
  }

  /** Test mode keeps the real mic out of a round, so room noise can't mix with the injected voice. */
  get injecting() {
    return !!(this.on && this.inject && this.round && !this.round.done);
  }

  toggle(opts = {}) {
    return this.on ? this.stop() : this.start(opts);
  }

  start({ inject = false } = {}) {
    this.on = true;
    this.inject = inject; // tests: feed the TTS audio straight in instead of playing it
    this.listen();
    this.next();
    return true;
  }

  stop() {
    this.on = false;
    clearTimeout(this.timer);
    if (this.player) { try { this.player.kill(); } catch (_) {} }
    this.round = null;
    this.send({ on: false });
    return false;
  }

  async next() {
    if (!this.on) return;
    clearTimeout(this.timer);
    if (this.round && !this.round.done) this.finish('skipped by Next');
    if (!this.order.length) this.order = [...BANK].sort(() => Math.random() - 0.5);
    const item = this.order.pop();
    const round = { ...item, startedAt: Date.now(), transcript: '' };
    this.round = round;
    this.clear();
    this.send({ on: true, question: item.q, line: 'Speaking…' });
    try {
      await this.speak(item, round);
    } catch (e) {
      logger.warn('Practice voice failed', { error: e.message });
    }
    if (this.round !== round || round.done) return;
    round.speechEndAt = round.speechEndAt || Date.now();
    this.send({ on: true, question: item.q, line: 'Listening…' });
    // Nothing came back (misheard or VAD never closed): give up on this one
    this.timer = setTimeout(() => this.finish('no answer in 15 s'), 15000);
  }

  async speak({ lang, q }, round) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-'));
    const aiff = path.join(dir, 'q.aiff');
    try {
      await run('say', ['-v', VOICES[lang], '-o', aiff, q]);
      const wav = path.join(dir, 'q.wav');
      await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav]);
      const pcm = pcmOf(fs.readFileSync(wav));
      // Anything transcribed well before the voice ends is room noise from before the round
      round.listenFrom = Date.now() + pcm.length / 32 - 1500;
      if (!this.inject) {
        await new Promise((resolve) => {
          this.player = spawn('afplay', [aiff]);
          this.player.on('exit', () => { round.speechEndAt = Date.now(); resolve(); });
          this.player.on('error', resolve);
        });
        return;
      }
      await this.feed(pcm, round);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Real-time feed of PCM16 (100 ms chunks) plus 1.5 s of silence so the VAD closes the utterance. */
  async feed(pcm, round) {
    const step = 3200; // 100 ms at 16 kHz × 2 bytes
    const all = Buffer.concat([pcm, Buffer.alloc(step * 15)]);
    for (let i = 0; i < all.length && this.on; i += step) {
      if (i >= pcm.length && !round.speechEndAt) round.speechEndAt = Date.now(); // the voice ends here
      this.ingest(all.subarray(i, i + step));
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // ── hooks from main.js ──
  onQuestion(text, { skipped = false } = {}) {
    const r = this.round;
    if (!this.on || !r || r.done || !r.listenFrom || Date.now() < r.listenFrom) return;
    r.transcript = r.transcript ? `${r.transcript} ${text}` : text;
    r.questionAt = r.questionAt || Date.now();
    if (!skipped) r.asked = true;
    // A filtered fragment ends the round only if no real question went to the model yet
    else if (!r.asked) this.finish('not a question: nothing shown');
  }

  onFirstWord() {
    const r = this.round;
    if (r && !r.done && !r.firstWordAt) r.firstWordAt = Date.now();
  }

  onAnswer(answer) {
    const r = this.round;
    if (!this.on || !r || r.done) return;
    r.answer = answer;
    this.finish(!String(answer || '').replace(/[\s.…]/g, '') ? 'model said "…": nothing shown' : '');
  }

  finish(note) {
    const r = this.round;
    if (!r || r.done) return;
    r.done = true;
    clearTimeout(this.timer);
    const base = r.speechEndAt || r.startedAt;
    const toQuestion = r.questionAt ? r.questionAt - base : null;
    const toFirst = r.firstWordAt && r.questionAt ? r.firstWordAt - r.questionAt : null;
    const answer = r.answer || '';
    const shown = !!answer.replace(/[\s.…]/g, '');
    const words = profileWords();
    const facts = (answer.match(/\b[A-Z][\w-]{2,}\b/g) || []).some((w) => words.has(w.toLowerCase())), holes = PLACEHOLDER.test(answer);
    const source = !shown ? '' : facts && holes ? 'profile facts + [tu ejemplo]' : holes ? '[tu ejemplo] placeholders' : facts ? 'profile facts' : 'no profile facts';
    // Negative = the question was caught before the voice had finished (live words saw the "?")
    const line = `speech end → question ${sec(toQuestion == null ? null : Math.max(0, toQuestion))} s · → first word ${sec(toFirst)} s${source ? ` · ${source}` : ''}${note ? ` · ${note}` : ''}`;
    this.send({ on: this.on, question: r.q, line });
    const entry = {
      ts: new Date().toISOString(), lang: r.lang, expect: r.expect, question: r.q, transcript: r.transcript,
      answer, toQuestionMs: toQuestion, toFirstWordMs: toFirst, source, note, injected: !!this.inject
    };
    try { fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n'); } catch (e) { logger.warn('Practice log failed', { error: e.message }); }
    logger.info('Practice round', entry);
    if (this.on) this.timer = setTimeout(() => this.next(), 8000);
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, (err) => (err ? reject(err) : resolve())));
}

/** The "data" chunk of a PCM WAV file. */
function pcmOf(wav) {
  let i = 12;
  while (i + 8 <= wav.length) {
    const id = wav.toString('ascii', i, i + 4);
    const size = wav.readUInt32LE(i + 4);
    if (id === 'data') return wav.subarray(i + 8, i + 8 + size);
    i += 8 + size + (size % 2);
  }
  throw new Error('no data chunk in WAV');
}

module.exports = new Practice();
module.exports.BANK = BANK;
