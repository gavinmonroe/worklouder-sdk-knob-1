"use strict";
/* ID28 weather + knob-driven ZIP settings. The 8192 B source cap is why the
 * names are short; the slot map lives in design.mjs and the build manifest. */

var sRev = 0;
var sMask = 0;
var sBad = 0;
var sCur = 0;
var sD1 = 0;
var sD2 = 0;
var sD3 = 0;

var rev = 0;
var gCur = 0;
var gD1 = 0;
var gD2 = 0;
var gD3 = 0;
var res = 0;
var good = 0;
var hid = 0;
var err = 0;
var age = 0;
var tmr = 0;
var set = 0;
var cUsed = 0;
var ph = 0;
var dIdx = 0;
var zip = 0;
var zipOk = -1;
var save = 0;
var seq = 0;

function sync() {
  var ui = widget.getInt(12);
  var sf = widget.getInt(13);
  var sw = widget.getInt(14);
  var wf = widget.getInt(15);
  rev = widget.getInt(0);
  good = (ui >>> 1) & 1;
  set = sf & 1;
  cUsed = (sf >>> 1) & 1;
  hid = (wf >>> 1) & 1;
  err = (wf >>> 2) & 1;
  zip = sw & 131071;
  save = (sw >>> 18) & 1;
  tmr = (sw >>> 19) & 31;
  seq = (sw >>> 24) & 255;
  if (set) {
    ph = widget.getInt(2) & 15;
    if (ph < 1 || ph > 3) ph = 1;
    dIdx = widget.getInt(8) & 7;
    if (dIdx > 4) dIdx = 4;
  }
}

function s10(v) {
  v = v & 1023;
  return (v & 512) ? v - 1024 : v;
}

/* Four little-endian ASCII bytes; the facade appends the degree sign. */
function tw(v) {
  var neg = v < 0;
  var m = neg ? -v : v;
  var r = 0;
  var o = 0;
  var h;
  var t;
  if (m > 999) m = 999;
  if (neg) {
    r = 45;
    o = 8;
  }
  h = (m / 100) | 0;
  t = ((m / 10) | 0) % 10;
  if (h) {
    r = r | ((48 + h) << o);
    o = o + 8;
    r = r | ((48 + t) << o);
    o = o + 8;
  } else if (t) {
    r = r | ((48 + t) << o);
    o = o + 8;
  }
  return (r | ((48 + m % 10) << o)) | 0;
}

function dm(v) {
  return (((v >>> 24) & 7) | (((v >>> 20) & 15) << 3)) | 0;
}

function vd(v) {
  return ((v >>> 20) & 15) <= 7 && ((v >>> 24) & 7) <= 6 && s10(v) <= s10(v >>> 10);
}

/* Formatter 5 picks table[(meta & 15) + (meta & 16 ? 0 : 8)]. */
function mf(i) {
  return (i <= 7 ? (i | 16) : (i - 8)) | 0;
}

function wState() {
  widget.setInt(0, rev);
  widget.setInt(12, ((good || set) ? 1 : 0) | (good ? 2 : 0));
  widget.setInt(13, (set ? 1 : 0) | (cUsed ? 2 : 0));
  widget.setInt(14, ((zip & 131071) | (set ? 131072 : 0) | (save ? 262144 : 0) |
    ((tmr & 31) << 19) | ((seq & 255) << 24)) | 0);
  widget.setInt(15, ((good && !set) ? 1 : 0) | (hid ? 2 : 0) | (err ? 4 : 0));
}

function wWeather() {
  var c = (gCur >>> 10) & 15;
  widget.setInt(1, tw(s10(gCur)));
  widget.setInt(2, mf((c === 0 && !((gCur >>> 14) & 1)) ? 8 : c));
  widget.setInt(3, dm(gD1));
  widget.setInt(4, tw(s10(gD1)));
  widget.setInt(5, tw(s10(gD1 >>> 10)));
  widget.setInt(6, dm(gD2));
  widget.setInt(7, tw(s10(gD2)));
  widget.setInt(8, tw(s10(gD2 >>> 10)));
  widget.setInt(9, dm(gD3));
  widget.setInt(10, tw(s10(gD3)));
  widget.setInt(11, tw(s10(gD3 >>> 10)));
}

function wSet() {
  var r = zip;
  var i = 4;
  widget.setInt(2, ph);
  while (i >= 0) {
    widget.setInt(3 + i, mf(r % 10));
    r = (r / 10) | 0;
    i = i - 1;
  }
  widget.setInt(8, (ph === 1 ? dIdx : 5) | 16);
}

/* 0 status only, 1 full weather, 2 settings view. */
function pub(mode) {
  if (mode === 1) wWeather();
  else if (mode === 2) wSet();
  wState();
  widget.commit();
}

function enter() {
  set = 1;
  ph = 1;
  dIdx = 0;
  tmr = 30;
  pub(2);
}

/* Leaving restores slots 1..11 from this context; after a reset lost them the
 * weather has-good bit stays clear instead of reading settings words as a
 * forecast. */
function leave() {
  if (ph === 1 && zipOk >= 0) zip = zipOk;
  set = 0;
  ph = 0;
  dIdx = 0;
  tmr = 0;
  if (!res) good = 0;
  pub(res ? 1 : 0);
}

function poke() {
  err = 1;
  tmr = 20;
  pub(0);
}

function stage(bit, v, r) {
  if (!sRev || r !== sRev || r <= rev) return;
  if (sMask & bit) {
    if ((bit === 1 && sCur !== v) || (bit === 2 && sD1 !== v) ||
        (bit === 4 && sD2 !== v) || (bit === 8 && sD3 !== v)) sBad = 1;
    return;
  }
  if (bit === 1) sCur = v;
  else if (bit === 2) sD1 = v;
  else if (bit === 4) sD2 = v;
  else if (bit === 8) sD3 = v;
  sMask = sMask | bit;
}

widget.on("host.rpc:0xB240", function (e) {
  var r = e.value;
  sync();
  if (r <= rev || r <= sRev) return;
  sRev = r;
  sMask = 0;
  sBad = 0;
});

widget.on("host.rpc:0xB241", function (e) {
  stage(1, e.value, e.auxiliary);
});

widget.on("host.rpc:0xB242", function (e) {
  stage(2, e.value, e.auxiliary);
});

widget.on("host.rpc:0xB243", function (e) {
  stage(4, e.value, e.auxiliary);
});

widget.on("host.rpc:0xB244", function (e) {
  stage(8, e.value, e.auxiliary);
});

/* Host acknowledgement of a saved ZIP, and the boot push of the stored one. */
widget.on("host.rpc:0xB245", function (e) {
  var v = e.value;
  sync();
  if (v < 0 || v > 99999) return;
  if (save && ((e.auxiliary & 255) !== seq)) return;
  zip = v;
  zipOk = v;
  save = 0;
  if (!set) {
    pub(0);
    return;
  }
  ph = 3;
  dIdx = 0;
  tmr = 2;
  pub(2);
});

widget.on("host.rpc:0xB24F", function (e) {
  if (e.value !== sRev || e.auxiliary !== 15 || sMask !== 15 || sBad ||
      ((sCur >>> 10) & 15) > 7 || !vd(sD1) || !vd(sD2) || !vd(sD3)) {
    if (e.value === sRev) {
      sRev = 0;
      sMask = 0;
      sBad = 0;
    }
    return;
  }
  gCur = sCur;
  gD1 = sD1;
  gD2 = sD2;
  gD3 = sD3;
  rev = sRev;
  sRev = 0;
  sMask = 0;
  sBad = 0;
  res = 1;
  good = 1;
  err = 0;
  age = 0;
  if (!set) tmr = 0;
  pub(set ? 0 : 1);
});

widget.on("host.rpc:0xB24D", function (e) {
  if (e.value === -2147483648 && e.auxiliary === 1414090053) {
    while (1) {}
  }
  if (e.value === -2147483647 && e.auxiliary === 1330597153) {
    var oom = "OOM!";
    while (1) oom = oom + oom;
  }
  sync();
  err = e.value ? 1 : 0;
  if (!set) tmr = e.auxiliary < 0 ? 0 : (e.auxiliary > 31 ? 31 : e.auxiliary);
  pub(0);
});

widget.on("host.rpc:0xB24E", function (e) {
  var el = e.auxiliary;
  sync();
  hid = e.value ? 0 : 1;
  if (!hid && good && el > 0) {
    if (el > 604800) el = 604800;
    age = age + el;
    if (age > 604800) age = 604800;
  }
  pub(0);
});

widget.on("tick.1s", function (e) {
  sync();
  if (hid) return;
  if (tmr > 0) tmr = tmr - 1;
  if (set) {
    if (tmr === 0) leave();
    else pub(2);
    return;
  }
  if (good && age < 604800) age = age + 1;
  pub(0);
});

/* Fn + bottom knob: the only rotary event the engine delivers, delta signed. */
widget.on("input.fn-bottom-knob", function (e) {
  var d = e.delta | 0;
  var scale = 1;
  var i = dIdx;
  var cur;
  var next;
  sync();
  if (!set) {
    poke();
    return;
  }
  tmr = 30;
  if (ph !== 1 || d === 0) {
    pub(2);
    return;
  }
  i = dIdx;
  while (i < 4) {
    scale = scale * 10;
    i = i + 1;
  }
  cur = ((zip / scale) | 0) % 10;
  next = (cur + d) % 10;
  if (next < 0) next = next + 10;
  zip = zip + (next - cur) * scale;
  pub(2);
});

function press(e) {
  sync();
  if (!set) poke();
}

function release(e) {
  if (e.synthetic && e.reason !== 1) throw 1;
  press(e);
}

widget.on("input.key.down", press);
widget.on("input.key.up", release);

/* Both admitted keys held for >= ~700 ms (500 ms hold delay + two 100 ms
 * cadences) toggles the settings view; the knob has no press event, so the
 * chord is the only press-and-hold gesture the engine can deliver. */
widget.on("input.key.hold", function (e) {
  sync();
  if (e.heldMask === 3 && (e.holdCount | 0) >= 3) {
    if (cUsed) return;
    cUsed = 1;
    if (set) leave();
    else enter();
    return;
  }
  if (!set) poke();
});

widget.on("input.chord.down", function (e) {
  sync();
  cUsed = 0;
  if (!set) {
    poke();
    return;
  }
  tmr = 30;
  pub(0);
});

/* A chord tap advances one cell and saves on the last one; a release that ends
 * a hold gesture is consumed by that gesture instead. */
widget.on("input.chord.up", function (e) {
  if (e.synthetic && e.reason !== 1) throw 1;
  sync();
  if (!set) {
    cUsed = 0;
    poke();
    return;
  }
  tmr = 30;
  if (cUsed || e.synthetic) {
    cUsed = 0;
    pub(0);
    return;
  }
  if (ph !== 1) {
    leave();
    return;
  }
  if (dIdx < 4) {
    dIdx = dIdx + 1;
    pub(2);
    return;
  }
  ph = 2;
  save = 1;
  seq = (seq + 1) & 255;
  pub(2);
});
