/* Run the field-noise matrix against the detector as it ships in index.html.

     node tools/regression/run.js              summary for one noise draw
     node tools/regression/run.js --verbose    every case, one per line
     node tools/regression/run.js --group=wind just that group
     node tools/regression/run.js --check      hold the bar across five draws
     ZT_HTML=old.html node tools/regression/run.js   measure a different build

   --check is the one to put on a schedule: it exits non-zero if the detector
   has slipped. */
"use strict";
var dsp = require("./extract.js").load(process.env.ZT_HTML || null);
var scen = require("./scenarios.js");

var GROSS = 200;      /* rpm: beyond this the reading is not a near miss, it is wrong */
var NEAR  = 50;       /* rpm: the "within 50" bar */
var BIN_HZ = 48000/32768;

/* The bar to hold, set from the measured result and left a little slack for
   the noise draw. Raise these when the detector genuinely improves. */
/* cleanErr is half an rpm: the readout is rounded, so anything under that
   shows the injected figure exactly, which is the bench result to hold. */
var BAR = { within50:74, gross:1, cleanErr:0.5, falseLock:2, seeds:[7, 101, 555, 1234, 9001] };

function runCase(c){
  var S = {
    mode:"test", blades:c.opts.blades || 2, rpmMin:1000, rpmMax:6000,
    sampleRate:48000, binHz:c.opts.binHz,
    spec:null, rpm:null, freq:null, conf:0, locked:false,
    raw:[], hist:[], peak:0, pending:[], lastT:0, inRange:true,
    corrected:false, other:null, snr:null, held:0, level:-Infinity, clipped:false
  };
  dsp.setState(S);
  dsp.resetTracks();
  var clock = 0;
  dsp.setClock(function(){ return clock; });

  var frames = scen.build(c.opts);
  for(var i = 0; i < frames.length; i++){
    clock = i*70;
    dsp.frame(frames[i]);
  }
  return { rpm:S.rpm, locked:S.locked, conf:S.conf, inRange:S.inRange, truth:c.truth };
}

function classify(r){
  if(r.truth == null) return (r.locked && r.rpm != null) ? "false-lock" : "ok";
  if(r.rpm == null || !r.locked) return "no-lock";
  var e = Math.abs(r.rpm - r.truth);
  if(e <= NEAR) return "near";
  if(e <= GROSS) return "off";
  return "gross";
}

function evaluate(seedBase, only){
  var cases = scen.matrix(BIN_HZ, seedBase).filter(function(c){ return !only || c.group === only; });
  var groups = {}, rows = [], order = [];
  cases.forEach(function(c){
    var r = runCase(c), k = classify(r);
    if(!groups[c.group]){
      groups[c.group] = { n:0, near:0, off:0, gross:0, noLock:0, falseLock:0, oob:0, errs:[] };
      order.push(c.group);
    }
    var g = groups[c.group];
    g.n++;
    if(k === "near") g.near++;
    else if(k === "off") g.off++;
    else if(k === "gross") g.gross++;
    else if(k === "no-lock") g.noLock++;
    else if(k === "false-lock"){ g.falseLock++; if(!r.inRange) g.oob++; }
    if(c.truth != null && r.rpm != null) g.errs.push(Math.abs(r.rpm - c.truth));
    rows.push({ c:c, r:r, k:k });
  });

  var scorable = cases.filter(function(c){ return c.truth != null; }).length;
  var tot = { n:cases.length, near:0, off:0, gross:0, noLock:0, falseLock:0, oob:0,
              scorable:scorable, ambient:cases.length - scorable };
  order.forEach(function(nm){
    var g = groups[nm];
    tot.near += g.near; tot.off += g.off; tot.gross += g.gross;
    tot.noLock += g.noLock; tot.falseLock += g.falseLock; tot.oob += g.oob;
  });
  tot.within50 = scorable ? 100*tot.near/scorable : 0;
  tot.cleanErr = groups.clean && groups.clean.errs.length ? Math.max.apply(null, groups.clean.errs) : 0;
  return { groups:groups, order:order, rows:rows, tot:tot };
}

function pad(s, n){ s = String(s); while(s.length < n) s += " "; return s; }
function median(a){ var s = a.slice().sort(function(x,y){ return x-y; }); return s[s.length>>1]; }

function report(res, verbose){
  if(verbose) res.rows.forEach(function(x){
    console.log(pad(x.k, 11) + pad(x.c.group, 11) + pad(x.c.name, 30) +
      "expected " + pad(x.c.truth == null ? "no rotor" : x.c.truth + " rpm", 12) +
      "got " + (x.r.rpm == null ? "no lock" : Math.round(x.r.rpm) + " rpm"));
  });
  if(verbose) console.log("");

  console.log(pad("group", 12) + pad("n", 5) + pad("within50", 10) + pad("off", 6) +
              pad("gross", 7) + pad("no-lock", 9) + pad("false-lock", 12) + "median err");
  console.log(new Array(78).join("-"));
  res.order.forEach(function(nm){
    var g = res.groups[nm];
    var scored = g.n - g.falseLock;
    console.log(pad(nm, 12) + pad(String(g.n), 5) +
      pad(g.errs.length ? (100*g.near/Math.max(1, scored)).toFixed(0) + "%" : "-", 10) +
      pad(String(g.off), 6) + pad(String(g.gross), 7) + pad(String(g.noLock), 9) +
      pad(g.falseLock + (g.oob ? " (" + g.oob + " flagged)" : ""), 12) +
      (g.errs.length ? median(g.errs).toFixed(1) : "-"));
  });
  console.log(new Array(78).join("-"));
  var t = res.tot;
  console.log("cases " + t.n + " | within50 " + t.within50.toFixed(1) + "% of " + t.scorable +
    " | gross " + t.gross + " | no-lock " + t.noLock +
    " | false-lock " + t.falseLock + " of " + t.ambient + " ambient" +
    " | worst clean err " + t.cleanErr.toFixed(1) + " rpm");
}

function check(){
  var bad = [];
  BAR.seeds.forEach(function(sd){
    var t = evaluate(sd, null).tot;
    var fails = [];
    if(t.within50 < BAR.within50) fails.push("within50 " + t.within50.toFixed(1) + "% < " + BAR.within50 + "%");
    if(t.gross > BAR.gross) fails.push("gross " + t.gross + " > " + BAR.gross);
    if(t.cleanErr > BAR.cleanErr) fails.push("clean err " + t.cleanErr.toFixed(1) + " > " + BAR.cleanErr);
    if(t.falseLock > BAR.falseLock) fails.push("false-lock " + t.falseLock + " > " + BAR.falseLock);
    console.log((fails.length ? "FAIL" : "pass") + "  seed " + pad(sd, 6) +
      "within50 " + pad(t.within50.toFixed(1) + "%", 8) + "gross " + pad(t.gross, 4) +
      "no-lock " + pad(t.noLock, 4) + "false-lock " + pad(t.falseLock, 4) +
      "clean " + t.cleanErr.toFixed(1) + " rpm" + (fails.length ? "   <- " + fails.join("; ") : ""));
    if(fails.length) bad.push(sd);
  });
  console.log("");
  if(bad.length){
    console.log("detection has slipped on " + bad.length + " of " + BAR.seeds.length + " noise draws");
    process.exit(1);
  }
  console.log("detection holds the bar on all " + BAR.seeds.length + " noise draws");
}

if(require.main === module){
  var argv = process.argv.slice(2);
  if(argv.indexOf("--check") >= 0) check();
  else {
    var only = (argv.filter(function(a){ return a.indexOf("--group=") === 0; })[0] || "").split("=")[1];
    var sd = process.env.ZT_SEED ? +process.env.ZT_SEED : null;
    report(evaluate(sd, only), argv.indexOf("--verbose") >= 0);
  }
}
module.exports = { evaluate: evaluate, runCase: runCase, classify: classify };
