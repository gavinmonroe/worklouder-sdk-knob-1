export const DEFAULT_POMODORO = Object.freeze({
  workSeconds: 25 * 60,
  breakSeconds: 5 * 60,
  cycles: 4,
});

function positiveInteger(raw, label, max) {
  if (!/^\d+$/u.test(raw ?? "")) throw new Error(`${label} must be a positive integer`);
  const value = Number(raw);
  if (value < 1 || value > max) throw new Error(`${label} must be between 1 and ${max}`);
  return value;
}

export function parsePomodoroArgs(argv) {
  const [command = "status", ...args] = argv;
  if (!["start", "stop", "status", "demo", "help", "--help", "-h"].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const options = { ...DEFAULT_POMODORO, port: 9230 };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[++index];
    if (value === undefined) throw new Error(`${flag} requires a value`);
    if (flag === "--work-minutes") options.workSeconds = positiveInteger(value, flag, 180) * 60;
    else if (flag === "--break-minutes") options.breakSeconds = positiveInteger(value, flag, 60) * 60;
    else if (flag === "--work-seconds") options.workSeconds = positiveInteger(value, flag, 10_800);
    else if (flag === "--break-seconds") options.breakSeconds = positiveInteger(value, flag, 3_600);
    else if (flag === "--cycles") options.cycles = positiveInteger(value, flag, 20);
    else if (flag === "--port") options.port = positiveInteger(value, flag, 65_535);
    else throw new Error(`Unknown option: ${flag}`);
  }

  if (command === "demo") {
    options.workSeconds = 8;
    options.breakSeconds = 4;
    options.cycles = 1;
  }
  return { command, options };
}

export function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const minutesPart = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secondsPart = (seconds % 60).toString().padStart(2, "0");
  return `${minutesPart}:${secondsPart}`;
}

