import { ServiceError } from "@/server/errors";
import { handleApiError, jsonOk } from "@/server/http";
import { getStudyQueue } from "@/server/study-service";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const modeParam = url.searchParams.get("mode");
    const mode =
      modeParam === "practice"
        ? "practice"
        : modeParam === "unlearned"
          ? "unlearned"
          : "srs";
    const topicIdRaw = url.searchParams.get("topicId");
    const topicId = topicIdRaw ? Number(topicIdRaw) : undefined;
    if (
      topicIdRaw &&
      (!Number.isInteger(topicId) || topicId === undefined || topicId <= 0)
    ) {
      throw new ServiceError("BAD_REQUEST", "잘못된 topicId입니다", 400);
    }
    const keywordIdRaw = url.searchParams.get("keywordId");
    const keywordId = keywordIdRaw ? Number(keywordIdRaw) : undefined;
    if (
      keywordIdRaw &&
      (!Number.isInteger(keywordId) || keywordId === undefined || keywordId <= 0)
    ) {
      throw new ServiceError("BAD_REQUEST", "잘못된 keywordId입니다", 400);
    }

    return jsonOk(await getStudyQueue(mode, topicId, keywordId));
  } catch (e) {
    return handleApiError(e);
  }
}
