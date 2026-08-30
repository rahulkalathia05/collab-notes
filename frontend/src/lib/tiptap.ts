/**
 * Central TipTap extension configuration.
 *
 * Two modes:
 *   "solo"   — StarterKit + formatting, JSON content in/out
 *   "collab" — adds Collaboration + CollaborationCursor, Yjs owns document state
 */

import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import StarterKit from '@tiptap/starter-kit';
import { createLowlight, common } from 'lowlight';
import type * as Y from 'yjs';

const lowlight = createLowlight(common);

// ── Base extensions (always included) ────────────────────────────────────────

function _base(placeholder: string) {
  return [
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: null,
      HTMLAttributes: { class: 'code-block' },
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: {
        rel: 'noopener noreferrer',
        target: '_blank',
        class: 'editor-link',
      },
    }),
    Placeholder.configure({ placeholder, showOnlyWhenEditable: true }),
    Typography,
  ];
}

// ── Solo mode ─────────────────────────────────────────────────────────────────

export function createExtensions({ placeholder = 'Start writing…' } = {}) {
  return [
    StarterKit.configure({ codeBlock: false, heading: { levels: [1, 2, 3] } }),
    ..._base(placeholder),
  ];
}

// ── Collaborative mode ────────────────────────────────────────────────────────

export interface CollabExtensionOptions {
  ydoc: Y.Doc;
  provider: { awareness: AwarenessLike };
  user: { name: string; color: string };
  placeholder?: string;
}

interface AwarenessLike {
  on(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;
  states: Map<number, Record<string, unknown>>;
  setLocalStateField(key: string, value: unknown): void;
}

export function createCollabExtensions({
  ydoc,
  provider,
  user,
  placeholder = 'Start writing…',
}: CollabExtensionOptions) {
  return [
    StarterKit.configure({ history: false, codeBlock: false, heading: { levels: [1, 2, 3] } }),

    Collaboration.configure({ document: ydoc }),

    CollaborationCursor.configure({
      provider,
      user,

      /**
       * Render the cursor caret + name label.
       * Uses CSS classes so styles live in globals.css and can be themed.
       * Dynamic color is set via CSS custom property so the single class rule
       * applies to all users.
       */
      render(u: Record<string, unknown>) {
        const color = (u.color as string) ?? '#888';
        const name = (u.name as string) ?? 'Anonymous';

        const caret = document.createElement('span');
        caret.classList.add('collab-cursor__caret');
        caret.style.setProperty('--cursor-color', color);

        const label = document.createElement('span');
        label.classList.add('collab-cursor__label');
        label.textContent = name;

        caret.appendChild(label);
        return caret;
      },

      /**
       * Render the selection highlight for text selected by a remote user.
       * Returns ProseMirror DecorationAttrs — a <span> wrapping the selection.
       */
      selectionRender(u: Record<string, unknown>) {
        const color = (u.color as string) ?? '#888';
        return {
          nodeName: 'span',
          class: 'collab-cursor__selection',
          style: `--cursor-color: ${color}`,
        };
      },
    }),

    ..._base(placeholder),
  ];
}
