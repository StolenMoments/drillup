import { handleApiError, jsonOk } from "@/server/http";
import { getStatsOverview } from "@/server/stats-service";

export async function GET() {
  try {
    return jsonOk(await getStatsOverview());
  } catch (e) {
    return handleApiError(e);
  }
}
