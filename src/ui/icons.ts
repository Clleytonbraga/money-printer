const svg = (w: number, body: string, stroke = 'currentColor', sw = 1.5) =>
  `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  wallet: svg(20, '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H17a2 2 0 0 1 2 2v1"/><path d="M3 7.5V17a2.5 2.5 0 0 0 2.5 2.5H19a2 2 0 0 0 2-2v-7.5a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 1 3 7.5Z"/><path d="M16.5 13.75h.01"/>'),
  sound: svg(20, '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  soundSmall: svg(16, '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>'),
  music: svg(16, '<path d="M9 18V6l10-2v12"/><path d="M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"/><path d="M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"/>'),
  close: svg(14, '<path d="M5 5l14 14M19 5L5 19"/>'),
  camera: (size = 40) => svg(size, '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.3-2h6l1.3 2h1.2A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8Z"/><path d="M12 15.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z"/>', 'currentColor', size < 20 ? 2 : 1.5),
  chevron: '<svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1l5 5-5 5"/></svg>',
};

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
