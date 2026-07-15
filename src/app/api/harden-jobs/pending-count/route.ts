import { countPendingChoiceHardeningJobs } from "@/server/choice-hardening-service";
import { handleApiError, jsonOk } from "@/server/http";

export async function GET() {
  try {
    return jsonOk({ count: await countPendingChoiceHardeningJobs() });
  } catch (error) {
    return handleApiError(error);
  }
}
