import type { StatsOverviewDto, TopicStatsDto } from "@/lib/api-types";
import { prisma } from "./db";

const MASTERED_MIN_INTERVAL_DAYS = 21;

export async function getStatsOverview(): Promise<StatsOverviewDto> {
  const now = new Date();
  const topics = await prisma.topic.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      questions: {
        select: {
          srsState: {
            select: {
              intervalDays: true,
              dueAt: true,
              lastReviewedAt: true,
            },
          },
        },
      },
    },
  });

  const topicStats: TopicStatsDto[] = topics.map((topic) => {
    let unlearned = 0;
    let learning = 0;
    let mastered = 0;
    let dueCount = 0;

    for (const question of topic.questions) {
      const state = question.srsState;
      if (!state || state.lastReviewedAt === null) {
        unlearned += 1;
      } else if (state.intervalDays >= MASTERED_MIN_INTERVAL_DAYS) {
        mastered += 1;
      } else {
        learning += 1;
      }

      if (state && state.dueAt <= now) dueCount += 1;
    }

    return {
      id: topic.id,
      name: topic.name,
      total: topic.questions.length,
      unlearned,
      learning,
      mastered,
      dueCount,
    };
  });

  return {
    dueTotal: topicStats.reduce((sum, topic) => sum + topic.dueCount, 0),
    topics: topicStats,
  };
}
