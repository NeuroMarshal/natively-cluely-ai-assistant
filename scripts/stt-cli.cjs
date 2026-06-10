/**
 * Standalone STT harness — drives the REAL compiled LocalWhisperSTT pipeline
 * (VAD → streaming loop → worker → generation → hallucination/collapse filter)
 * against a .wav file, with maximum logging. No Electron GUI.
 *
 *   node scripts/stt-cli.cjs <file.wav>
 *   STT_MODEL=Xenova/whisper-small STT_LANG=ru-RU STT_RUNTIME=cpu node scripts/stt-cli.cjs in.wav
 *
 * It mocks `electron` (for the userData cache dir) and `SettingsManager` (to
 * force the runtime + model) so the exact production classes run unmodified.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');

const REPO = path.resolve(__dirname, '..');
const USERDATA = process.env.STT_USERDATA || 'C:/Users/An0n/AppData/Roaming/Natively';
const RUNTIME = process.env.STT_RUNTIME || 'cpu';
const MODEL = process.env.STT_MODEL || 'Xenova/whisper-base';
const LANG = process.env.STT_LANG || 'ru-RU';
const WAV = process.argv[2] || path.join(REPO, '_audio_test', 'jfk.wav');
process.env.NATIVELY_LOCAL_AI_RUNTIME_OVERRIDE = RUNTIME;

// ── Inject mocks BEFORE loading the production code ───────────────────────────
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => USERDATA, isPackaged: false, getAppPath: () => REPO } };
  }
  if (request.includes('services/SettingsManager')) {
    return {
      SettingsManager: {
        getInstance: () => ({
          get: (k) =>
            k === 'localAiRuntime' || k === 'sttRuntime' ? RUNTIME :
            k === 'localWhisperModel' ? MODEL : undefined,
          set: () => {},
        }),
      },
    };
  }
  return origLoad.apply(this, arguments);
};

const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(2)}s]`;
const log = (...a) => console.log(ts(), ...a);

// ── WAV → Int16LE mono buffer + sample rate ──────────────────────────────────
function readWav(file) {
  const b = fs.readFileSync(file);
  let o = 12, fmt = null, rate = 16000, channels = 1, bits = 16, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const sz = b.readUInt32LE(o + 4);
    o += 8;
    if (id === 'fmt ') { channels = b.readUInt16LE(o + 2); rate = b.readUInt32LE(o + 4); bits = b.readUInt16LE(o + 14); fmt = true; }
    else if (id === 'data') { data = b.subarray(o, o + sz); }
    o += sz + (sz & 1);
  }
  if (!data) throw new Error('no data chunk');
  // Downmix to mono int16 if needed.
  if (channels > 1 && bits === 16) {
    const frames = data.length / 2 / channels;
    const mono = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i++) {
      let s = 0; for (let c = 0; c < channels; c++) s += data.readInt16LE((i * channels + c) * 2);
      mono.writeInt16LE(Math.max(-32768, Math.min(32767, (s / channels) | 0)), i * 2);
    }
    return { pcm: mono, rate };
  }
  return { pcm: data, rate };
}

const { LocalWhisperSTT } = require(path.join(REPO, 'dist-electron/electron/audio/LocalWhisperSTT.js'));

log(`harness start | model=${MODEL} runtime=${RUNTIME} lang=${LANG}`);
log(`cache dir = ${path.join(USERDATA, 'whisper-models')}`);
const { pcm, rate } = readWav(WAV);
log(`wav: ${WAV} | ${rate}Hz | ${(pcm.length / 2 / rate).toFixed(1)}s | ${pcm.length} bytes`);

const stt = new LocalWhisperSTT(MODEL);
stt.setChannel('cli');
stt.setRecognitionLanguage(LANG);
stt.setSampleRate(rate);

let partials = 0, finals = 0;
const finalsText = [];
let stopping = false;
let exitTimer = null;
const finish = () => {
  if (exitTimer) clearTimeout(exitTimer);
  log(`SUMMARY: ${partials} partials, ${finals} finals`);
  log(`JOINED FINALS: "${finalsText.join(' ')}"`);
  process.exit(finals > 0 ? 0 : 2);
};
stt.on('transcript', (seg) => {
  if (seg.isFinal) {
    finals++;
    finalsText.push(seg.text);
    log(`FINAL   #${finals} (conf ${seg.confidence}) :: "${seg.text}"`);
    if (stopping) setTimeout(finish, 500);
  }
  else { partials++; log(`partial #${partials} (conf ${seg.confidence}) :: "${seg.text}"`); }
});
stt.on('error', (e) => log('ERROR:', (e && e.message) || e));

stt.start();
log('started — feeding audio in 100ms chunks (real-time pace)...');

const CHUNK_BYTES = Math.round(rate * 0.1) * 2; // 100ms of int16 mono
// Append ~700ms of trailing silence so the VAD sees a real end-of-speech pause
// (lets the final streaming tick capture the last words + closes naturally),
// matching how a real speaker stops — instead of cutting the audio dead.
const TRAIL_SILENCE = Buffer.alloc(Math.round(rate * 0.7) * 2);
const fed = Buffer.concat([pcm, TRAIL_SILENCE]);
let off = 0;
const iv = setInterval(() => {
  if (off >= fed.length) {
    clearInterval(iv);
    log('--- audio exhausted; finalize() ---');
    stt.finalize();
    setTimeout(() => {
      stopping = true;
      stt.stop();
      log('--- stop(); draining ---');
      if (finals > 0) {
        setTimeout(finish, 500);
      } else {
        exitTimer = setTimeout(finish, 30000);
      }
    }, 1500);
    return;
  }
  stt.write(fed.subarray(off, off + CHUNK_BYTES));
  off += CHUNK_BYTES;
}, 100);
