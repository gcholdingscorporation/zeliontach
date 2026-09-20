"use strict";
/* A WAV reader, mono-downmixing to Float32 in [-1, 1].
 *
 * Only WAV, deliberately: Node has no audio decoder, and a harness that shells
 * out to ffmpeg for its primary format fails differently on every machine.
 * run.js converts m4a/mp3 to WAV with ffmpeg when one is installed, so the
 * recordings a phone produces still work - they are just converted once,
 * visibly, rather than decoded implicitly. */

const fs = require("fs");

function readChunks(buf){
  if(buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("not a RIFF/WAVE file");
  const chunks = {};
  let p = 12;
  while(p + 8 <= buf.length){
    const id = buf.toString("ascii", p, p + 4).trim();   /* the fmt chunk's id is "fmt " */
    const size = buf.readUInt32LE(p + 4);
    chunks[id] = { start: p + 8, size: Math.min(size, buf.length - p - 8) };
    p += 8 + size + (size & 1);
  }
  return chunks;
}

function decodeWav(file){
  const buf = fs.readFileSync(file);
  const chunks = readChunks(buf);
  if(!chunks.fmt || !chunks.data) throw new Error("WAV file has no fmt/data chunk");

  const f = chunks.fmt.start;
  let format = buf.readUInt16LE(f);
  const channels = buf.readUInt16LE(f + 2);
  const sampleRate = buf.readUInt32LE(f + 4);
  const bits = buf.readUInt16LE(f + 14);
  if(format === 0xFFFE && chunks.fmt.size >= 40) format = buf.readUInt16LE(f + 24);  /* WAVE_FORMAT_EXTENSIBLE */
  if(format !== 1 && format !== 3) throw new Error("unsupported WAV encoding " + format + " (want PCM or float)");
  if(!channels) throw new Error("WAV file declares zero channels");

  const bytes = bits >> 3;
  const frameBytes = bytes * channels;
  const frames = Math.floor(chunks.data.size / frameBytes);
  const out = new Float32Array(frames);
  const d = chunks.data.start;

  for(let i = 0; i < frames; i++){
    let sum = 0;
    for(let c = 0; c < channels; c++){
      const o = d + i * frameBytes + c * bytes;
      let v;
      if(format === 3)        v = bits === 64 ? buf.readDoubleLE(o) : buf.readFloatLE(o);
      else if(bits === 8)     v = (buf[o] - 128) / 128;
      else if(bits === 16)    v = buf.readInt16LE(o) / 32768;
      else if(bits === 24)    v = ((buf[o] | (buf[o+1] << 8) | (buf[o+2] << 24 >> 8)) << 8 >> 8) / 8388608;
      else if(bits === 32)    v = buf.readInt32LE(o) / 2147483648;
      else throw new Error("unsupported WAV bit depth " + bits);
      sum += v;
    }
    out[i] = sum / channels;                 /* the app sees one mic, so mix down */
  }
  return { samples: out, sampleRate, channels, duration: frames / sampleRate };
}

module.exports = { decodeWav };
