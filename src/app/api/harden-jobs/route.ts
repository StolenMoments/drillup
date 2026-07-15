import { isChoiceHardeningListStatus } from "@/lib/choice-hardening-status";
import {
  getChoiceHardeningJobPage,
  getChoiceHardeningJobSummary,
} from "@/server/choice-hardening-service";
import { ServiceError } from "@/server/errors";
import { handleApiError, jsonOk } from "@/server/http";

function parsePage(raw: string | null): number {
  const page = Number(raw);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const rawStatus = searchParams.get("status");
    if (rawStatus === null) {
      return jsonOk(await getChoiceHardeningJobSummary());
    }
    if (!isChoiceHardeningListStatus(rawStatus)) {
      throw new ServiceError(
        "VALIDATION",
        "잘못된 선지 검토 상태입니다",
        400,
      );
    }
    return jsonOk(
      await getChoiceHardeningJobPage(
        rawStatus,
        parsePage(searchParams.get("page")),
      ),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
