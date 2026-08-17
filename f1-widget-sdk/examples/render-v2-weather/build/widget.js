var selectedDay = 0;

widget.on("input.fn-bottom-knob", function (event) {
  selectedDay += event.delta;
  selectedDay = mod(selectedDay, 3);
  document.querySelector("#forecast-1").style.color = pick(selectedDay, "#FF8A00", "#77736F", "#77736F");
  document.querySelector("#forecast-2").style.color = pick(selectedDay, "#77736F", "#FF8A00", "#77736F");
  document.querySelector("#forecast-3").style.color = pick(selectedDay, "#77736F", "#77736F", "#FF8A00");
});
