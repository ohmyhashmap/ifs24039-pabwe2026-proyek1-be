export async function collectPages<T>(
  loadPage: (offset: number) => Promise<readonly T[]>,
  pageSize: number
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('pageSize harus berupa bilangan bulat positif');
  }

  const items: T[] = [];
  const collectPage = async (offset: number): Promise<void> => {
    const page = await loadPage(offset);
    items.push(...page);
    if (page.length === pageSize) await collectPage(offset + pageSize);
  };

  await collectPage(0);
  return items;
}
