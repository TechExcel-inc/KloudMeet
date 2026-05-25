/** Prisma 无法连库 / 未配置 DATABASE_URL 时用于降级，避免整页 500 */
export function isPrismaConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name: string }).name) : '';
  const message = 'message' in error ? String((error as { message: string }).message) : '';
  return (
    name === 'PrismaClientInitializationError' ||
    message.includes("Can't reach database server") ||
    message.includes('Environment variable not found: DATABASE_URL') ||
    message.includes('Error validating datasource') ||
    message.includes('Connection refused') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ETIMEDOUT')
  );
}
