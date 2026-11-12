'use client';

import { Button, cn, Input } from '@nova/ui';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { AlertCircle, Bold, Heading2, Heading3, Italic, Link2, Link2Off, List, ListOrdered, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { sanitizeRichText } from '@/shared/lib/sanitize';
import { safeHref } from '../lib/sanitize-html';
import { RICH_TEXT_CLASS } from './RichText';

interface RichTextEditorProps {
  label: ReactNode;
  /** HTML já sanitizado. */
  value: string;
  onChange: (html: string) => void;
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  /** Altura mínima da área de texto. */
  size?: 'md' | 'lg';
}

function ToolbarButton({ icon: Icon, label, pressed, disabled, onClick }: { icon: LucideIcon; label: string; pressed?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      // Não tira a seleção do texto ao clicar no botão.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50 md:size-9',
        pressed && 'bg-accent-soft text-accent-soft-text hover:bg-accent-soft hover:text-accent-soft-text',
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function normalizeLink(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return null;
  return safeHref(text) ?? (/^[\w-]+(\.[\w-]+)+/.test(text) ? safeHref(`https://${text}`) : null);
}

function Toolbar({ editor, label, disabled }: { editor: Editor; label: string; disabled?: boolean }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | undefined>();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      link: e.isActive('link'),
      href: (e.getAttributes('link').href as string | undefined) ?? '',
    }),
  });

  function applyLink() {
    const href = normalizeLink(linkUrl);
    if (!href) {
      setLinkError('Informe um endereço começando com https://');
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty && !editor.isActive('link')) {
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      chain.setLink({ href }).run();
    }
    setLinkOpen(false);
  }

  return (
    <div className="border-b border-border bg-surface-2">
      <div role="toolbar" aria-label={`Formatação de ${label}`} className="flex flex-wrap gap-0.5 p-1">
        <ToolbarButton icon={Bold} label="Negrito" pressed={state.bold} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolbarButton icon={Italic} label="Itálico" pressed={state.italic} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolbarButton icon={Heading2} label="Título" pressed={state.h2} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolbarButton icon={Heading3} label="Subtítulo" pressed={state.h3} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <ToolbarButton icon={List} label="Lista com marcadores" pressed={state.bullet} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolbarButton icon={ListOrdered} label="Lista numerada" pressed={state.ordered} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolbarButton
          icon={Link2}
          label="Link"
          pressed={state.link || linkOpen}
          disabled={disabled}
          onClick={() => {
            setLinkUrl(state.href);
            setLinkError(undefined);
            setLinkOpen((open) => !open);
          }}
        />
        {state.link && <ToolbarButton icon={Link2Off} label="Remover link" disabled={disabled} onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()} />}
      </div>
      {linkOpen && (
        <div className="flex flex-wrap items-start gap-2 border-t border-border p-2">
          <Input
            className="min-w-0 flex-1 basis-56"
            label="Endereço do link"
            hideLabel
            type="url"
            inputMode="url"
            placeholder="https://"
            autoFocus
            value={linkUrl}
            error={linkError}
            onChange={(e) => {
              setLinkUrl(e.target.value);
              setLinkError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              }
              if (e.key === 'Escape') setLinkOpen(false);
            }}
          />
          <Button size="sm" onClick={applyLink}>
            Aplicar link
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>
            Cancelar
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Editor de rich-text (Tiptap) da descrição e do regulamento: negrito, itálico, títulos, listas e link.
 * O HTML sai sempre pela lista de tags permitidas (`sanitizeRichText`); a API limpa de novo ao gravar.
 */
export function RichTextEditor({ label, value, onChange, hint, error, disabled, size = 'md' }: RichTextEditorProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  // Último HTML que saiu deste editor: serve para distinguir "a pessoa digitou" de "o valor mudou por fora".
  const emitted = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'], HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      }),
    ],
    content: value,
    editable: !disabled,
    // O app é renderizado no servidor: o editor só nasce no navegador.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelId,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        class: cn(RICH_TEXT_CLASS, 'px-3 py-2 outline-none', size === 'lg' ? 'min-h-72' : 'min-h-36'),
      },
    },
    onUpdate: ({ editor: e }) => {
      // O próprio editor ajusta o documento ao abrir (ex.: cria um parágrafo depois de uma lista).
      // Isso não é edição de ninguém: só o que acontece com o foco no editor vira alteração.
      if (!e.isFocused) return;
      const html = e.isEmpty ? '' : sanitizeRichText(e.getHTML()).replace(/(?:<p><\/p>)+$/, '');
      if (html === emitted.current) return;
      emitted.current = html;
      onChangeRef.current(html);
    },
  });

  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const labelText = typeof label === 'string' ? label : 'texto';
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium text-text">
        {label}
      </span>
      <div className={cn('overflow-hidden rounded-md border bg-surface focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent', error ? 'border-danger' : 'border-border-strong')}>
        {editor ? <Toolbar editor={editor} label={labelText} disabled={disabled} /> : <div className="h-11 border-b border-border bg-surface-2 md:h-11" aria-hidden />}
        <EditorContent editor={editor} className={cn(!editor && (size === 'lg' ? 'min-h-72' : 'min-h-36'))} />
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1 text-xs font-medium text-danger">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
