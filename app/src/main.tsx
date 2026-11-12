import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css";
import { installLogBridge } from "./lib/log";
import { installTvRemote } from "./lib/tv";

installLogBridge();
installTvRemote();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
