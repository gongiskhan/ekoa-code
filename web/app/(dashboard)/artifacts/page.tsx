"use client";

import { ArtifactsSurface } from "@/components/artifacts/artifacts-surface";
import type { SurfaceHost } from "@/lib/os/types";

// Classic mount of the artifacts surface (surface contract 2.1): the same
// component the OS shell mounts in a window. The classic host opens served
// apps the way this page always has - a new tab.
const classicHost: SurfaceHost = {
  mode: "classic",
  openSurface: (_surfaceId, props) => {
    const url = props?.appUrl;
    if (typeof url === "string" && url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },
};

export default function ArtifactsPage() {
  return <ArtifactsSurface instanceId="artifacts" props={{}} host={classicHost} />;
}
