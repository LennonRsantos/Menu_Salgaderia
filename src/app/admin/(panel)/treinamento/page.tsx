import type { Metadata } from "next";
import { TrainingPage } from "@/components/admin/training-page";

export const metadata: Metadata = { title: "Treinamento" };
// Rendered only after the client confirms the staff session (see PanelShell).
export const instant = false;

export default function TrainingRoute() {
  return <TrainingPage />;
}
