import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAdmin } from "@/lib/auth";
import { VIDEO_MAX_BYTES, VIDEO_PREFIX, VIDEO_TYPES } from "@/lib/training";

// Hands the browser a short-lived token to send a training video straight to
// Vercel Blob (videos are far over the 4.5 MB function body limit). Outside the
// /admin proxy matcher, so requireAdmin() here is the gate. The row is saved by
// addTrainingVideo once the upload finishes, so no completion webhook is needed.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        await requireAdmin();
        if (!pathname.startsWith(VIDEO_PREFIX)) throw new Error("Caminho inválido.");
        return { allowedContentTypes: VIDEO_TYPES, maximumSizeInBytes: VIDEO_MAX_BYTES, addRandomSuffix: true };
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Não foi possível enviar o vídeo." }, { status: 400 });
  }
}
