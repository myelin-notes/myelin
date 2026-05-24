type ShutdownTask = () => Promise<void> | void;

const shutdownTasks = new Set<ShutdownTask>();

export function registerShutdownTask(task: ShutdownTask): () => void {
  shutdownTasks.add(task);
  return () => {
    shutdownTasks.delete(task);
  };
}

export async function runShutdownTasks(): Promise<
  PromiseSettledResult<void>[]
> {
  const tasks = Array.from(shutdownTasks);
  return Promise.allSettled(tasks.map(async (task) => task()));
}
