export async function runWorkerTask(
  name: string,
  task: Promise<unknown>
): Promise<void> {
  try {
    await task;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.replace(/[\r\n]/g, ' ')
        : 'Unknown error';
    console.error(`[CRON ${name}] Gagal menjalankan tugas: ${message}`);
  }
}
