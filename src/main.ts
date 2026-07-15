import { initRapier } from "./physics/PhysicsWorld";
import { Game } from "./core/Game";
import { StatsHud } from "./ui/StatsHud";
import { parseDevFlags } from "./core/devFlags";
import { createGarage, type GarageHandle } from "./dev/Garage";

async function bootstrap(): Promise<void> {
  const app = document.getElementById("app");
  const loading = document.getElementById("loading");
  if (!app) throw new Error("#app container not found");

  // Dev URL flags (biome/seed/weather/time/kart/quality/autostart/garage) are
  // honored only in a dev build or when ?debug is present, so production boots
  // clean.
  const dev = parseDevFlags(window.location.search);
  const devEnabled = import.meta.env.DEV || dev.debug;

  // Dev garage viewer: a standalone kart-inspection screen that skips the race
  // Game (and physics) entirely.
  if (devEnabled && dev.garage) {
    (window as unknown as { __garage: GarageHandle | null }).__garage = createGarage(app);
    if (loading) loading.classList.add("hidden");
    return;
  }

  try {
    await initRapier();
  } catch (err) {
    console.error("Failed to initialize physics engine", err);
    if (loading) {
      loading.querySelector("p")!.textContent = "Failed to load physics engine. Check console.";
    }
    return;
  }

  const game = new Game(app, devEnabled ? { dev } : {});
  game.start();

  if (loading) loading.classList.add("hidden");

  new StatsHud(
    app,
    () => game.renderer.getFrameStats(),
    () => game.currentState === "racing",
  );

  // Expose for debugging in the console.
  (window as unknown as { __game: Game }).__game = game;
}

void bootstrap();
