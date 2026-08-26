// Side-effect import, not a call: imports are hoisted, so a call here would run
// after any SDK module in the graph had already touched Buffer.
import "./compat/install";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./lib/intellisense";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
