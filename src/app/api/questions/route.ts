import { ServiceError } from "@/server/errors";
import { handleApiError, jsonOk } from "@/server/http";
import { listQuestions } from "@/server/question-service";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const topicIdRaw = url.searchParams.get("topicId");
    const topicId = topicIdRaw ? Number(topicIdRaw) : undefined;
    if (
      topicIdRaw &&
      (!Number.isInteger(topicId) || topicId === undefined || topicId <= 0)
    ) {
      throw new ServiceError("BAD_REQUEST", "잘못된 topicId입니다", 400);
    }
    return jsonOk(await listQuestions(topicId));
  } catch (e) {
    return handleApiError(e);
  }
}
