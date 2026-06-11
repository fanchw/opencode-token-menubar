import React from "react"
import { createRoot } from "react-dom/client"
import App from "./App.js"
import "./styles.css"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Renderer root element #root was not found")
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
