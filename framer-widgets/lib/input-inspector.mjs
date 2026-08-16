const DEFAULT_PORT = 9230;

export async function evaluateInInput(expression, { port = DEFAULT_PORT, timeoutMs = 20_000 } = {}) {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
    if (!response.ok) throw new Error(`Input debugger returned HTTP ${response.status}`);
    return response.json();
  });
  const target = targets.find((candidate) => candidate.webSocketDebuggerUrl);
  if (!target) throw new Error(`No Input main-process debugger found on port ${port}`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const evaluation = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Input debugger evaluation timed out"));
    }, timeoutMs);

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      resolve(message.result);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Input debugger socket failed"));
    });
  });

  socket.close();
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ??
        evaluation.exceptionDetails.text ??
        "Input evaluation failed",
    );
  }
  return evaluation.result?.value;
}

