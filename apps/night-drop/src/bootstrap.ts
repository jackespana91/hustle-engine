/// <reference types="vite/client" />

const query = new URLSearchParams(window.location.search);

void bootstrap();

async function bootstrap(): Promise<void> {
  if (query.get("runnerSpike") === "1") {
    preloadRunnerAsset("/assets/night-drop/runner/city-kit/night-drop-city-kit.glb");
    preloadRunnerAsset("/assets/night-drop/runner/characters/dash/dash.glb?v=blender-skin-v12");
    await import("./runner-spike/runner-spike.js");
    return;
  }
  if (import.meta.env.DEV && query.get("visualReset") === "1") {
    await import("./visual-reset/visual-reset.js");
    return;
  }
  await import("./main.js");
}

function preloadRunnerAsset(href: string): void {
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "fetch";
  link.crossOrigin = "anonymous";
  link.href = href;
  document.head.append(link);
}
