import { describe, expect, it } from "vitest";
import { Countdown } from "./Countdown";

// TOTAL mirrors the impl's 3 * 0.75 (interval) + 0.6 (GO hold).
const TOTAL = 3 * 0.75 + 0.6;

function makeAudio(): { uiBeep: (k: string) => void; calls: string[] } {
  const calls: string[] = [];
  return { calls, uiBeep: (k) => calls.push(k) };
}

function makeCountdown(): { countdown: Countdown; audio: ReturnType<typeof makeAudio> } {
  const container = document.createElement("div");
  const audio = makeAudio();
  const countdown = new Countdown(container, audio);
  return { countdown, audio };
}

describe("Countdown — phase timer (006)", () => {
  it("update before show() is a no-op (no beeps, returns running)", () => {
    const { countdown, audio } = makeCountdown();
    expect(countdown.update(0.5)).toBe("running");
    expect(audio.calls).toHaveLength(0);
  });

  it("show() fires the first 'beep' and shows '3'", () => {
    const { countdown, audio } = makeCountdown();
    countdown.show();
    expect(audio.calls).toEqual(["beep"]);
    expect(countdown["number"].textContent).toBe("3");
  });

  it("advances 3 -> 2 -> 1 -> GO! one beep per interval, then done", () => {
    const { countdown, audio } = makeCountdown();
    countdown.show();
    audio.calls.length = 0;

    expect(countdown["number"].textContent).toBe("3");
    expect(countdown.update(0.75)).toBe("running"); // -> "2"
    expect(countdown["number"].textContent).toBe("2");
    expect(countdown.update(0.75)).toBe("running"); // -> "1"
    expect(countdown["number"].textContent).toBe("1");
    expect(countdown.update(0.75)).toBe("running"); // -> "GO!"
    expect(countdown["number"].textContent).toBe("GO!");
    expect(countdown.update(0.6)).toBe("done"); // GO hold elapsed

    // show() beeped "3" already (cleared): 2, 1 = beep; GO! = go.
    expect(audio.calls).toEqual(["beep", "beep", "go"]);
  });

  it("returns 'done' after the GO hold (~2.85s) and beeps GO exactly once", () => {
    const { countdown, audio } = makeCountdown();
    countdown.show();
    // One large dt jumps to landing phase (GO!) and beeps it once.
    expect(countdown.update(TOTAL + 0.1)).toBe("done");
    expect(countdown["number"].textContent).toBe("GO!");
    expect(audio.calls.filter((k) => k === "go")).toHaveLength(1);
  });

  it("update after done is idempotent (keeps returning 'done')", () => {
    const { countdown } = makeCountdown();
    countdown.show();
    countdown.update(TOTAL + 1);
    expect(countdown.update(0.1)).toBe("done");
    expect(countdown.update(0.1)).toBe("done");
  });

  it("GO beep fires exactly once even across many small updates", () => {
    const { countdown, audio } = makeCountdown();
    countdown.show();
    audio.calls.length = 0;
    // Step in 0.1s slices through the whole sequence (< 0.75 interval, so no
    // phase is skipped).
    let done = "running";
    for (let t = 0; t < TOTAL + 1 && done === "running"; t += 0.1) {
      done = countdown.update(0.1);
    }
    // show() beeped "3" (cleared); loop enters 2 + 1 (beep) and GO! (go).
    expect(audio.calls.filter((k) => k === "beep")).toHaveLength(2);
    expect(audio.calls.filter((k) => k === "go")).toHaveLength(1);
  });

  it("remove() detaches from the DOM", () => {
    const container = document.createElement("div");
    const audio = makeAudio();
    const countdown = new Countdown(container, audio);
    countdown.show();
    expect(container.children).toHaveLength(1);
    countdown.remove();
    expect(container.children).toHaveLength(0);
  });

  it("show() restarts the sequence cleanly (re-beeps 3)", () => {
    const { countdown, audio } = makeCountdown();
    countdown.show();
    countdown.update(TOTAL + 1); // finish
    audio.calls.length = 0;
    countdown.show(); // restart
    expect(audio.calls).toEqual(["beep"]);
    expect(countdown["number"].textContent).toBe("3");
    expect(countdown.update(0.1)).toBe("running");
  });

  it("numeral uses the editorial serif stack, light weight, INK (158)", () => {
    const { countdown } = makeCountdown();
    countdown.show();
    const num = countdown["number"];
    expect(num.style.fontFamily).toContain("Georgia");
    expect(num.style.fontWeight).toBe("300");
    expect(num.style.fontStyle).not.toBe("italic");
  });

  it("GO! phase switches to the italic MENU_ACCENT accent (158)", () => {
    const { countdown } = makeCountdown();
    countdown.show();
    countdown.update(0.75); // -> 2
    countdown.update(0.75); // -> 1
    countdown.update(0.75); // -> GO!
    const num = countdown["number"];
    expect(num.textContent).toBe("GO!");
    expect(num.style.fontStyle).toBe("italic");
    expect(num.style.fontWeight).toBe("400");
  });

  it("show() after GO! resets the numeral to the neutral base style", () => {
    const { countdown } = makeCountdown();
    countdown.show();
    countdown.update(TOTAL + 1); // reach GO! accent
    expect(countdown["number"].style.fontStyle).toBe("italic");
    countdown.show(); // restart
    expect(countdown["number"].style.fontStyle).not.toBe("italic");
    expect(countdown["number"].style.fontWeight).toBe("300");
  });
});

// Reference TOTAL from the impl without exporting it: derive from defaults.
