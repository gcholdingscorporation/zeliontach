"use strict";
/* Pull the live detector out of index.html and run it headlessly.
 *
 * The point of this file is that the harness tests the SHIPPING code, not a
 * copy of it. index.html is one file with banner-delimited sections, so the
 * sections that are pure signal processing are sliced out by their banners and
 * evaluated in a sandbox with the browser bits stubbed. If someone renames a
 * banner the slice fails loudly rather than silently testing nothing. */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "..", "index.html");

function banner(name){
  return "/* ============================ " + name + " ============================ */";
}

/* Everything between two banners, the opening banner included. */
function slice(src, from, to){
  const a = src.indexOf(banner(from));
  const b = src.indexOf(banner(to));
  if(a < 0) throw new Error("index.html no longer has a '" + from + "' section - the harness slices the detector out by banner, so update extract.js");
  if(b < 0) throw new Error("index.html no longer has a '" + to + "' section - the harness slices the detector out by banner, so update extract.js");
  if(b < a) throw new Error("sections '" + from + "' and '" + to + "' are out of order in index.html");
  return src.slice(a, b);
}

/* A virtual clock. The tracker ages candidates in wall-clock milliseconds
   (TRACK_TTL, the slew limit), so an offline run has to advance time in step
   with the audio it is feeding in, not in step with how fast the host CPU
   chews through FFTs. */
function makeClock(){
  const clock = { t: 0 };
  clock.advance = function(ms){ clock.t += ms; };
  return clock;
}

function loadDetector(){
  const src = fs.readFileSync(APP, "utf8");
  const code = [
    slice(src, "constants", "dom"),              /* constants + state, without the DOM lookups */
    slice(src, "detector", "render: readout"),   /* detector, tracking, synth, frame */
    "paintCalls = 0;",
    "function paint(){ paintCalls++; }",         /* frame() ends by painting; here that is a no-op */
    "__exports.S = S;",
    "__exports.analyse = analyse;",
    "__exports.frame = frame;",
    "__exports.synth = synth;",
    "__exports.resetTracks = resetTracks;",
    "__exports.tracks = tracks;",
    "__exports.FFT = FFT;",
    "__exports.RPM_FLOOR = RPM_FLOOR;"
  ].join("\n\n");

  const clock = makeClock();
  const exports_ = {};
  const sandbox = {
    __exports: exports_,
    performance: { now: function(){ return clock.t; } },
    console: console,
    Math: Math, Date: Date, Float32Array: Float32Array, Float64Array: Float64Array,
    location: { href: "file://harness" },
    document: { getElementById: function(){ return null; }, featurePolicy: null },
    matchMedia: function(){ return { matches: false }; }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "index.html:detector" });

  exports_.clock = clock;
  /* frame() keeps its state in S and in the module-level track list. A run over
     one clip must not inherit the previous clip's tracks or rpm history. */
  exports_.reset = function(opts){
    clock.t = 0;
    exports_.resetTracks();
    const S = exports_.S;
    S.mode = "file";
    S.blades = opts.blades;
    S.rpmMin = opts.rpmMin;
    S.rpmMax = opts.rpmMax;
    S.sampleRate = opts.sampleRate;
    S.binHz = opts.sampleRate / exports_.FFT;
    S.rpm = null; S.freq = null; S.conf = 0; S.locked = false;
    S.raw.length = 0; S.hist.length = 0; S.pending.length = 0;
    S.peak = 0; S.lastT = 0; S.inRange = true; S.other = null; S.snr = null; S.held = 0;
  };
  return exports_;
}

module.exports = { loadDetector, APP };
