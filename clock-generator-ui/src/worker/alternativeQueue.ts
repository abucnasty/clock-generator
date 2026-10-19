import type { ClockAlternativeTask } from 'clock-generator/browser';

const SLOW_TASKS = ['full-hand', 'uneven-output', 'derived', 'fractional'];

/**
 * Try the one-swing candidate early so a checked clock can be offered while the other candidates finish.
 * Remaining expensive tasks start next, preserving their overlap without changing the worker count.
 * This changes execution order only; display order, search eligibility and final ranking stay separate.
 */
export function orderAlternativeTasks(tasks: readonly ClockAlternativeTask[]): ClockAlternativeTask[] {
    const priority = (task: ClockAlternativeTask) => task.id === 'swings-1' ? 0 : SLOW_TASKS.includes(task.id) ? 1 : 2;
    return [...tasks].sort((a, b) => priority(a) - priority(b));
}
