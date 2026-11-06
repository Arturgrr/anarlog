export function sessionSearchTimestamp(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}
