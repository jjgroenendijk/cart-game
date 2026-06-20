import * as THREE from "three";
import { Renderer } from "./Renderer";
import { Input } from "./Input";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { TestArena } from "../tracks/TestArena";
import { Kart } from "../kart/Kart";
import { ChaseCamera } from "../kart/ChaseCamera";
import { clamp } from "./math";

const STEP = 1 / 60;

export class Game {
  private readonly renderer: Renderer;
  private readonly physics: PhysicsWorld;
  private readonly input = new Input();
  private readonly arena: TestArena;
  private readonly kart: Kart;
  private readonly camera: ChaseCamera;
  private readonly hud: HTMLElement;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container);
    this.physics = new PhysicsWorld(-24);
    this.arena = new TestArena(this.physics);
    this.renderer.scene.add(this.arena.group);

    this.kart = new Kart(this.physics, new THREE.Vector3(0, 1.5, 24), 0, 0);
    this.renderer.scene.add(this.kart.group);

    this.camera = new ChaseCamera(window.innerWidth / window.innerHeight);

    this.hud = this.createHud();
    container.appendChild(this.hud);

    window.addEventListener("resize", this.onResize);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hud.remove();
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;

    this.input.beginFrame();
    const kartInput = this.input.sample(0);

    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.kart.fixedUpdate(STEP, kartInput);
      this.physics.step();
      this.acc -= STEP;
      steps++;
    }

    this.kart.sync(1);
    const pos = this.kart.group.position;
    this.camera.update(
      dt,
      pos,
      this.kart.forwardDir,
      this.kart.speed,
      this.kart.controller.isDrifting,
    );
    this.renderer.setShadowTarget(pos.x, pos.z);
    this.updateHud();
    this.renderer.render(this.camera.camera);
    this.input.endFrame();
  };

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.resize(w, h);
    this.camera.setAspect(w / h);
  };

  private createHud(): HTMLElement {
    const hud = document.createElement("div");
    hud.style.cssText = [
      "position:absolute",
      "left:14px",
      "top:14px",
      "z-index:5",
      "font-family:system-ui,sans-serif",
      "color:#fff",
      "pointer-events:none",
      "text-shadow:0 2px 6px rgba(0,0,0,0.8)",
      "line-height:1.5",
    ].join(";");

    const speed = document.createElement("div");
    speed.id = "hud-speed";
    speed.style.fontSize = "28px";
    speed.style.fontWeight = "700";
    hud.appendChild(speed);

    const controls = document.createElement("div");
    controls.style.cssText = "margin-top:10px;font-size:12px;opacity:0.85;max-width:240px";
    controls.innerHTML = [
      "<b>WASD / Arrows</b> — drive",
      "<b>Space</b> — drift",
      "<b>S</b> — brake / reverse",
      "<b>R</b> — reset kart",
      "<b>Gamepad</b> also supported",
    ].join("<br>");
    hud.appendChild(controls);

    return hud;
  }

  private updateHud(): void {
    const el = this.hud.querySelector("#hud-speed") as HTMLElement | null;
    if (el) {
      const kmh = Math.round(clamp(this.kart.speed, 0, 999) * 3.6);
      el.textContent = `${kmh} km/h`;
    }
  }
}
