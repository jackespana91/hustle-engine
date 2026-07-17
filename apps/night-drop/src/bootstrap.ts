/// <reference types="vite/client" />

const query = new URLSearchParams(window.location.search);

void bootstrap();

async function bootstrap(): Promise<void> {
  if (query.get("runnerSpike") === "1") {
    await import("./runner-spike/runner-spike.js");
    return;
  }
  if (import.meta.env.DEV && query.get("visualReset") === "1") {
    await import("./visual-reset/visual-reset.js");
    return;
  }
  await import("./main.js");
}
