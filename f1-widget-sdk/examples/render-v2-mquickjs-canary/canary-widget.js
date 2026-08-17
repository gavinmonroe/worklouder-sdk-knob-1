var MODE_KEY = 0;
var ACTION_KEY = 1;
var seconds = 300;
var running = 0;
var dialTurns = 0;

function clampSeconds(value) {
  if (value < 0) return 0;
  if (value > 359999) return 359999;
  return value;
}

function publish(reason) {
  widget.setInt(0, seconds);
  widget.setInt(1, running);
  widget.setInt(2, dialTurns);
  widget.setInt(3, reason);
  widget.commit();
}

widget.on("tick.1s", function (event) {
  if (running && seconds > 0) {
    seconds = seconds - 1;
    if (seconds === 0) running = 0;
    publish(1);
  }
});

widget.on("input.fn-bottom-knob", function (event) {
  var step = widget.isHeld(event, MODE_KEY) ? 60 : 5;
  seconds = clampSeconds(seconds + event.delta * step);
  dialTurns = dialTurns + event.delta;
  publish(2);
});

widget.on("input.key.down", function (event) {
  if (event.key === ACTION_KEY) {
    running = running ? 0 : 1;
    publish(3);
  }
});

widget.on("input.key.hold", function (event) {
  if (event.key === ACTION_KEY && event.holdCount === 1) {
    seconds = 300;
    running = 0;
    publish(4);
  }
});

widget.on("input.chord.down", function (event) {
  if (event.chord === 0) {
    seconds = 0;
    running = 0;
    publish(5);
  }
});

widget.on("host.rpc:0x7001", function (event) {
  seconds = clampSeconds(event.value);
  running = event.auxiliary ? 1 : 0;
  publish(6);
});
