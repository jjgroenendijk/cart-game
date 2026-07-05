import { describe, expect, it } from "vitest";
import { SplineTrack } from "./SplineTrack";
import { TrackGraph } from "./trackGraph";
import { markerWorldPose } from "./trackMarkers";

describe("markerWorldPose (060 marker shape)", () => {
  const graph = new TrackGraph(new SplineTrack());
  const main = graph.edgeById(0);

  it("lateral 0 sits on the centerline with a forward-aligned yaw", () => {
    const s = main.length * 0.3;
    const pose = markerWorldPose(graph, { edgeId: 0, s, lateral: 0, kind: "item" });
    const p = main.pointAt(s);
    expect(pose.x).toBeCloseTo(p.x, 5);
    expect(pose.z).toBeCloseTo(p.z, 5);
    const tan = main.tangentAt(s);
    expect(pose.yaw).toBeCloseTo(Math.atan2(-tan.x, -tan.z), 5);
  });

  it("lateral offsets perpendicular to the tangent by the requested metres", () => {
    const s = main.length * 0.62;
    const pose = markerWorldPose(graph, { edgeId: 0, s, lateral: 3, kind: "boost" });
    const p = main.pointAt(s);
    expect(Math.hypot(pose.x - p.x, pose.z - p.z)).toBeCloseTo(3, 3);
    const tan = main.tangentAt(s);
    const dot = (pose.x - p.x) * tan.x + (pose.z - p.z) * tan.z;
    expect(Math.abs(dot)).toBeLessThan(0.15);
  });

  it("circuits ship an empty marker list (shape only lands with 060)", async () => {
    const { generateCircuit } = await import("./circuit");
    expect(generateCircuit(3).markers).toEqual([]);
  });
});
