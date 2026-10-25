import { describe, expect, it, spyOn } from 'bun:test';
import { runWorkerTask } from './runWorkerTask';

describe('runWorkerTask', () => {
  it('waits for successful tasks', async () => {
    await expect(
      runWorkerTask('NASA', Promise.resolve())
    ).resolves.toBeUndefined();
  });

  it('handles failed tasks and sanitizes line breaks in log output', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runWorkerTask(
        'NASA',
        Promise.reject(new Error('first line\nforged log'))
      );
      expect(errorSpy).toHaveBeenCalledWith(
        '[CRON NASA] Gagal menjalankan tugas: first line forged log'
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
