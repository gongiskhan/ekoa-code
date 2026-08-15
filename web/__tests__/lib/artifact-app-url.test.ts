/**
 * "Usar" opens the app THROUGH the owner's preview token when the artifact is not shareable
 * (finding: a freshly built, unshared artifact's bare /apps/<slug>/ link answers 410
 * "Link já não disponível", so the dashboard's own primary action opened a dead page).
 * A SHAREABLE artifact keeps the bare link: it serves without auth, and a copied share URL
 * must never carry the owner's JWT (Q-05).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    appUrl: (idOrSlug: string) => `http://api.test/apps/${idOrSlug}/`,
    withPreviewToken: (url: string) => `${url}?token=OWNER_JWT`,
  },
  tryCall: vi.fn(),
  ApiError: class extends Error {},
}));

import { getArtifactAppUrl } from "@/components/artifacts/artifacts-surface";

describe("getArtifactAppUrl", () => {
  it("an unshared active artifact opens with the owner preview token", () => {
    expect(getArtifactAppUrl({ id: "a1", status: "active", slug: "my-app" })).toBe(
      "http://api.test/apps/my-app/?token=OWNER_JWT",
    );
  });

  it("a shareable artifact keeps the bare link (never the owner's JWT on a share URL)", () => {
    expect(getArtifactAppUrl({ id: "a1", status: "active", slug: "my-app", shareable: true })).toBe(
      "http://api.test/apps/my-app/",
    );
  });

  it("falls back to the id when there is no slug and stays null while not built", () => {
    expect(getArtifactAppUrl({ id: "a1", status: "active" })).toBe(
      "http://api.test/apps/a1/?token=OWNER_JWT",
    );
    expect(getArtifactAppUrl({ id: "a1", status: "building" })).toBeNull();
  });
});
