// Training videos: shared by the upload route, the actions and the panel page.

import { canSee, NAV_KEYS, type NavKey } from "@/lib/nav";
import type { UserRole } from "@/types";

/** "geral" (Primeiros passos) plus one module per panel page, in menu order. */
export type TrainingModule = "geral" | Exclude<NavKey, "treinamento">;
export const TRAINING_MODULES = ["geral", ...NAV_KEYS.filter((k) => k !== "treinamento")] as readonly TrainingModule[];

/** Employees only train on the pages they can open. */
export const canSeeModule = (module: string, role: UserRole) =>
  module === "geral" || ((NAV_KEYS as readonly string[]).includes(module) && canSee(module as NavKey, role));

export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
export const VIDEO_PREFIX = "treinamento/";

/** A file uploaded to this project's Blob store under VIDEO_PREFIX; nothing else is saved. */
export function isTrainingVideoUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com") && url.pathname.startsWith(`/${VIDEO_PREFIX}`);
  } catch {
    return false;
  }
}
