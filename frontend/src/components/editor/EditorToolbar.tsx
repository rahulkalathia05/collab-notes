'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Unlink,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface EditorToolbarProps {
  editor: Editor;
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);

  // Focus the link input when it opens
  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus();
  }, [linkOpen]);

  const openLink = useCallback(() => {
    const existing = editor.getAttributes('link').href as string | undefined;
    setLinkUrl(existing ?? '');
    setLinkOpen(true);
  }, [editor]);

  const applyLink = useCallback(() => {
    const trimmed = linkUrl.trim();
    if (!trimmed) {
      editor.chain().focus().unsetLink().run();
    } else {
      const href = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
      editor.chain().focus().setLink({ href }).run();
    }
    setLinkOpen(false);
    setLinkUrl('');
  }, [editor, linkUrl]);

  const cancelLink = useCallback(() => {
    setLinkOpen(false);
    setLinkUrl('');
    editor.chain().focus().run();
  }, [editor]);

  return (
    <div className="border-b bg-background sticky top-0 z-10">
      {/* ── main toolbar row ────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 flex-wrap">
        {/* Text marks */}
        <Group>
          <Btn
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive('bold')}
            title="Bold (⌘B)"
          >
            <Bold className="w-3.5 h-3.5" />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive('italic')}
            title="Italic (⌘I)"
          >
            <Italic className="w-3.5 h-3.5" />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive('strike')}
            title="Strikethrough"
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </Btn>
        </Group>

        <Divider />

        {/* Headings */}
        <Group>
          <Btn
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive('heading', { level: 1 })}
            title="Heading 1"
          >
            <Heading1 className="w-3.5 h-3.5" />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive('heading', { level: 2 })}
            title="Heading 2"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive('heading', { level: 3 })}
            title="Heading 3"
          >
            <Heading3 className="w-3.5 h-3.5" />
          </Btn>
        </Group>

        <Divider />

        {/* Lists */}
        <Group>
          <Btn
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive('bulletList')}
            title="Bullet list (- )"
          >
            <List className="w-3.5 h-3.5" />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive('orderedList')}
            title="Numbered list (1. )"
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </Btn>
        </Group>

        <Divider />

        {/* Code */}
        <Group>
          <Btn
            onClick={() => editor.chain().focus().toggleCode().run()}
            active={editor.isActive('code')}
            title="Inline code (⌘E)"
          >
            <Code className="w-3.5 h-3.5" />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            active={editor.isActive('codeBlock')}
            title="Code block (```)"
          >
            <Code2 className="w-3.5 h-3.5" />
          </Btn>
        </Group>

        <Divider />

        {/* Block elements */}
        <Group>
          <Btn
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive('blockquote')}
            title="Blockquote (> )"
          >
            <Quote className="w-3.5 h-3.5" />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            active={false}
            title="Divider (---)"
          >
            <Minus className="w-3.5 h-3.5" />
          </Btn>
        </Group>

        <Divider />

        {/* Link */}
        <Group>
          {editor.isActive('link') ? (
            <>
              <Btn onClick={openLink} active title="Edit link">
                <Link2 className="w-3.5 h-3.5" />
              </Btn>
              <Btn
                onClick={() => editor.chain().focus().unsetLink().run()}
                active={false}
                title="Remove link"
              >
                <Unlink className="w-3.5 h-3.5" />
              </Btn>
            </>
          ) : (
            <Btn
              onClick={openLink}
              active={false}
              disabled={editor.state.selection.empty && !editor.isActive('link')}
              title="Add link — select text first"
            >
              <Link2 className="w-3.5 h-3.5" />
            </Btn>
          )}
        </Group>
      </div>

      {/* ── link input row ────────────────────────────────────────────── */}
      {linkOpen && (
        <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30">
          <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            ref={linkInputRef}
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') cancelLink();
            }}
            placeholder="https://example.com"
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50"
          />
          <button
            type="button"
            onClick={applyLink}
            className="text-xs text-primary font-medium hover:opacity-80 shrink-0"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={cancelLink}
            className="text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center">{children}</div>;
}

function Divider() {
  return <div className="w-px h-4 bg-border mx-1 shrink-0" />;
}

function Btn({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Prevent the editor losing focus when toolbar is clicked
        e.preventDefault();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      title={title}
      className={cn(
        'p-1.5 rounded transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        disabled && 'opacity-30 pointer-events-none',
      )}
    >
      {children}
    </button>
  );
}
