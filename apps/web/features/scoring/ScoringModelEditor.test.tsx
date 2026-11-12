import { computePoints, DEFAULT_SCORING_MODELS } from '@nova/engine';
import type { ScoringRule } from '@nova/schemas';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSeed } from '@/mocks/seed';
import { exampleStats, pts, scoreLabelForGame } from './describe';
import { ScoringModelEditor, ScoringPreview, type ScoringDraft, type ScoringModelEditorProps } from './ScoringModelEditor';

afterEach(cleanup);

const FF_RULES: ScoringRule[] = [
  { type: 'PER_UNIT', stat: 'kills', points: 1 },
  { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
];
const FF_DEFAULT: ScoringDraft = {
  name: 'Free Fire · Padrão',
  matchType: 'BATTLE_ROYALE',
  rules: FF_RULES,
  tiebreakers: ['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw'],
};

/** O editor é controlado: este invólucro guarda o valor, como a tela que o usa faz. */
function setup(initial: ScoringDraft = FF_DEFAULT, props: Partial<ScoringModelEditorProps> = {}) {
  const onChange = vi.fn<(value: ScoringDraft) => void>();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <ScoringModelEditor
        {...props}
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  const last = () => {
    const value = onChange.mock.lastCall?.[0];
    if (!value) throw new Error('onChange ainda não foi chamado');
    return value;
  };
  return { user: userEvent.setup(), onChange, last };
}

const rule = (n: number) => screen.getByRole('group', { name: new RegExp(`^Regra ${n} ·`) });
const example = () => screen.getByTestId('scoring-example');

describe('ScoringModelEditor — regras', () => {
  it('mostra cada regra com o tipo e a explicação em português', () => {
    setup();
    expect(within(rule(1)).getByText('1 ponto por kill')).toBeInTheDocument();
    expect(within(rule(2)).getByText('Booyah (1º lugar) vale 3 pontos')).toBeInTheDocument();
    expect(rule(1)).toHaveAccessibleName('Regra 1 · Pontos por unidade');
    expect(rule(2)).toHaveAccessibleName('Regra 2 · Tabela de pontos');
  });

  it('adiciona uma regra do tipo escolhido', async () => {
    const { user, last } = setup();
    await user.selectOptions(screen.getByLabelText('Tipo da nova regra'), 'BONUS');
    await user.click(screen.getByRole('button', { name: 'Adicionar regra' }));
    expect(last().rules).toEqual([...FF_RULES, { type: 'BONUS', stat: 'kills', op: 'gte', value: 10, points: 2 }]);
    expect(within(rule(3)).getByText('+2 pontos com 10 kills ou mais')).toBeInTheDocument();
  });

  it('oferece os 6 tipos de regra', () => {
    setup();
    const options = within(screen.getByLabelText('Tipo da nova regra')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Pontos por unidade', 'Tabela de pontos', 'Resultado da partida', 'Bônus', 'Limite', 'Multiplicador']);
  });

  it('edita os pontos de uma regra', async () => {
    const { user, last } = setup();
    const points = within(rule(1)).getByLabelText('Pontos por unidade');
    await user.clear(points);
    await user.type(points, '2');
    expect(last().rules[0]).toEqual({ type: 'PER_UNIT', stat: 'kills', points: 2 });
    expect(last().rules[1]).toEqual(FF_RULES[1]);
    expect(within(rule(1)).getByText('2 pontos por kill')).toBeInTheDocument();
  });

  it('edita a tabela de colocação e usa o atalho da tabela de liga', async () => {
    const { user, last } = setup();
    const booyah = within(rule(2)).getByLabelText('Pontos do 1º lugar');
    await user.clear(booyah);
    await user.type(booyah, '5');
    expect(last().rules[1]).toEqual({ type: 'TABLE', stat: 'placement', table: { '1': 5 } });

    await user.click(within(rule(2)).getByRole('button', { name: 'Usar tabela de liga' }));
    expect(last().rules[1]).toEqual({
      type: 'TABLE',
      stat: 'placement',
      table: { '1': 12, '2': 9, '3': 8, '4': 7, '5': 6, '6': 5, '7': 4, '8': 3, '9': 2, '10': 1, '11': 0, '12': 0 },
    });
    expect(within(rule(2)).getByLabelText('Pontos do 2º lugar')).toHaveValue(9);
  });

  it('preenche as colocações de 1º a N mantendo o que já existia', async () => {
    const { user, last } = setup();
    const count = within(rule(2)).getByLabelText('Preencher do 1º ao');
    await user.clear(count);
    await user.type(count, '3');
    await user.click(within(rule(2)).getByRole('button', { name: 'Preencher colocações' }));
    expect(last().rules[1]).toEqual({ type: 'TABLE', stat: 'placement', table: { '1': 3, '2': 0, '3': 0 } });
  });

  it('troca o tipo de uma regra mantendo a estatística', async () => {
    const { user, last } = setup();
    await user.selectOptions(within(rule(1)).getByLabelText('Tipo de regra'), 'BONUS');
    expect(last().rules[0]).toEqual({ type: 'BONUS', stat: 'kills', op: 'gte', value: 10, points: 2 });
  });

  it('remove uma regra', async () => {
    const { user, last } = setup();
    await user.click(screen.getByRole('button', { name: 'Remover regra 1' }));
    expect(last().rules).toEqual([FF_RULES[1]]);
    expect(rule(1)).toHaveAccessibleName('Regra 1 · Tabela de pontos');
    expect(screen.queryByRole('group', { name: /^Regra 2 ·/ })).not.toBeInTheDocument();
  });

  it('reordena as regras pelos botões, que funcionam por teclado, e mantém o foco na regra movida', async () => {
    const { user, last } = setup();
    expect(screen.getByRole('button', { name: 'Subir regra 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descer regra 2' })).toBeDisabled();

    screen.getByRole('button', { name: 'Descer regra 1' }).focus();
    await user.keyboard('{Enter}');
    expect(last().rules).toEqual([FF_RULES[1], FF_RULES[0]]);
    expect(rule(2)).toHaveAccessibleName('Regra 2 · Pontos por unidade');
    // A regra movida virou a última: "descer" ficou desabilitado e o foco passou para "subir".
    expect(screen.getByRole('button', { name: 'Subir regra 2' })).toHaveFocus();
    expect(screen.getByText('regra 1 movido para a posição 2 de 2.')).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(last().rules).toEqual(FF_RULES);
  });

  it('cada regra tem alça de arrastar com nome acessível', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Arrastar regra 1 para reordenar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arrastar regra 2 para reordenar' })).toBeInTheDocument();
  });

  it('mostra os erros do motor junto da regra', async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText('Tipo da nova regra'), 'CAP');
    await user.click(screen.getByRole('button', { name: 'Adicionar regra' }));
    expect(within(rule(3)).queryByRole('alert')).not.toBeInTheDocument();

    // Tira a regra de kills: o limite passa a apontar para uma estatística que ninguém pontua.
    await user.click(screen.getByRole('button', { name: 'Remover regra 1' }));
    expect(within(rule(2)).getByRole('alert')).toHaveTextContent('O limite se refere a "kills", que nenhuma regra pontua.');
  });

  it('avisa quando não sobra nenhuma regra que pontue', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Remover regra 2' }));
    await user.click(screen.getByRole('button', { name: 'Remover regra 1' }));
    expect(screen.getByText('Adicione ao menos uma regra de pontuação.')).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma regra ainda/)).toBeInTheDocument();
  });

  it('mostra os erros recebidos de fora na regra certa', () => {
    setup(FF_DEFAULT, { errors: ['Regra 2: a tabela precisa de ao menos uma linha.'] });
    expect(within(rule(2)).getByRole('alert')).toHaveTextContent('A tabela precisa de ao menos uma linha.');
  });

  it('as estatísticas oferecidas dependem do tipo de partida e incluem as extras do jogo', () => {
    setup(
      { name: 'eFootball', matchType: 'DUEL', rules: [{ type: 'PER_UNIT', stat: 'score', points: 1 }], tiebreakers: ['points'] },
      { extraStats: [{ key: 'penalties', label: 'Pênaltis', when: 'tiebreak' }], scoreLabel: 'gols' },
    );
    const options = within(within(rule(1)).getByLabelText('Estatística')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Gols', 'Pênaltis']);
    expect(within(rule(1)).getByText('1 ponto por gol')).toBeInTheDocument();
  });
});

describe('ScoringModelEditor — nome e tipo de partida', () => {
  it('edita o nome', async () => {
    const { user, last } = setup({ ...FF_DEFAULT, name: '' });
    await user.type(screen.getByLabelText(/Nome do modelo/), 'Liga');
    expect(last().name).toBe('Liga');
  });

  it('cobra o nome só depois que a pessoa passa pelo campo', async () => {
    const { user } = setup({ ...FF_DEFAULT, name: '' });
    expect(screen.queryByText('Informe o nome do modelo.')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/Nome do modelo/));
    await user.tab();
    expect(screen.getByText('Informe o nome do modelo.')).toBeInTheDocument();
  });

  it('trocar o tipo de partida troca as regras que não valem mais', async () => {
    const { user, last } = setup();
    await user.selectOptions(screen.getByLabelText('Tipo de partida'), 'DUEL');
    expect(last().matchType).toBe('DUEL');
    expect(last().rules).toEqual([{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }]);
    expect(example()).toHaveTextContent('2 pontos de placar + vitória = 3 pts');
  });

  it('respeita hideName e lockMatchType', () => {
    setup({ ...FF_DEFAULT, name: '' }, { hideName: true, lockMatchType: true });
    expect(screen.queryByLabelText(/Nome do modelo/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tipo de partida')).not.toBeInTheDocument();
    // Sem campo de nome, o editor não cobra o nome.
    expect(screen.queryByText('Informe o nome do modelo.')).not.toBeInTheDocument();
  });
});

describe('ScoringModelEditor — prévia ao vivo', () => {
  it('mostra 10 pontos para 7 kills + 1º lugar no modelo padrão do Free Fire (CT-01)', () => {
    setup();
    expect(example()).toHaveTextContent('7 kills + 1º lugar = 10 pts');
    expect(example()).toHaveAttribute('aria-live', 'polite');
    const breakdown = screen.getByRole('list', { name: 'Quanto cada regra somou no exemplo' });
    expect(within(breakdown).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1 ponto por kill+7', 'Booyah (1º lugar) vale 3 pontos+3']);
  });

  it('recalcula quando o exemplo muda (CT-01: 2º lugar com 9 kills = 9)', async () => {
    const { user } = setup();
    const kills = screen.getByLabelText('Kills do exemplo');
    await user.clear(kills);
    await user.type(kills, '9');
    const placement = screen.getByLabelText('Colocação do exemplo');
    await user.clear(placement);
    await user.type(placement, '2');
    expect(example()).toHaveTextContent('9 kills + 2º lugar = 9 pts');
  });

  it('recalcula quando uma regra muda', async () => {
    const { user } = setup();
    const points = within(rule(1)).getByLabelText('Pontos por unidade');
    await user.clear(points);
    await user.type(points, '2');
    expect(example()).toHaveTextContent('7 kills + 1º lugar = 17 pts');
  });

  it('CAP e MULTIPLIER aparecem na prévia, com a parcela de cada um', () => {
    const rules: ScoringRule[] = [...FF_RULES, { type: 'CAP', stat: 'kills', max: 5 }, { type: 'MULTIPLIER', factor: 2 }];
    setup({ ...FF_DEFAULT, rules });
    // 7 kills limitadas a 5, mais 3 do Booyah = 8; ×2 = 16.
    expect(example()).toHaveTextContent('7 kills + 1º lugar = 16 pts');
    const breakdown = screen.getByRole('list', { name: 'Quanto cada regra somou no exemplo' });
    expect(within(breakdown).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1 ponto por kill+7',
      'Booyah (1º lugar) vale 3 pontos+3',
      'No máximo 5 pontos de kills por queda−2',
      'Todos os pontos da queda valem ×2+8',
    ]);
    expect(example()).toHaveTextContent(pts(computePoints({ kills: 7, placement: 1 }, rules).total));
  });

  it('multiplicador da última queda: o exemplo acontece na última queda e pode ser mudado', async () => {
    const rules: ScoringRule[] = [...FF_RULES, { type: 'MULTIPLIER', factor: 2, when: { matchIndex: 'last' } }];
    const { user } = setup({ ...FF_DEFAULT, rules });
    expect(example()).toHaveTextContent('7 kills + 1º lugar (queda 3 de 3) = 20 pts');

    const drop = screen.getByLabelText('Número da queda');
    await user.clear(drop);
    await user.type(drop, '1');
    expect(example()).toHaveTextContent('7 kills + 1º lugar (queda 1 de 3) = 10 pts');
  });
});

describe('ScoringModelEditor — critérios de desempate', () => {
  const labels = () =>
    within(screen.getByRole('list', { name: /Critérios de desempate em uso/ }))
      .getAllByRole('listitem')
      .map((li) => within(li).getByText(/^\d+\. /).textContent);
  const off = () => screen.queryByRole('list', { name: 'Critérios de desempate desligados' });

  it('Battle Royale: os critérios do tipo de partida, ligados e em ordem', () => {
    setup();
    expect(labels()).toEqual(['1. Pontos totais', '2. Booyahs (vitórias na queda)', '3. Total de kills', '4. Melhor colocação média', '5. Kills na última queda', '6. Sorteio']);
    // Todos os critérios de Battle Royale já estão ligados: não sobra nenhum para oferecer.
    expect(off()).not.toBeInTheDocument();
  });

  it('duelo: oferece para ligar só os critérios que fazem sentido no duelo', () => {
    setup({ name: 'eFootball', matchType: 'DUEL', rules: [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }], tiebreakers: ['points', 'scoreDiff', 'draw'] }, { scoreLabel: 'gols' });
    expect(labels()).toEqual(['1. Pontos totais', '2. Saldo de gols', '3. Sorteio']);
    const offered = within(off() as HTMLElement).getAllByRole('listitem');
    expect(offered.map((li) => li.textContent)).toEqual(['Vitórias', 'Placar feito (gols)', 'Confronto direto']);
  });

  it('critério ligado que não é do tipo de partida continua visível, com aviso', () => {
    setup({ ...FF_DEFAULT, tiebreakers: ['points', 'headToHead', 'kills', 'draw'] });
    expect(labels()).toEqual(['1. Pontos totais', '2. Confronto direto', '3. Total de kills', '4. Sorteio']);
    expect(screen.getByText(/Não se aplica a este tipo de partida/)).toBeInTheDocument();
    expect(within(off() as HTMLElement).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Booyahs (vitórias na queda)', 'Melhor colocação média', 'Kills na última queda']);
  });

  it('reordena os critérios', async () => {
    const { user, last } = setup();
    await user.click(screen.getByRole('button', { name: 'Descer Booyahs (vitórias na queda)' }));
    expect(last().tiebreakers).toEqual(['points', 'kills', 'booyahs', 'avgPlacement', 'lastDropKills', 'draw']);
    expect(labels().slice(0, 3)).toEqual(['1. Pontos totais', '2. Total de kills', '3. Booyahs (vitórias na queda)']);

    await user.click(screen.getByRole('button', { name: 'Subir Kills na última queda' }));
    expect(last().tiebreakers).toEqual(['points', 'kills', 'booyahs', 'lastDropKills', 'avgPlacement', 'draw']);
  });

  it('"pontos" e "sorteio" não saem do lugar', () => {
    setup();
    expect(screen.queryByRole('button', { name: /(Subir|Descer|Arrastar) Pontos totais/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /(Subir|Descer|Arrastar) Sorteio/ })).not.toBeInTheDocument();
    // O primeiro depois de "pontos" não sobe; o último antes do "sorteio" não desce.
    expect(screen.getByRole('button', { name: 'Subir Booyahs (vitórias na queda)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descer Kills na última queda' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: '1. Pontos totais' })).toBeDisabled();
  });

  it('liga e desliga critérios; o que entra fica antes do sorteio', async () => {
    const { user, last } = setup();
    await user.click(screen.getByRole('switch', { name: '3. Total de kills' }));
    expect(last().tiebreakers).toEqual(['points', 'booyahs', 'avgPlacement', 'lastDropKills', 'draw']);

    await user.click(screen.getByRole('switch', { name: 'Total de kills' }));
    expect(last().tiebreakers).toEqual(['points', 'booyahs', 'avgPlacement', 'lastDropKills', 'kills', 'draw']);

    await user.click(screen.getByRole('switch', { name: '6. Sorteio' }));
    expect(last().tiebreakers).toEqual(['points', 'booyahs', 'avgPlacement', 'lastDropKills', 'kills']);

    await user.click(screen.getByRole('switch', { name: 'Sorteio' }));
    expect(last().tiebreakers).toEqual(['points', 'booyahs', 'avgPlacement', 'lastDropKills', 'kills', 'draw']);
  });
});

describe('ScoringPreview', () => {
  it('resume as regras e mostra 10 para 7 kills + 1º lugar no padrão do Free Fire (CT-01)', () => {
    render(<ScoringPreview rules={FF_RULES} matchType="BATTLE_ROYALE" />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1 ponto por kill', 'Booyah (1º lugar) vale 3 pontos']);
    expect(example()).toHaveTextContent('7 kills + 1º lugar = 10 pts');
  });

  it('é somente leitura', () => {
    render(<ScoringPreview rules={FF_RULES} matchType="BATTLE_ROYALE" />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('avisa quando não há regra', () => {
    render(<ScoringPreview rules={[]} matchType="DUEL" />);
    expect(screen.getByText('Nenhuma regra cadastrada.')).toBeInTheDocument();
  });

  const catalog = buildSeed().games.flatMap((game) => game.scoringModels.filter((m) => m.isDefault).map((model) => ({ game, model })));

  it('o catálogo tem modelo padrão para os 4 jogos do lançamento', () => {
    expect(new Set(catalog.map((c) => c.game.slug))).toEqual(new Set(['free-fire', 'clash-royale', '8-ball-pool', 'efootball']));
  });

  it.each(catalog.map((c) => [c.model.name, c] as const))('bate com computePoints no modelo padrão "%s"', (_name, { game, model }) => {
    const { unmount } = render(<ScoringPreview rules={model.rules} matchType={model.matchType} extraStats={game.extraStatFields} scoreLabel={scoreLabelForGame(game.slug)} />);
    const expected = computePoints(exampleStats(model.rules, model.matchType), model.rules).total;
    expect(example().textContent).toMatch(new RegExp(` = ${pts(expected)}$`));
    unmount();
  });

  it.each(DEFAULT_SCORING_MODELS.map((m) => [m.name, m] as const))('bate com computePoints no modelo do motor "%s"', (_name, model) => {
    const rules = model.rules as ScoringRule[];
    render(<ScoringPreview rules={rules} matchType={model.matchType} />);
    const expected = computePoints(exampleStats(rules, model.matchType), model.rules).total;
    expect(example().textContent).toMatch(new RegExp(` = ${pts(expected)}$`));
  });

  it('os totais dos modelos padrão são os do PRD §11.2', () => {
    const total = (slug: string, modelId: string) => {
      const game = buildSeed().games.find((g) => g.slug === slug);
      const model = game?.scoringModels.find((m) => m.id === modelId);
      if (!model) throw new Error(`modelo ${modelId} não está no seed`);
      const { unmount } = render(<ScoringPreview rules={model.rules} matchType={model.matchType} scoreLabel={scoreLabelForGame(slug)} />);
      const text = example().textContent;
      unmount();
      return text;
    };
    expect(total('free-fire', 'sm_ff_padrao')).toBe('7 kills + 1º lugar = 10 pts');
    expect(total('free-fire', 'sm_ff_liga')).toBe('7 kills + 1º lugar = 19 pts');
    expect(total('free-fire', 'sm_ff_cs')).toBe('2 rounds + vitória = 3 pts');
    expect(total('clash-royale', 'sm_cr_padrao')).toBe('2 coroas + vitória = 5 pts');
    expect(total('8-ball-pool', 'sm_pool_padrao')).toBe('2 frames + vitória = 5 pts');
    expect(total('efootball', 'sm_ef_padrao')).toBe('2 gols + vitória = 3 pts');
  });
});
