import { ServiceError } from "@/server/errors";
import { handleApiError, jsonOk } from "@/server/http";
import { listQuestions } from "@/server/question-service";
import type {
  QuestionListSortDto,
  QuestionTypeDto,
} from "@/lib/api-types";

const questionTypes = new Set<QuestionTypeDto>(["MCQ", "CLOZE"]);
const questionSorts = new Set<QuestionListSortDto>([
  "latest",
  "accuracyAsc",
  "accuracyDesc",
]);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const topicIdRaw = url.searchParams.get("topicId");
    const typeRaw = url.searchParams.get("type");
    const sortRaw = url.searchParams.get("sort");
    const pageRaw = url.searchParams.get("page");
    const topicId = topicIdRaw ? Number(topicIdRaw) : undefined;
    if (
      topicIdRaw &&
      (!Number.isInteger(topicId) || topicId === undefined || topicId <= 0)
    ) {
      throw new ServiceError("BAD_REQUEST", "잘못된 topicId입니다", 400);
    }
    if (typeRaw && !questionTypes.has(typeRaw as QuestionTypeDto)) {
      throw new ServiceError("BAD_REQUEST", "잘못된 type입니다", 400);
    }
    if (sortRaw && !questionSorts.has(sortRaw as QuestionListSortDto)) {
      throw new ServiceError("BAD_REQUEST", "잘못된 sort입니다", 400);
    }

    const page = pageRaw ? Number(pageRaw) : undefined;
    return jsonOk(
      await listQuestions({
        topicId,
        type: typeRaw ? (typeRaw as QuestionTypeDto) : undefined,
        sort: sortRaw ? (sortRaw as QuestionListSortDto) : undefined,
        page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1,
      }),
    );
  } catch (e) {
    return handleApiError(e);
  }
}
