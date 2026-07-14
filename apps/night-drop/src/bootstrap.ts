const visualResetRequested = new URLSearchParams(window.location.search).get("visualReset") === "1";

if (import.meta.env.DEV && visualResetRequested) {
  void import("./visual-reset/visual-reset.js");
} else {
  void import("./main.js");
}
