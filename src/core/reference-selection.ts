export const AIP_C01_REQUIRED_REFERENCES: readonly string[] = [
  "common/00-exam-guide.md",
  "common/01-style-examples.md",
];

const AIP_C01_REQUIRED_REFERENCE_SET = new Set(
  AIP_C01_REQUIRED_REFERENCES,
);

export function isRequiredReferenceFile(
  referenceDir: string | null,
  filePath: string,
): boolean {
  return (
    referenceDir === "aip-c01" &&
    AIP_C01_REQUIRED_REFERENCE_SET.has(filePath)
  );
}

export function getDefaultReferenceFiles(input: {
  referenceDir: string | null;
  topicName: string;
  availableFiles: Iterable<string>;
}): Set<string> {
  const availableFiles = [...input.availableFiles];
  if (input.referenceDir !== "aip-c01") return new Set(availableFiles);

  const domain = input.topicName.match(/\bAIP-C01\s+D([1-5])\b/i)?.[1];
  if (!domain) return new Set(availableFiles);

  const domainPrefix = `d${domain}/`;
  return new Set(
    availableFiles.filter(
      (file) =>
        AIP_C01_REQUIRED_REFERENCE_SET.has(file) ||
        file.startsWith(domainPrefix),
    ),
  );
}
