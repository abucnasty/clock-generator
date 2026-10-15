/**
 * Whether an element is at least partly under a sticky header whose bottom edge is at `headerBottom`: it is still in
 * the window (an element scrolled out above it has nothing to bring back), and its top is above that edge.
 */
export function isUnderHeader(rect: { top: number; bottom: number }, headerBottom: number): boolean {
    return rect.bottom > 0 && rect.top < headerBottom;
}
