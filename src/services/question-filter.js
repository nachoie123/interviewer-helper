// Cheap local check run before every live-call LLM call: obvious non-questions
// (greetings, "can you hear me?", fillers, short comments) never reach Groq.
// Conservative on purpose: anything that might be a question still goes to the model.

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Whole utterance made only of these = small talk / hearing check → skip.
const SMALL_TALK = new RegExp('\\b(' + [
  'hola', 'buenas', 'buenos dias', 'buenas tardes', 'que tal', 'me oyes( bien)?', 'me escuchas( bien)?',
  'se me oye( bien)?', 'se me escucha( bien)?', 'me ves', 'vale', 'ok(ay)?', 'perfecto', 'genial', 'muy bien',
  'bien', 'gracias', 'muchas gracias', 'de acuerdo', 'claro', 'si', 'no', 'eh', 'em+', 'mm+', 'pues', 'bueno',
  'hello', 'hi', 'hey', 'good (morning|afternoon|evening)', 'can you hear me( (ok|okay|well))?',
  'do you hear me', 'can you see me', 'great', 'perfect', 'thanks', 'thank you', 'right', 'sure', 'yes',
  'yeah', 'cool', 'nice', 'alright', 'all right', 'uh', 'um', 'so', 'well'
].join('|') + ')\\b', 'g');

// Interrogative / imperative cues. Spanish interrogatives need their accent
// ("qué", "cómo") because "que"/"como" without it are everyday connectors.
const CUES_ACCENTED = /(qu[eé]\s+(opinas|piensas|harias|harías|te|has|es lo|sabes)|\bqué\b|\bcómo\b|\bcuál(es)?\b|\bcuánt[oa]s?\b|\bdónde\b|\bcuándo\b|\bquién(es)?\b|por qué)/i;
const CUES = new RegExp('\\b(' + [
  'cuentame', 'cuentanos', 'hablame', 'hablanos', 'explica(me|nos)?', 'describe(me)?', 'describeme', 'dime',
  'imagina', 'supon', 'calcula', 'valora', 'estima', 'podrias', 'puedes', 'sabrias', 'harias', 'te ves',
  'has (trabajado|hecho|tenido|usado|liderado)', 'tienes', 'conoces', 'que (opinas|piensas)', 'porque (quieres|banca|consultoria)',
  'what', 'how', 'why', 'which', 'who', 'where', 'when', 'tell (me|us)', 'walk (me|us) through',
  'explain', 'describe', 'give me', 'could you', 'can you', 'would you', 'have you', 'do you', 'did you',
  'are you', 'were you', 'imagine', 'suppose', 'calculate', 'estimate', 'talk (me|us) through', 'share'
].join('|') + ')\\b', 'i');

/** true = worth an LLM call; false = clearly not a question to the user. */
function looksLikeQuestion(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const plain = strip(raw.toLowerCase());
  const rest = plain.replace(/[¿?¡!.,;:…"'()-]/g, ' ').replace(SMALL_TALK, ' ').trim();
  if (!rest) return false; // nothing but greetings / "can you hear me?" / fillers
  const words = rest.split(/\s+/).length;
  if (/[?？]/.test(raw)) return words >= 1;
  if (CUES_ACCENTED.test(raw) || CUES.test(plain)) return true;
  // A case with numbers, or a long statement without punctuation: let the model decide.
  return (/\d/.test(rest) && words >= 8) || words >= 25;
}

// The mic also hears the user reading the answer aloud. If most of what was heard is words
// from a recent answer, it is him reading, not a new question (it used to replace the card).
const contentWords = (s) => strip(String(s || '').toLowerCase()).replace(/[*_`#]/g, ' ').match(/[a-z0-9ñ]{4,}/g) || [];
function isReadingAnswer(text, answers) {
  const heard = contentWords(text);
  if (heard.length < 4) return false;
  const said = new Set((answers || []).flatMap(contentWords));
  const overlap = heard.filter((w) => said.has(w)).length / heard.length;
  // A follow-up question reuses some of the answer's words; reading reuses almost all
  return overlap >= (/[?？]/.test(text) ? 0.8 : 0.6);
}

// Spanish unless the text reads as English (the call is only ever es/en).
const ES_HINT = /[ñ¿¡áéíóú]|\b(el|la|los|las|de|del|que|por|para|con|una?|es|tu|tus|te|has|mi|y|en|cu[aá]l|c[oó]mo|qu[eé]|d[oó]nde|porqu[eé])\b/gi;
const EN_HINT = /\b(the|you|your|what|how|why|which|is|are|do|did|have|tell|me|about|a|an|of|to|in|and|walk|through|would|could)\b/gi;
function questionLanguage(text) {
  const t = String(text || '');
  return (t.match(EN_HINT) || []).length > (t.match(ES_HINT) || []).length ? 'English' : 'Spanish';
}

module.exports = { looksLikeQuestion, questionLanguage, isReadingAnswer };

if (require.main === module) {
  const cases = [
    ['¿Cuál ha sido el proyecto más difícil en el que has trabajado?', true],
    ['Tell me about yourself', true],
    ['¿Por qué banca de inversión?', true],
    ['¿Qué experiencia tienes con Python?', true],
    ["What's your biggest weakness?", true],
    ['Walk me through a DCF', true],
    ['Cuéntame un poco sobre ti', true],
    ['Una empresa tiene un EBITDA de 50 millones y cotiza a 8 veces, con 100 millones de deuda neta. Valor del equity', true],
    ['¿Python?', true],
    ['Hola, ¿me oyes?', false],
    ['Hola, ¿me oyes bien?', false],
    ['Can you hear me okay?', false],
    ['Vale, perfecto, gracias.', false],
    ['Muy bien.', false],
    ['Good morning!', false],
    ['Genial, pues empezamos ya.', false],
    ['Yo trabajo en el equipo de M&A desde hace cinco años.', false],
    ['', false]
  ];
  let bad = 0;
  for (const [t, want] of [['¿Por qué banca de inversión?', 'Spanish'], ["What's your biggest weakness?", 'English'],
    ['Tell me about yourself', 'English'], ['¿Qué experiencia tienes con Python?', 'Spanish'], ['Walk me through a DCF', 'English']]) {
    if (questionLanguage(t) !== want) { bad++; console.log('FAIL lang', t); }
  }
  const ans = ['**Como estudiante y futuro profesional, me enfoco en proyectos personales y en prácticas que me den experiencia real.**\n- Herramientas como mi app de notas o los sistemas de automatización que desarrollo.'];
  for (const [t, want] of [
    ['Como estudiante y futuro profesional, me enfoco en proyectos personales y en prácticas', true],
    ['herramientas como mi app de notas o los sistemas de automatización que desarrollo', true],
    ['¿Y qué proyectos personales has hecho fuera de la universidad?', false],
    ['¿Qué opinas de la situación de la tecnología en España?', false],
    ['vale', false]
  ]) {
    if (isReadingAnswer(t, ans) !== want) { bad++; console.log('FAIL reading', JSON.stringify(t)); }
  }
  for (const [t, want] of cases) {
    const got = looksLikeQuestion(t);
    if (got !== want) { bad++; console.log('FAIL', JSON.stringify(t), 'got', got); }
  }
  console.log(bad ? `${bad} failed` : `all ${cases.length} passed`);
  process.exit(bad ? 1 : 0);
}
