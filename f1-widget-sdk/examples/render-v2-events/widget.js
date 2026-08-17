var secondsOfDay = 45296;
var knobVariant = 0;
var hostValue = 0;

widget.on("tick.1s", function (event) {
  secondsOfDay = secondsOfDay + 1;
  secondsOfDay = mod(secondsOfDay, 86400);
  document.querySelector("#clock").textContent = formatTime(secondsOfDay);
});

widget.on("input.fn-bottom-knob", function (event) {
  knobVariant += event.delta;
  knobVariant = mod(knobVariant, 3);
  document.querySelector("#knob").textContent = pick(knobVariant, "1", "2", "3");
});

widget.on("host.rpc:0xB201", function (event) {
  hostValue = event.value;
  hostValue = mod(hostValue, 10);
  document.querySelector("#host").textContent = pick(hostValue,
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9");
  document.querySelector("#host").style.color = pick(hostValue,
    "#59E2FF", "#42DCE1", "#5BE89E", "#8FE16C", "#D3D54E",
    "#FFB74D", "#FF875B", "#FF5F97", "#DE5BE2", "#BB6AFF");
});
