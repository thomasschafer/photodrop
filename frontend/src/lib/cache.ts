// Cache naming convention (defined in sw.ts):
// - photodrop:group:* = group-scoped (cleared on group switch)
// - photodrop:user:* = user-scoped (cleared on logout along with group caches)

async function deleteCachesMatching(prefix: string): Promise<void> {
  if (!('caches' in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith(prefix)).map((key) => caches.delete(key))
    );
  } catch (error) {
    console.error('Failed to clear caches:', error);
  }
}

export async function clearGroupCaches(): Promise<void> {
  await deleteCachesMatching('photodrop:group:');
}

export async function clearAllUserCaches(): Promise<void> {
  await deleteCachesMatching('photodrop:');
}
