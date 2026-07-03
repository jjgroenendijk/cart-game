import { initRapier } from "./physics/PhysicsWorld";
import { Game } from "./core/Game";
import { StatsHud } from "./ui/StatsHud";
import { parseSceneBookmark, readSceneQuery } from "./core/sceneBookmark";

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
  const sceneRaw = readSceneQuery();
  if (sceneRaw !== null) game.enterSceneMode(parseSceneBookmark(sceneRaw));
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
