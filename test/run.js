#!/usr/bin/env node
"use strict";
/* Run the shipping detector over the test matrix and score it against known
 * head speeds.
 *
 *   node test/run.js                     every case
 *   node test/run.js --filter=field      cases whose id contains "field"
 *   node test/run.js --json=out.json     machine-readable results as well
 *
 * Exits non-zero when a case misses what the matrix says it should hit. */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { loadDetector } = require("./harness/extract.js");
const { Spectrograph } = require("./harness/spectrum.js");
const { decodeWav } = require("./harness/wav.js");
const { synthesize } = require("./harness/synth.js");

const ROOT = __dirname;
const MATRIX_DIR = path.join(ROOT, "matrix");

/* ------------------------------------------------------------------ args */
const args = {};
for(const a of process.argv.slice(2)){
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if(!m){ console.error("unrecognised argument: " + a); process.exit(2); }
  args[m[1]] = m[2] === undefined ? true : m[2];
}
const HOP_MS = Number(args["hop-ms"] || 33);          /* the app analyses every animation frame */

/* ------------------------------------------------------------ defaults */
const DEFAULTS = {
  tol_rpm: 50,            /* "correct" for a case, unless it says otherwise */
  gross_pct: 10,          /* beyond this the reading is wrong, not imprecise - usually an octave */
  min_within_pct: 90,     /* share of post-lock frames that must be within tol_rpm */
  lock_within_s: 8,
  must_lock: true
};

/* --------------------------------------------------------------- truth */
/* A clip may hold one steady head speed or a schedule of them. */
function truthAt(truth, t){
  if(truth.segments){
    for(const s of truth.segments) if(t >= (s.from_s || 0) && t < (s.to_s == null ? Infinity : s.to_s)) return s.rpm;
    return null;                                     /* a gap: nothing is claimed here */
  }
  return truth.rpm;
}

/* --------------------------------------------------------------- audio */
/* Which channel of a stereo source to keep.
   Phones do not record video in plain stereo. Two or three mics are combined
   into a stereo pair by the handset's own processing, and what that processing
   does to a steady low-frequency tone is not something to assume - it may
   steer, it may suppress, and averaging the pair can partly cancel whatever it
   did. So the choice is a per-case setting, and a case that matters is worth
   running both ways. */
const PAN = {
  mix:   ["-ac", "1"],
  left:  ["-af", "pan=mono|c0=c0"],
  right: ["-af", "pan=mono|c0=c1"]
};

function toWav(file, channel){
  /* Phones record m4a, and film video as AAC in an mp4 or a mov. Converting
     once, out loud, beats an implicit decode that behaves differently on every
     machine. -vn drops any video stream; the audio track is all this wants. */
  if(!PAN[channel]) throw new Error("audio_channel must be mix, left or right, got '" + channel + "'");
  const suffix = channel === "mix" ? ".converted.wav" : ".converted." + channel + ".wav";
  const wav = path.join(path.dirname(file), path.basename(file).replace(/\.[^.]+$/, "") + suffix);
  if(fs.existsSync(wav)) return wav;
  const argv = ["-v", "error", "-y", "-i", file, "-vn"].concat(PAN[channel], ["-c:a", "pcm_s16le", wav]);
  try{
    execFileSync("ffmpeg", argv, { stdio: "pipe" });
  }catch(e){
    throw new Error("cannot read " + path.basename(file) + ": it is not a WAV and ffmpeg is not installed. Convert it first:\n" +
                    "    ffmpeg " + argv.join(" "));
  }
  return wav;
}

/* Take a window out of a longer source. A video of a flight is minutes long
   and the aircraft is only in it for part of that, at a distance that changes
   while it is - so one file is several cases, each naming its own seconds. */
function clipAudio(a, clip){
  if(!clip) return a;
  const from = Math.max(0, Math.round((clip.from_s || 0) * a.sampleRate));
  const to = clip.to_s == null ? a.samples.length : Math.min(a.samples.length, Math.round(clip.to_s * a.sampleRate));
  if(to <= from) throw new Error("clip " + JSON.stringify(clip) + " selects nothing from a " + a.duration.toFixed(1) + "s source");
  const samples = a.samples.subarray(from, to);
  return { samples, sampleRate: a.sampleRate, channels: a.channels, duration: samples.length / a.sampleRate };
}

function audioFor(c){
  if(c.kind === "synthetic") return synthesize(c.signal);
  if(c.kind !== "recording") throw new Error("case " + c.id + ": unknown kind '" + c.kind + "'");
  let file = path.resolve(ROOT, c.audio);
  if(!fs.existsSync(file)) return null;              /* declared but not captured yet */
  if(!/\.wav$/i.test(file)) file = toWav(file, c.audio_channel || "mix");
  return clipAudio(decodeWav(file), c.clip);
}

/* ----------------------------------------------------------------- run */
function runCase(det, c){
  const audio = audioFor(c);
  if(!audio) return { id: c.id, status: "missing", note: c.audio + " is not in the working tree" };

  /* A capture with no measured head speed scores nothing, so say so rather
     than reporting a confident-looking pass over a null. */
  if(c.kind === "recording"){
    const t = c.truth || {};
    const wantsLock = !(c.expect && c.expect.must_lock === false);
    if(wantsLock && t.rpm == null && !t.segments)
      throw new Error("the audio is here but truth.rpm is still null - fill in the measured head speed and truth.source (see CAPTURING.md)");
    if(wantsLock && !t.source)
      throw new Error("truth.source is empty - record how the head speed was measured, so a later reader can judge the tolerance");
  }

  const blades = (c.truth && c.truth.blades) || (c.signal && c.signal.blades) || 2;
  const band = c.band || {};
  det.reset({
    blades,
    rpmMin: band.rpmMin == null ? 1000 : band.rpmMin,
    rpmMax: band.rpmMax == null ? 6000 : band.rpmMax,
    sampleRate: audio.sampleRate
  });

  const sg = new Spectrograph(det.FFT);
  const dB = new Float32Array(det.FFT >> 1);
  const series = [];
  const total = audio.samples.length;

  for(let tMs = 0; tMs / 1000 <= audio.duration; tMs += HOP_MS){
    det.clock.t = tMs;
    /* The analyser always holds the most recent fftSize samples, so early
       frames are part-empty exactly as they are in the app. */
    const offset = Math.round(tMs / 1000 * audio.sampleRate) - det.FFT;
    if(offset > total) break;
    sg.frameAt(audio.samples, offset, dB);
    det.frame(dB);
    series.push({ t: tMs / 1000, rpm: det.S.locked ? det.S.rpm : null, conf: det.S.conf, other: det.S.other });
  }
  return score(c, series, audio);
}

function score(c, series, audio){
  const exp = Object.assign({}, DEFAULTS, c.expect || {});
  const truth = c.truth || { rpm: (c.signal && c.signal.rpm), blades: c.signal && c.signal.blades };
  const failures = [];

  const locked = series.filter(s => s.rpm != null);
  const lockAt = locked.length ? locked[0].t : null;

  let judged = 0, within = 0, gross = 0, sumAbs = 0, maxAbs = 0;
  for(const s of locked){
    const want = truthAt(truth, s.t);
    if(want == null) continue;                        /* clip does not claim a speed here */
    if(lockAt != null && s.t < lockAt + (exp.settle_s == null ? 1.5 : exp.settle_s)) continue;  /* let the median fill */
    const err = Math.abs(s.rpm - want);
    judged++;
    sumAbs += err;
    if(err > maxAbs) maxAbs = err;
    if(err <= exp.tol_rpm) within++;
    if(err > want * exp.gross_pct / 100) gross++;
  }

  const finalWindow = locked.slice(-10);
  let finalRpm = null, finalErr = null;
  if(finalWindow.length){
    const vals = finalWindow.map(s => s.rpm).sort((a, b) => a - b);
    finalRpm = vals[vals.length >> 1];
    const want = truthAt(truth, finalWindow[finalWindow.length - 1].t);
    if(want != null) finalErr = Math.abs(finalRpm - want);
  }

  if(exp.must_lock && lockAt == null) failures.push("never locked");
  if(exp.must_lock && lockAt != null && lockAt > exp.lock_within_s)
    failures.push("locked at " + lockAt.toFixed(1) + "s, wanted within " + exp.lock_within_s + "s");
  if(!exp.must_lock && lockAt != null && !exp.must_not_lock_in_band)
    failures.push("locked at " + lockAt.toFixed(1) + "s on a clip that should hold nothing");

  /* A clip with no rotor in it. Reporting something far below the band is the
     detector working as designed - the band is a preference, not a filter, and
     a reading outside it is shown marked. Reporting something INSIDE the band
     would be a false positive a user would believe. */
  if(exp.must_not_lock_in_band){
    const band = c.band || {};
    const lo = band.rpmMin == null ? 1000 : band.rpmMin, hi = band.rpmMax == null ? 6000 : band.rpmMax;
    const inBand = locked.filter(s => s.rpm >= lo && s.rpm <= hi);
    if(inBand.length > (exp.max_in_band_readings == null ? 0 : exp.max_in_band_readings))
      failures.push(inBand.length + " reading(s) inside " + lo + "-" + hi + " rpm on a clip with no rotor in it");
  }

  const withinPct = judged ? 100 * within / judged : null;
  if(judged && withinPct < exp.min_within_pct)
    failures.push(withinPct.toFixed(0) + "% of readings within " + exp.tol_rpm + " rpm, wanted " + exp.min_within_pct + "%");
  if(exp.max_final_error_rpm != null && finalErr != null && finalErr > exp.max_final_error_rpm)
    failures.push("settled " + finalErr.toFixed(0) + " rpm out, wanted " + exp.max_final_error_rpm);
  if(exp.max_gross != null && gross > exp.max_gross)
    failures.push(gross + " gross readings, wanted at most " + exp.max_gross);

  return {
    id: c.id, kind: c.kind, status: failures.length ? "fail" : "pass", failures,
    duration_s: Number(audio.duration.toFixed(1)),
    lock_s: lockAt == null ? null : Number(lockAt.toFixed(2)),
    final_rpm: finalRpm == null ? null : Math.round(finalRpm),
    truth_rpm: truthAt(truth, series.length ? series[series.length - 1].t : 0),
    final_error_rpm: finalErr == null ? null : Math.round(finalErr),
    mean_abs_error_rpm: judged ? Number((sumAbs / judged).toFixed(1)) : null,
    max_abs_error_rpm: judged ? Math.round(maxAbs) : null,
    within_tol_pct: withinPct == null ? null : Number(withinPct.toFixed(1)),
    tol_rpm: exp.tol_rpm,
    gross_readings: gross,
    judged_readings: judged,
    goal: c.goal || null,
    tags: c.tags || []
  };
}

/* ---------------------------------------------------------------- main */
function loadMatrix(){
  if(!fs.existsSync(MATRIX_DIR)) return [];
  const cases = [];
  for(const f of fs.readdirSync(MATRIX_DIR).filter(f => f.endsWith(".json")).sort()){
    const doc = JSON.parse(fs.readFileSync(path.join(MATRIX_DIR, f), "utf8"));
    for(const c of doc.cases || []){
      if(cases.some(x => x.id === c.id)) throw new Error("duplicate case id '" + c.id + "' in " + f);
      cases.push(Object.assign({ _file: f }, c));
    }
  }
  return cases;
}

function pad(s, n){ s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
function padl(s, n){ s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }

function main(){
  let cases = loadMatrix();
  if(args.filter) cases = cases.filter(c => c.id.includes(args.filter) || (c.tags || []).includes(args.filter));
  if(!cases.length){ console.error("no cases matched"); process.exit(2); }

  const det = loadDetector();
  const results = [];
  for(const c of cases){
    process.stderr.write("  " + c.id + " ... ");
    let r;
    try{ r = runCase(det, c); }
    catch(e){ r = { id: c.id, kind: c.kind, status: "error", failures: [e.message], tags: c.tags || [] }; }
    results.push(r);
    process.stderr.write(r.status + "\n");
  }

  console.log("");
  console.log(pad("case", 34) + padl("truth", 7) + padl("read", 7) + padl("err", 6) + padl("max", 6) + padl("lock", 7) + padl("in tol", 8) + "  status");
  console.log("-".repeat(34 + 7 + 7 + 6 + 6 + 7 + 8 + 10));
  for(const r of results){
    console.log(
      pad(r.id, 34) +
      padl(r.truth_rpm == null ? "-" : r.truth_rpm, 7) +
      padl(r.final_rpm == null ? "-" : r.final_rpm, 7) +
      padl(r.final_error_rpm == null ? "-" : r.final_error_rpm, 6) +
      padl(r.max_abs_error_rpm == null ? "-" : r.max_abs_error_rpm, 6) +
      padl(r.lock_s == null ? "-" : r.lock_s + "s", 7) +
      padl(r.within_tol_pct == null ? "-" : r.within_tol_pct + "%", 8) +
      "  " + r.status + (r.failures && r.failures.length ? ": " + r.failures.join("; ") : "") +
      (r.goal ? "   (goal: " + r.goal + ")" : "")
    );
  }

  const graded = results.filter(r => r.within_tol_pct != null);
  const missing = results.filter(r => r.status === "missing");
  const passed = results.filter(r => r.status === "pass");
  const failed = results.filter(r => r.status === "fail" || r.status === "error");
  const ran = passed.concat(failed);

  console.log("");
  console.log(ran.length + " case(s) run, " + passed.length + " passed, " + failed.length + " failed" +
              (missing.length ? ", " + missing.length + " awaiting audio" : ""));
  if(graded.length){
    const cases50 = graded.filter(r => r.max_abs_error_rpm <= 50).length;
    const grossTotal = graded.reduce((a, r) => a + r.gross_readings, 0);
    const readTotal = graded.reduce((a, r) => a + r.judged_readings, 0);
    console.log("cases held within 50 rpm throughout: " + cases50 + "/" + graded.length +
                "   gross readings: " + grossTotal + "/" + readTotal +
                " (" + (readTotal ? (100 * grossTotal / readTotal).toFixed(2) : "0") + "%)");
  }
  for(const r of missing) console.log("  awaiting audio: " + r.id + " - " + r.note);

  if(args.json) fs.writeFileSync(args.json, JSON.stringify({ generated: new Date().toISOString(), hop_ms: HOP_MS, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main();
