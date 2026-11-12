import { create } from "zustand";

/** Traitement en cours, affiché dans l'indicateur d'activité. */
export interface Task {
  id: string;
  label: string;
  detail?: string;
  done?: number;
  total?: number;
  startedAt: number;
}

interface ActivityState {
  tasks: Task[];
}

export const useActivity = create<ActivityState>()(() => ({ tasks: [] }));

let seq = 0;

export interface TaskHandle {
  update(patch: Partial<Omit<Task, "id" | "startedAt">>): void;
  /** Avance d'une unité (sources chargées, listes vérifiées…). */
  step(detail?: string): void;
  end(): void;
}

export function startTask(label: string, init: Partial<Omit<Task, "id" | "label" | "startedAt">> = {}): TaskHandle {
  const id = `t${++seq}`;
  useActivity.setState((s) => ({ tasks: [...s.tasks, { id, label, startedAt: Date.now(), ...init }] }));
  const patchTask = (fn: (t: Task) => Task) => useActivity.setState((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? fn(t) : t)) }));
  return {
    update: (patch) => patchTask((t) => ({ ...t, ...patch })),
    step: (detail) => patchTask((t) => ({ ...t, done: (t.done ?? 0) + 1, detail: detail ?? t.detail })),
    end: () => useActivity.setState((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  };
}

/** Suit une promesse le temps de son exécution. */
export async function track<T>(label: string, work: Promise<T> | (() => Promise<T>), detail?: string): Promise<T> {
  const task = startTask(label, { detail });
  try {
    return await (typeof work === "function" ? work() : work);
  } finally {
    task.end();
  }
}
