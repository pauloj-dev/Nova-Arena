'use client';

import type { Game, ScoringModel } from '@nova/schemas';
import { Badge, Button, Card, Checkbox, EmptyState, Modal, useToast } from '@nova/ui';
import { AlertCircle, Calculator, Copy, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { MATCH_TYPE_LABELS, scoreLabelForGame } from '@/features/scoring/describe';
import { newDraft } from '@/features/scoring/rules';
import { ScoringModelEditor, ScoringPreview, type ScoringDraft } from '@/features/scoring/ScoringModelEditor';
import { normalizeTiebreakers, tiebreakerLabel } from '@/features/scoring/tiebreakers';
import { fieldErrorsToMessages, validateDraft } from '@/features/scoring/validation';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useCreateScoringModel, useDeleteScoringModel, useDuplicateScoringModel, useUpdateScoringModel } from '@/shared/api/hooks/games-admin';
import { useT } from '@/shared/i18n/react';
import { adminGamesMessages } from './messages';

interface EditorState {
  /** Nulo = modelo novo. */
  modelId: string | null;
  draft: ScoringDraft;
  isDefault: boolean;
  errors: string[];
}

function hasDefault(game: Game, matchType: ScoringModel['matchType'], exceptId?: string): boolean {
  return game.scoringModels.some((m) => m.isDefault && m.ownerId === null && m.matchType === matchType && m.id !== exceptId);
}

/** Seção "Modelos de pontuação" da página do jogo: cartões com resumo e prévia, e o editor em modal. */
export function ScoringModelsSection({ game }: { game: Game }) {
  const t = useT(adminGamesMessages, 'ScoringModelsSection');
  const toast = useToast();
  const create = useCreateScoringModel(game.id);
  const update = useUpdateScoringModel(game.id);
  const remove = useDeleteScoringModel(game.id);
  const duplicate = useDuplicateScoringModel(game.id);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<{ model: ScoringModel; error: string | null } | null>(null);

  const scoreLabel = scoreLabelForGame(game.slug);
  // Só os modelos do catálogo: os personalizados de organizador são editados no campeonato.
  const models = game.scoringModels.filter((m) => m.ownerId === null);
  const saving = create.isPending || update.isPending;

  function tiebreakText(model: ScoringModel): string {
    return model.tiebreakers.map((tb) => tiebreakerLabel(tb, { matchType: model.matchType, scoreLabel })).join(' → ');
  }

  function openNew() {
    const matchType = game.modes[0]?.matchType ?? 'BATTLE_ROYALE';
    setEditor({ modelId: null, draft: newDraft(matchType), isDefault: !hasDefault(game, matchType), errors: [] });
  }
  function openEdit(model: ScoringModel) {
    const draft: ScoringDraft = { name: model.name, matchType: model.matchType, rules: model.rules, tiebreakers: model.tiebreakers };
    setEditor({ modelId: model.id, draft, isDefault: model.isDefault, errors: [] });
  }

  function save() {
    if (!editor) return;
    const draft: ScoringDraft = { ...editor.draft, name: editor.draft.name.trim(), tiebreakers: normalizeTiebreakers(editor.draft.tiebreakers) };
    const problems = validateDraft(draft);
    if (problems.length > 0) {
      setEditor({ ...editor, errors: problems });
      toast.error(t('toastConfira'), problems[0]);
      return;
    }
    const input = { ...draft, isDefault: editor.isDefault };
    const options = {
      onSuccess: (model: ScoringModel) => {
        setEditor(null);
        toast.success(editor.modelId ? t('toastAtualizado') : t('toastCriado'), model.name);
      },
      onError: (error: unknown) => {
        const fromApi = error instanceof ApiError ? fieldErrorsToMessages(error.fieldErrors) : [];
        setEditor((current) => (current ? { ...current, errors: fromApi.length > 0 ? fromApi : [errorMessage(error)] } : current));
        toast.error(t('toastErroSalvar'), errorMessage(error));
      },
    };
    if (editor.modelId) update.mutate({ modelId: editor.modelId, patch: input }, options);
    else create.mutate(input, options);
  }

  function makeDefault(model: ScoringModel) {
    update.mutate(
      { modelId: model.id, patch: { isDefault: true } },
      {
        onSuccess: () => toast.success(t('toastPadrao'), t('toastPadraoDetalhe', { nome: model.name, tipo: MATCH_TYPE_LABELS[model.matchType] })),
        onError: (error) => toast.error(t('toastErroPadrao'), errorMessage(error)),
      },
    );
  }

  function duplicateModel(model: ScoringModel) {
    duplicate.mutate(model.id, {
      onSuccess: (copy) => toast.success(t('toastDuplicado'), copy.name),
      onError: (error) => toast.error(t('toastErroDuplicar'), errorMessage(error)),
    });
  }

  function confirmDelete() {
    if (!deleting) return;
    const { model } = deleting;
    remove.mutate(model.id, {
      onSuccess: () => {
        setDeleting(null);
        toast.success(t('toastExcluido'), model.name);
      },
      onError: (error) => setDeleting({ model, error: errorMessage(error) }),
    });
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="modelos-de-pontuacao">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="modelos-de-pontuacao" className="text-lg">
            {t('titulo')}
          </h2>
          <p className="mt-1 text-sm text-muted">{t('descricao')}</p>
        </div>
        {models.length > 0 && (
          <Button onClick={openNew} iconLeft={<Plus className="size-4" aria-hidden />}>
            {t('novo')}
          </Button>
        )}
      </div>

      {models.length === 0 ? (
        <EmptyState
          icon={<Calculator className="size-7" />}
          title={t('vazio')}
          description={t('vazioDescricao')}
          action={
            <Button onClick={openNew} iconLeft={<Plus className="size-4" aria-hidden />}>
              {t('criarPrimeiro')}
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {models.map((model) => (
            <li key={model.id}>
              <Card className="flex h-full flex-col gap-3" data-testid="scoring-model-card">
                <div className="flex flex-col gap-2">
                  <h3 className="text-base font-semibold text-text [overflow-wrap:anywhere]">{model.name}</h3>
                  <div className="flex flex-wrap gap-2">
                    <Badge>{MATCH_TYPE_LABELS[model.matchType]}</Badge>
                    {model.isDefault && (
                      <Badge tone="gold" icon={<Star className="size-3.5" aria-hidden />}>
                        {t('padrao')}
                      </Badge>
                    )}
                  </div>
                </div>

                <ScoringPreview rules={model.rules} matchType={model.matchType} extraStats={game.extraStatFields} scoreLabel={scoreLabel} />

                <p className="text-sm text-muted">
                  <span className="font-semibold text-text">{t('desempate')}</span> {tiebreakText(model)}
                </p>

                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <Button variant="secondary" size="sm" onClick={() => openEdit(model)} iconLeft={<Pencil className="size-4" aria-hidden />} aria-label={t('editarRotulo', { nome: model.name })}>
                    {t('editar')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => duplicateModel(model)} disabled={duplicate.isPending} iconLeft={<Copy className="size-4" aria-hidden />} aria-label={t('duplicarRotulo', { nome: model.name })}>
                    {t('duplicar')}
                  </Button>
                  {!model.isDefault && (
                    <Button variant="secondary" size="sm" onClick={() => makeDefault(model)} disabled={update.isPending} iconLeft={<Star className="size-4" aria-hidden />} aria-label={t('tornarPadraoRotulo', { nome: model.name })}>
                      {t('tornarPadrao')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeleting({ model, error: null })} iconLeft={<Trash2 className="size-4" aria-hidden />} aria-label={t('excluirRotulo', { nome: model.name })}>
                    {t('excluir')}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setEditor(null);
        }}
        title={editor?.modelId ? t('editarTitulo') : t('novoTitulo')}
        description={`${game.icon} ${game.name}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditor(null)} disabled={saving}>
              {t('cancelar')}
            </Button>
            <Button onClick={save} loading={saving}>
              {t('salvar')}
            </Button>
          </>
        }
      >
        {editor && (
          <div className="flex flex-col gap-6">
            <ScoringModelEditor
              value={editor.draft}
              // Mexeu no modelo: os erros da última tentativa de salvar deixam de valer.
              onChange={(draft) => setEditor({ ...editor, draft, errors: [] })}
              extraStats={game.extraStatFields}
              scoreLabel={scoreLabel}
              errors={editor.errors}
            />
            <Checkbox
              label={t('usarPadrao', { tipo: MATCH_TYPE_LABELS[editor.draft.matchType] })}
              hint={
                hasDefault(game, editor.draft.matchType, editor.modelId ?? undefined)
                  ? t('padraoSubstitui')
                  : t('padraoExplica')
              }
              checked={editor.isDefault}
              onCheckedChange={(isDefault) => setEditor({ ...editor, isDefault })}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title={t('excluirTitulo')}
        description={deleting ? t('excluirDescricao', { nome: deleting.model.name }) : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={remove.isPending}>
              {t('voltar')}
            </Button>
            {!deleting?.error && (
              <Button variant="danger" onClick={confirmDelete} loading={remove.isPending}>
                {t('excluirModelo')}
              </Button>
            )}
          </>
        }
      >
        {deleting?.error ? (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {deleting.error}
          </p>
        ) : (
          <p className="text-sm text-muted">{t('excluirAviso')}</p>
        )}
      </Modal>
    </section>
  );
}
