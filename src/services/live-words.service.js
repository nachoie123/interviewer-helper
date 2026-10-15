// Live words: runs native/live-stt (Apple on-device speech recognition) next to Groq Whisper.
// It gets the same PCM16 16 kHz chunks the app already captures (no second mic) and emits
// partial / final text as the person speaks. Groq still does the transcript the answers use.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const logger = require('../core/logger').createServiceLogger('LIVE');

// Packaged: Contents/Resources/live-stt/live-stt (outside the asar); dev: native/live-stt/live-stt.
const BIN = [process.resourcesPath && path.join(process.resourcesPath, 'live-stt', 'live-stt'),
  path.join(__dirname, '..', '..', 'native', 'live-stt', 'live-stt')].find((p) => p && fs.existsSync(p)) || '';
// Calls are only in Spanish or English: any other locale falls back to Spanish.
const LOCALES = ['es-ES', 'en-US'];
const safeLocale = (l) => (LOCALES.includes(l) ? l : 'es-ES');

class LiveWords extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.locale = safeLocale(process.env.LIVE_STT_LOCALE);
    this.state = 'off'; // off | starting | asking | ready | denied | unavailable
  }

  start(locale = this.locale) {
    if (this.proc) return;
    this.locale = safeLocale(locale);
    if (!BIN) return this._status('unavailable', 'run native/live-stt/build.sh');
    this._status('starting');
    const proc = spawn(BIN, [this.locale], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.stdin.on('error', () => {}); // EPIPE when it exits mid-write
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'status') this._status(msg.state, msg.locale);
        else if (msg.type === 'partial' || msg.type === 'final') this.emit('words', msg);
        else if (msg.type === 'debug') logger.debug('live-stt', msg);
      }
    });
    proc.stderr.on('data', (d) => logger.debug('live-stt stderr', { text: String(d).slice(0, 300) }));
    proc.on('exit', (code) => {
      if (this.proc && this.proc !== proc) return; // an old helper after a language switch
      this.proc = null;
      // 2 = permission denied, 3 = no recognizer for this language; anything else = stopped / crashed
      if (code === 2) this._status('denied');
      else if (code === 3) this._status('unavailable', locale);
      else if (this.state !== 'denied') this._status('off');
    });
  }

  stop() {
    if (!this.proc) return;
    const proc = this.proc;
    this.proc = null;
    try { proc.stdin.end(); } catch {}
    setTimeout(() => { try { proc.kill('SIGTERM'); } catch {} }, 300);
  }

  restart(locale) {
    locale = safeLocale(locale);
    if (locale === this.locale) return;
    if (!this.proc) { this.locale = locale; return; }
    logger.info('Live words language switch', { from: this.locale, to: locale });
    this.stop();
    this.start(locale);
  }

  write(chunk) {
    if (this.proc && this.state === 'ready') this.proc.stdin.write(chunk);
  }

  /** The app's VAD saw the end of an utterance: close the current live segment. */
  cut() {
    if (this.proc && this.state === 'ready') this.proc.kill('SIGUSR1');
  }

  _status(state, detail) {
    if (state === this.state) return;
    this.state = state;
    logger.info('Live words status', { state, detail });
    this.emit('status', { state, locale: this.locale });
  }
}

module.exports = new LiveWords();
