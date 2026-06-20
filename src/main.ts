import { initRapier } from "./physics/PhysicsWorld";
import { Game } from "./core/Game";

async function bootstrap(): Promise<void> {
  const app = document.getElementById("app");
  const loading = document.getElementById("loading");
  if (!app) throw new Error("#app container not found");

  try {
    await initRapier();
  } catch (err) {
    console.error("Failed to initialize physics engine", err);
    if (loading) {
      loading.querySelector("p")!.textContent = "Failed to load physics engine. Check console.";
    }
    return;
  }

  const game = new Game(app);
  game.start();

  if (loading) loading.classList.add("hidden");

  // Expose for debugging in the console.
  (window as unknown as { __game: Game }).__game = game;
}

void bootstrap();
