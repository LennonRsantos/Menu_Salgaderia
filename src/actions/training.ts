"use server";

import { del } from "@vercel/blob";
import { z } from "zod";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { iso, query } from "@/lib/db";
import { canSeeModule, isTrainingVideoUrl, TRAINING_MODULES, type TrainingModule } from "@/lib/training";

export interface TrainingVideo {
  id: string;
  module: TrainingModule;
  title: string;
  description: string;
  video_url: string;
  created_at: string;
  /** The signed-in person marked it as concluído. */
  done: boolean;
}

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Dados inválidos." };
  return { ok: false, error: e instanceof Error ? e.message : "Erro inesperado." };
};

type Row = Omit<TrainingVideo, "created_at"> & { created_at: Date };

export async function listTrainingVideos(): Promise<Result<TrainingVideo[]>> {
  try {
    const profile = await requireStaff();
    const rows = await query<Row>(
      `select v.id, v.module, v.title, v.description, v.video_url, v.created_at, (p.video_id is not null) as done
         from training_videos v
         left join training_progress p on p.video_id = v.id and p.user_id = $1
        order by v.position, v.created_at`,
      [profile.id],
    );
    const data = rows.filter((r) => canSeeModule(r.module, profile.role)).map((r) => ({ ...r, created_at: iso(r.created_at) ?? "" }));
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

const videoSchema = z.object({
  module: z.string().refine((m) => (TRAINING_MODULES as readonly string[]).includes(m), "Escolha o módulo."),
  title: z.string().trim().min(1, "Dê um título ao vídeo.").max(120, "Título com no máximo 120 letras."),
  description: z.string().trim().max(1000, "Descrição com no máximo 1000 letras."),
  video_url: z.string().refine(isTrainingVideoUrl, "Vídeo inválido. Envie o arquivo de novo."),
});

export async function addTrainingVideo(input: z.input<typeof videoSchema>): Promise<Result> {
  try {
    await requireAdmin();
    const v = videoSchema.parse(input);
    await query("insert into training_videos (module, title, description, video_url) values ($1, $2, $3, $4)", [
      v.module,
      v.title,
      v.description,
      v.video_url,
    ]);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

/** Marks (or unmarks) a video as concluído for the signed-in person. */
export async function setVideoDone(id: string, done: boolean): Promise<Result> {
  try {
    const profile = await requireStaff();
    const videoId = z.uuid().parse(id);
    const [video] = await query<{ module: string }>("select module from training_videos where id = $1", [videoId]);
    if (!video || !canSeeModule(video.module, profile.role)) throw new Error("Vídeo não encontrado.");
    if (done) {
      await query("insert into training_progress (user_id, video_id) values ($1, $2) on conflict do nothing", [profile.id, videoId]);
    } else {
      await query("delete from training_progress where user_id = $1 and video_id = $2", [profile.id, videoId]);
    }
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTrainingVideo(id: string): Promise<Result> {
  try {
    await requireAdmin();
    const [row] = await query<{ video_url: string }>("delete from training_videos where id = $1 returning video_url", [z.uuid().parse(id)]);
    if (row) await del(row.video_url).catch(() => {}); // row is gone either way; a leftover file only costs storage
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}
