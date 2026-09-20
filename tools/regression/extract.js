/* Pull the detector out of index.html and evaluate it as a module.
   The DSP lives inside a DOM-bound IIFE, so we slice out the pure-function
   region rather than running the page. Tests then exercise the shipping code
   instead of a copy that can drift away from it. */
"use strict";
var fs = require("fs"), path = require("path");

function slice(src, startMark, endMark, what){
  var a = src.indexOf(startMark);
  if(a < 0) throw new Error("extract: start marker missing for " + what);
  var b = src.indexOf(endMark, a);
  if(b < 0) throw new Error("extract: end marker missing for " + what);
  return src.slice(a, b);
}

function load(htmlPath){
  var src = fs.readFileSync(htmlPath || path.join(__dirname, "..", "..", "index.html"), "utf8");

  /* noiseFloor .. synth: everything between the whitening comment and the
     frame-ingest banner is DOM-free. */
  var dsp = slice(src,
    "/* ---------------------------------------------------------------- whitening",
    "/* ============================ ingest one frame ============================ */",
    "dsp");

  /* frame() itself, up to the render banner. It calls paint(); we stub it. */
  var frameSrc = slice(src,
    "function frame(dB){",
    "/* ============================ render: readout ============================ */",
    "frame");

  /* Constants live above the DOM-bound section; take them from the file rather
     than restating them here, so a change in index.html cannot silently leave
     the harness testing different numbers than the app runs. */
  var consts = slice(src,
    "var FFT = 32768",
    "var reduceMotion",
    "constants");

  ["var FFT =", "var RPM_FLOOR", "var MAX_SLEW"].forEach(function(name){
    if(consts.indexOf(name) < 0)
      throw new Error("extract: constant went missing from index.html: " + name);
  });

  var body = [
    '"use strict";',
    consts,
    'var S = null, performanceNow = null;',
    'function paint(){}',
    'var performance = { now: function(){ return performanceNow(); } };',
    dsp,
    frameSrc,
    'return {',
    '  whiten: whiten, analyse: analyse, synth: synth,',
    '  updateTracks: updateTracks, chooseTrack: chooseTrack,',
    '  resetTracks: resetTracks, frame: frame,',
    '  setState: function(s){ S = s; },',
    '  setClock: function(fn){ performanceNow = fn; },',
    '  tracks: function(){ return tracks; }',
    '};'
  ].join("\n");

  return new Function(body)();
}

module.exports = { load: load };
