import type { Frame, Page } from 'playwright-core';

export interface FrameInfo {
  index: number;
  name: string;
  url: string;
  isMain: boolean;
}

export interface FrameLike {
  name(): string;
  url(): string;
}

export function describeFrames(page: Page): FrameInfo[] {
  const main = page.mainFrame();
  return page.frames().map((frame, index) => ({
    index,
    name: frame.name(),
    url: frame.url(),
    isMain: frame === main,
  }));
}

function renderAvailable(frames: FrameLike[]): string {
  return frames
    .map((frame, index) => `[${index}] name="${frame.name()}" url=${frame.url()}`)
    .join('\n');
}

export function selectFrame<T extends FrameLike>(frames: T[], spec: string): T {
  const raw = spec.trim();
  if (!raw) throw new Error('Frame spec is empty');

  if (/^\d+$/.test(raw)) {
    const index = parseInt(raw, 10);
    if (index >= frames.length) {
      throw new Error(
        `Frame index ${index} is out of range (${frames.length} frame(s)).\n${renderAvailable(frames)}`
      );
    }
    return frames[index];
  }

  const byName = frames.filter(frame => frame.name() === raw);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new Error(`Frame name "${raw}" is ambiguous.\n${renderAvailable(byName)}`);
  }

  const byUrl = frames.filter(frame => frame.url().includes(raw));
  if (byUrl.length === 1) return byUrl[0];
  if (byUrl.length > 1) {
    throw new Error(`Frame spec "${raw}" matches multiple frames.\n${renderAvailable(byUrl)}`);
  }

  throw new Error(`No frame matches "${raw}".\n${renderAvailable(frames)}`);
}

export function resolveFrame(page: Page, spec?: string): Frame {
  if (spec === undefined) return page.mainFrame();
  return selectFrame(page.frames(), spec);
}

export function formatFrames(frames: FrameInfo[]): string {
  return frames
    .map(frame => {
      const marker = frame.isMain ? ' (main)' : '';
      const name = frame.name ? ` name="${frame.name}"` : '';
      return `[${frame.index}]${marker}${name} ${frame.url}`;
    })
    .join('\n');
}
