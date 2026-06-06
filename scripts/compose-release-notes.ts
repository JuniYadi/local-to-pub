import { readFileSync } from "node:fs";

export function combineReleaseNotes(generatedNotes: string, checksumNotes: string): string {
  const notes = generatedNotes.trim();
  const checksums = checksumNotes.trim();

  if (!notes) return checksums;
  if (!checksums) return notes;

  return `${notes}\n\n---\n\n${checksums}`;
}

if (import.meta.main) {
  const [generatedNotesPath, checksumNotesPath] = Bun.argv.slice(2);

  if (!generatedNotesPath || !checksumNotesPath) {
    console.error("Usage: bun run scripts/compose-release-notes.ts <generated-notes.md> <checksums.md>");
    process.exit(1);
  }

  const generatedNotes = readFileSync(generatedNotesPath, "utf8");
  const checksumNotes = readFileSync(checksumNotesPath, "utf8");

  process.stdout.write(combineReleaseNotes(generatedNotes, checksumNotes));
}
