import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

function readVariableBlock(selector: string): Map<string, string> {
  const blockStart = css.indexOf(`${selector} {`);
  if (blockStart < 0) throw new Error(`Missing ${selector} colour block.`);
  const declarationStart = css.indexOf('{', blockStart) + 1;
  const declarationEnd = css.indexOf('}', declarationStart);
  const declarations = css.slice(declarationStart, declarationEnd);
  return new Map(
    [...declarations.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((match) => [
      match[1],
      match[2].trim(),
    ])
  );
}

const variables = new Map([...readVariableBlock(':root'), ...readVariableBlock('.league-social')]);

function resolveHex(variable: string, visited = new Set<string>()): string {
  if (visited.has(variable)) throw new Error(`Circular colour token: ${variable}`);
  const value = variables.get(variable);
  if (!value) throw new Error(`Missing colour token: ${variable}`);
  const reference = value.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (reference) {
    visited.add(variable);
    return resolveHex(reference[1], visited);
  }
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${[...value.slice(1)].map((character) => character.repeat(2)).join('')}`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${variable} does not resolve to a six-digit hex colour: ${value}`);
  }
  return value;
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`Invalid colour: ${hex}`);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(resolveHex(foreground));
  const backgroundLuminance = relativeLuminance(resolveHex(background));
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

describe('League Social colour system', () => {
  it.each([
    ['primary text', '--social-text', '--social-surface', 4.5],
    ['secondary text', '--social-text-muted', '--social-surface', 4.5],
    ['action label', '--social-action-foreground', '--social-action', 4.5],
    ['header title', '--social-brand-foreground', '--social-brand-strong', 4.5],
    ['header metadata', '--social-header-muted', '--social-brand-strong', 4.5],
    ['disabled label', '--social-disabled-text', '--social-disabled-bg', 4.5],
    ['success feedback', '--social-success', '--social-success-soft', 4.5],
    ['warning feedback', '--social-warning-text', '--social-warning-soft', 4.5],
    ['error feedback', '--social-error', '--social-error-soft', 4.5],
    ['error action label', '--social-error-foreground', '--social-error', 4.5],
    ['mention label', '--social-mention-text', '--social-mention-bg', 4.5],
    ['focus indicator', '--social-focus', '--social-surface', 3],
  ])('%s meets its WCAG contrast target', (_label, foreground, background, minimum) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });

  it('defines distinct resting, hover, pressed, disabled, loading, and error roles', () => {
    const requiredTokens = [
      '--social-action',
      '--social-action-hover',
      '--social-action-pressed',
      '--social-disabled-bg',
      '--social-disabled-text',
      '--social-focus',
      '--social-error',
      '--social-error-foreground',
      '--social-error-soft',
    ];

    requiredTokens.forEach((token) => expect(variables.has(token), token).toBe(true));
    expect(resolveHex('--social-action-hover')).not.toBe(resolveHex('--social-action'));
    expect(resolveHex('--social-action-pressed')).not.toBe(resolveHex('--social-action-hover'));
    expect(resolveHex('--social-disabled-bg')).not.toBe(resolveHex('--social-action'));
  });
});
