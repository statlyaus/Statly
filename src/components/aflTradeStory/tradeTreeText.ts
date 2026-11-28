import { formatPav } from './tradePageModel';
import type { TreeLane } from './tradeTreeModel';

/**
 * The trade tree's words: what happened to a lane, its value, and how much room a label takes in the
 * chart (Geist is about 0.58em a letter bold and 0.52em regular). Shared by the desktop chart, the
 * phone tree and the screen-reader list.
 */

export const textWidth = (text: string, bold = false, size = 14) =>
  text.length * size * (bold ? 0.58 : 0.52);

/** The text, cut short with an ellipsis where it would run past `room`. */
export function clip(text: string, room: number, bold = false, size = 14): string {
  if (textWidth(text, bold, size) <= room) return text;
  return `${text.slice(0, Math.max(1, Math.floor(room / (size * (bold ? 0.58 : 0.52))) - 1))}…`;
}

/** The text in lines no wider than `room`; a "·" stays at the end of the line before the break. */
export function wrap(text: string, room: number, size: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.replaceAll(' · ', ' · ').split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, false, size) > room) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  return line ? [...lines, line] : lines;
}

/** What happened to a lane, in words, for the list and the chart's labels. */
export function pathText(lane: TreeLane): string {
  const steps: string[] = [];
  if (lane.via) steps.push(`came ${lane.via}`);
  if (lane.onward) steps.push(`traded to ${lane.onward.clubNames.join(', then ')}`);
  if (lane.drafted?.selection) steps.push(`drafted at ${lane.drafted.selection}`);
  if (lane.endReason === 'not_used') steps.push('not used');
  if (lane.endReason === 'closed') steps.push('stint ended');
  return steps.join(' · ');
}

/** A lane's PAV, or "not in yet" as the rest of the trade page says it. */
export function valueText(lane: TreeLane): string {
  return lane.value === null ? 'not in yet' : formatPav(lane.value);
}
