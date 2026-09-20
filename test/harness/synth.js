"use strict";
/* Time-domain rotor audio, so a synthetic case goes through the same path a
 * real recording does: samples -> window -> FFT -> dB -> detector. The app's
 * own synth() builds a spectrum directly, which is the right shape for its
 * in-page self test but skips everything the FFT actually does to a signal.
 *
 * This is not a rotor acoustics model and does not claim to be one. It is a
 * harmonic comb at the blade-pass frequency, buried in noise by a stated
 * amount, with the handset low-end rolloff the app already assumes. Its job is
 * to prove the harness measures what it says it measures, and to hold the
 * detector's known failure shapes - octave errors, competing combs, wind - as
 * regressions. Real audio is what decides whether the detector works. */

/* mulberry32. The obvious LCG - the one index.html uses for its demo noise -
   cannot be used here: s*1103515245 overflows a double's 53-bit mantissa, the
   low bits are lost, and the sequence collapses to the same trajectory whatever
   the seed. Noise that is identical run to run and seed to seed is not noise,
   and it grows a stable pseudo-tone that the detector then locks onto - which
   reads as a detector failure and is not one. */
function lcg(seed){
  let a = (seed >>> 0) || 1;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rms(a){
  let sum = 0;
  for(let i = 0; i < a.length; i++) sum += a[i] * a[i];
  return Math.sqrt(sum / a.length);
}

/* A comb at the blade-pass frequency. Harmonic h falls at h^-0.65 - the app's
   own -13 dB per octave of harmonic number - and everything below 110 Hz is
   rolled off the way a phone mic rolls it off. */
function comb(out, sampleRate, rpm, blades, harmonics, gain, rnd){
  const f0 = rpm * blades / 60;
  for(let h = 1; h <= harmonics; h++){
    const f = f0 * h;
    if(f >= sampleRate / 2) break;
    let a = Math.pow(h, -0.65);
    if(f < 110) a *= Math.pow(10, (-20 * Math.log10(110 / f)) / 20);
    const phase = rnd() * 2 * Math.PI;
    const w = 2 * Math.PI * f / sampleRate;
    for(let i = 0; i < out.length; i++) out[i] += gain * a * Math.sin(w * i + phase);
  }
}

/* Pink-ish noise: white through a one-pole lowpass, mixed back with the white.
   Wind is the same noise with a much heavier tilt, which is what makes it a
   problem - it lifts the bottom of the band where the fundamental lives. */
function noise(n, tilt, rnd){
  const out = new Float64Array(n);
  let lp = 0;
  for(let i = 0; i < n; i++){
    const w = rnd() * 2 - 1;
    lp = lp * tilt + w * (1 - tilt);
    out[i] = lp;
  }
  return out;
}

function scaleTo(buf, target){
  const r = rms(buf);
  if(r > 0) for(let i = 0; i < buf.length; i++) buf[i] *= target / r;
}

/* sig: { rpm, blades, sampleRate, duration_s, harmonics, snr_db, wind_db,
          competitors: [{ rpm, blades, level_db }], seed, spool: {from,to} } */
function synthesize(sig){
  const sr = sig.sampleRate || 48000;
  const n = Math.round(sr * (sig.duration_s || 10));
  const rnd = lcg(sig.seed || 1234);
  const harmonics = sig.harmonics || 14;

  const rotor = new Float64Array(n);
  if(sig.spool){
    /* A rotor that changes speed: the comb is rebuilt per sample from a swept
       fundamental, so the tracker's slew limit is genuinely exercised. */
    const f0a = sig.spool.from * sig.blades / 60, f0b = sig.spool.to * sig.blades / 60;
    const phase = new Float64Array(harmonics + 1);
    for(let i = 0; i < n; i++){
      const f0 = f0a + (f0b - f0a) * (i / n);
      for(let h = 1; h <= harmonics; h++){
        const f = f0 * h;
        if(f >= sr / 2) continue;
        let a = Math.pow(h, -0.65);
        if(f < 110) a *= Math.pow(10, (-20 * Math.log10(110 / f)) / 20);
        phase[h] += 2 * Math.PI * f / sr;
        rotor[i] += a * Math.sin(phase[h]);
      }
    }
  } else {
    comb(rotor, sr, sig.rpm, sig.blades, harmonics, 1, rnd);
  }
  scaleTo(rotor, 0.1);
  const rotorRms = rms(rotor);

  const mix = new Float64Array(n);
  for(let i = 0; i < n; i++) mix[i] = rotor[i];

  /* A competing comb - the tail rotor, a second aircraft, a generator - at a
     stated level below the head. This is the failure the detector works
     hardest to avoid, so the matrix should always hold some. */
  const comps = sig.competitors || [];
  for(const c of comps){
    const buf = new Float64Array(n);
    comb(buf, sr, c.rpm, c.blades || 2, harmonics, 1, rnd);
    scaleTo(buf, rotorRms * Math.pow(10, (c.level_db || -6) / 20));
    for(let i = 0; i < n; i++) mix[i] += buf[i];
  }

  if(sig.snr_db != null){
    const bg = noise(n, 0.7, rnd);
    scaleTo(bg, rotorRms * Math.pow(10, -sig.snr_db / 20));
    for(let i = 0; i < n; i++) mix[i] += bg[i];
  }
  if(sig.wind_db != null){
    const wind = noise(n, 0.995, rnd);           /* heavily tilted: energy at the bottom */
    scaleTo(wind, rotorRms * Math.pow(10, sig.wind_db / 20));
    for(let i = 0; i < n; i++) mix[i] += wind[i];
  }

  let peak = 0;
  for(let i = 0; i < n; i++) if(Math.abs(mix[i]) > peak) peak = Math.abs(mix[i]);
  const g = peak > 0.95 ? 0.95 / peak : 1;       /* keep it off the rails, as a recording would be */
  const out = new Float32Array(n);
  for(let i = 0; i < n; i++) out[i] = mix[i] * g;

  return { samples: out, sampleRate: sr, duration: n / sr };
}

module.exports = { synthesize };
