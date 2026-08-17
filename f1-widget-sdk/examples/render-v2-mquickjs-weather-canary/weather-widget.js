"use strict";

var stageRevision = 0;
var stageMask = 0;
var stageInvalid = 0;
var stageCurrent = 0;
var stageDay1 = 0;
var stageDay2 = 0;
var stageDay3 = 0;

var appliedRevision = 0;
var hasGood = 0;
var goodCurrent = 0;
var goodDay1 = 0;
var goodDay2 = 0;
var goodDay3 = 0;
var ageSeconds = 0;
var retrySeconds = 0;
var stateFlags = 0;
function syncState() {
  appliedRevision = widget.getInt(0);
  ageSeconds = widget.getInt(12);
  retrySeconds = widget.getInt(14);
  stateFlags = widget.getInt(15);
}

function signed10(value) {
  value = value & 1023;
  return (value & 512) ? value - 1024 : value;
}

/* Four little-endian ASCII bytes; the native target facade appends the degree/unit. */
function temperatureWord(value) {
  var negative = value < 0;
  var magnitude = negative ? -value : value;
  var result = 0;
  var offset = 0;
  var hundreds;
  var tens;
  var ones;
  if (magnitude > 999) magnitude = 999;
  if (negative) {
    result = 45;
    offset = 8;
  }
  hundreds = (magnitude / 100) | 0;
  tens = ((magnitude / 10) | 0) % 10;
  ones = magnitude % 10;
  if (hundreds) {
    result = result | ((48 + hundreds) << offset);
    offset = offset + 8;
    result = result | ((48 + tens) << offset);
    offset = offset + 8;
  } else if (tens) {
    result = result | ((48 + tens) << offset);
    offset = offset + 8;
  }
  result = result | ((48 + ones) << offset);
  return result | 0;
}

function dayMeta(value) {
  return (((value >>> 24) & 7) | (((value >>> 20) & 15) << 3)) | 0;
}

function validDay(value) {
  var low = signed10(value);
  var high = signed10(value >>> 10);
  return ((value >>> 20) & 15) <= 7 && ((value >>> 24) & 7) <= 6 && low <= high;
}

function publish(withWeather) {
  var hasGood = stateFlags & 1;
  var providerError = stateFlags & 4;
  var fresh = !hasGood ? (providerError ? 4 : 0) : (providerError ? 3 : (ageSeconds > 1800 ? 2 : 1));
  widget.setInt(0, appliedRevision);
  /* Status-only events inherit target slots 1..11. This also means a
   * re-evaluated context cannot overwrite the runtime's retained forecast. */
  if (withWeather) {
    widget.setInt(1, temperatureWord(signed10(goodCurrent)));
    widget.setInt(2, ((goodCurrent >>> 10) & 15) | (((goodCurrent >>> 14) & 1) << 4));
    widget.setInt(3, dayMeta(goodDay1));
    widget.setInt(4, temperatureWord(signed10(goodDay1)));
    widget.setInt(5, temperatureWord(signed10(goodDay1 >>> 10)));
    widget.setInt(6, dayMeta(goodDay2));
    widget.setInt(7, temperatureWord(signed10(goodDay2)));
    widget.setInt(8, temperatureWord(signed10(goodDay2 >>> 10)));
    widget.setInt(9, dayMeta(goodDay3));
    widget.setInt(10, temperatureWord(signed10(goodDay3)));
    widget.setInt(11, temperatureWord(signed10(goodDay3 >>> 10)));
  }
  widget.setInt(12, ageSeconds);
  widget.setInt(13, fresh);
  widget.setInt(14, retrySeconds);
  widget.setInt(15, stateFlags);
  widget.commit();
}

function stageRecord(bit, value, revision) {
  if (!stageRevision || revision !== stageRevision || revision <= appliedRevision) return;
  if (stageMask & bit) {
    if ((bit === 1 && stageCurrent !== value) ||
        (bit === 2 && stageDay1 !== value) ||
        (bit === 4 && stageDay2 !== value) ||
        (bit === 8 && stageDay3 !== value)) stageInvalid = 1;
    return;
  }
  if (bit === 1) stageCurrent = value;
  else if (bit === 2) stageDay1 = value;
  else if (bit === 4) stageDay2 = value;
  else if (bit === 8) stageDay3 = value;
  stageMask = stageMask | bit;
}

widget.on("host.rpc:0xB240", function (event) {
  var revision = event.value;
  syncState();
  if (revision <= appliedRevision || revision < stageRevision) return;
  if (revision === stageRevision) return;
  stageRevision = revision;
  stageMask = 0;
  stageInvalid = 0;
});

widget.on("host.rpc:0xB241", function (event) {
  stageRecord(1, event.value, event.auxiliary);
});

widget.on("host.rpc:0xB242", function (event) {
  stageRecord(2, event.value, event.auxiliary);
});

widget.on("host.rpc:0xB243", function (event) {
  stageRecord(4, event.value, event.auxiliary);
});

widget.on("host.rpc:0xB244", function (event) {
  stageRecord(8, event.value, event.auxiliary);
});

widget.on("host.rpc:0xB24F", function (event) {
  if (event.value !== stageRevision || event.auxiliary !== 15 || stageMask !== 15 || stageInvalid ||
      ((stageCurrent >>> 10) & 15) > 7 || !validDay(stageDay1) || !validDay(stageDay2) ||
      !validDay(stageDay3)) {
    if (event.value === stageRevision) {
      stageRevision = 0;
      stageMask = 0;
      stageInvalid = 0;
    }
    return;
  }
  goodCurrent = stageCurrent;
  goodDay1 = stageDay1;
  goodDay2 = stageDay2;
  goodDay3 = stageDay3;
  appliedRevision = stageRevision;
  stageRevision = 0;
  stageMask = 0;
  stageInvalid = 0;
  stateFlags = (stateFlags | 1) & ~4;
  ageSeconds = 0;
  retrySeconds = 0;
  publish(1);
});

widget.on("host.rpc:0xB24D", function (event) {
  syncState();
  stateFlags = event.value ? (stateFlags | 4) : (stateFlags & ~4);
  retrySeconds = event.auxiliary < 0 ? 0 : event.auxiliary;
  publish(0);
});

widget.on("host.rpc:0xB24E", function (event) {
  var elapsed = event.auxiliary;
  syncState();
  stateFlags = event.value ? (stateFlags & ~2) : (stateFlags | 2);
  if (!(stateFlags & 2) && (stateFlags & 1) && elapsed > 0) {
    if (elapsed > 604800) elapsed = 604800;
    ageSeconds = ageSeconds + elapsed;
    if (ageSeconds > 604800) ageSeconds = 604800;
  }
  publish(0);
});

widget.on("tick.1s", function (event) {
  syncState();
  if (stateFlags & 2) return;
  if ((stateFlags & 1) && ageSeconds < 604800) ageSeconds = ageSeconds + 1;
  if (retrySeconds > 0) retrySeconds = retrySeconds - 1;
  publish(0);
});
