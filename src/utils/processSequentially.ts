export async function processSequentially<T>(
  items: readonly T[],
  processItem: (item: T, index: number) => Promise<void>
): Promise<void> {
  const processAt = async (index: number): Promise<void> => {
    if (index >= items.length) return;
    await processItem(items[index]!, index);
    await processAt(index + 1);
  };

  await processAt(0);
}
