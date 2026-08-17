var secondsOfDay = 45296;
var dialPhase = 0;

widget.on("tick.1s", function (event) {
  secondsOfDay = secondsOfDay + 1;
  secondsOfDay = mod(secondsOfDay, 86400);
  dialPhase += 1;
  dialPhase = mod(dialPhase, 5);
  document.querySelector("#clock").textContent = formatTime(secondsOfDay);
  document.querySelector("#knob").textContent = pick(dialPhase, "1", "2", "3", "4", "5");
});

widget.on("input.fn-bottom-knob", function (event) {
  dialPhase += event.delta;
  dialPhase = mod(dialPhase, 5);
  document.querySelector("#knob").textContent = pick(dialPhase, "1", "2", "3", "4", "5");
});

widget.on("host.rpc:0xB201", function (event) {
  secondsOfDay = event.value;
  secondsOfDay = mod(secondsOfDay, 86400);
  document.querySelector("#clock").textContent = formatTime(secondsOfDay);
});
