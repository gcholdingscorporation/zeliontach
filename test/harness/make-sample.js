#!/usr/bin/env node
"use strict";
/* Write a synthetic clip out as a WAV.
 *
 *   node test/harness/make-sample.js recordings/probe.wav 2137 2 8
 *
 * Two uses. It exercises the recording path - decoder, mono downmix, the lot -
 * without waiting for a real capture. And it gives you a file to drop into the
 * app's own "Recording" input, so you can check the page and this harness agree
 * on the same clip before trusting either about a real one. */

const fs = require("fs");
const path = require("path");
const { synthesize } = require("./synth.js");

const [out, rpm, blades, secs] = process.argv.slice(2);
if(!out){
  console.error("usage: make-sample.js <out.wav> [rpm=2137] [blades=2] [seconds=8]");
  process.exit(2);
}

const sig = {
  rpm: Number(rpm || 2137),
  blades: Number(blades || 2),
  sampleRate: 48000,
  duration_s: Number(secs || 8),
  snr_db: 12,
  wind_db: -4,
  seed: 777
};
const a = synthesize(sig);

const n = a.samples.length;
const buf = Buffer.alloc(44 + n * 2);
buf.write("RIFF", 0, "ascii");   buf.writeUInt32LE(36 + n * 2, 4);
buf.write("WAVE", 8, "ascii");   buf.write("fmt ", 12, "ascii");
buf.writeUInt32LE(16, 16);       buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22);        buf.writeUInt32LE(a.sampleRate, 24);
buf.writeUInt32LE(a.sampleRate * 2, 28);
buf.writeUInt16LE(2, 32);        buf.writeUInt16LE(16, 34);
buf.write("data", 36, "ascii");  buf.writeUInt32LE(n * 2, 40);
for(let i = 0; i < n; i++){
  let v = Math.round(a.samples[i] * 32767);
  buf.writeInt16LE(v > 32767 ? 32767 : v < -32768 ? -32768 : v, 44 + i * 2);
}

const dest = path.resolve(path.join(__dirname, ".."), out);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, buf);
console.log("wrote " + dest + "  " + sig.rpm + " rpm, " + sig.blades + " blades, " + a.duration.toFixed(1) + "s");
