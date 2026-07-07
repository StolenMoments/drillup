import type { TopicDto } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";

const withCount = { _count: { select: { questions: true } } } as const;

function toDto(topic: {
  id: number;
  name: string;
  description: string | null;
  _count: { questions: number };
}): TopicDto {
  return {
    id: topic.id,
    name: topic.name,
    description: topic.description,
    questionCount: topic._count.questions,
  };
}

export async function listTopics(): Promise<TopicDto[]> {
  const topics = await prisma.topic.findMany({
    include: withCount,
    orderBy: { name: "asc" },
  });
  return topics.map(toDto);
}

export async function createTopic(input: {
  name: string;
  description?: string;
}): Promise<TopicDto> {
  const existing = await prisma.topic.findUnique({
    where: { name: input.name },
  });
  if (existing) {
    throw new ServiceError("DUPLICATE", "이미 존재하는 주제 이름입니다", 409);
  }

  const topic = await prisma.topic.create({
    data: { name: input.name, description: input.description ?? null },
    include: withCount,
  });
  return toDto(topic);
}

export async function updateTopic(
  id: number,
  input: { name?: string; description?: string },
): Promise<TopicDto> {
  const existing = await prisma.topic.findUnique({ where: { id } });
  if (!existing) {
    throw new ServiceError("NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }

  if (input.name && input.name !== existing.name) {
    const duplicate = await prisma.topic.findUnique({
      where: { name: input.name },
    });
    if (duplicate) {
      throw new ServiceError("DUPLICATE", "이미 존재하는 주제 이름입니다", 409);
    }
  }

  const topic = await prisma.topic.update({
    where: { id },
    data: input,
    include: withCount,
  });
  return toDto(topic);
}

export async function deleteTopic(id: number): Promise<void> {
  const existing = await prisma.topic.findUnique({ where: { id } });
  if (!existing) {
    throw new ServiceError("NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }
  await prisma.topic.delete({ where: { id } });
}
