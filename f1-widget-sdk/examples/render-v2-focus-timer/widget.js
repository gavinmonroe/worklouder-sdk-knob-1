var remainingSeconds = 1500;
var dialPhase = 0;

widget.on("tick.1s", function (event) {
  remainingSeconds += -1;
  remainingSeconds = clamp(remainingSeconds, 0, 5700);
  dialPhase += 1;
  dialPhase = mod(dialPhase, 5);
  document.querySelector("#clock").textContent = formatTime(remainingSeconds);
  document.querySelector("#knob").textContent = pick(dialPhase, "1", "2", "3", "4", "5");
});

widget.on("input.fn-bottom-knob", function (event) {
  remainingSeconds += event.delta * 300;
  remainingSeconds = clamp(remainingSeconds, 300, 5700);
  dialPhase += event.delta;
  dialPhase = mod(dialPhase, 5);
  document.querySelector("#clock").textContent = formatTime(remainingSeconds);
  document.querySelector("#knob").textContent = pick(dialPhase, "1", "2", "3", "4", "5");
});

widget.on("host.rpc:0xB201", function (event) {
  remainingSeconds = event.value;
  remainingSeconds = clamp(remainingSeconds, 300, 5700);
  document.querySelector("#clock").textContent = formatTime(remainingSeconds);
});
