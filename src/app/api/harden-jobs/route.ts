import { listChoiceHardeningJobs } from "@/server/choice-hardening-service";
import { handleApiError, jsonOk } from "@/server/http";

export async function GET() {
  try {
    return jsonOk(await listChoiceHardeningJobs());
  } catch (error) {
    return handleApiError(error);
  }
}
