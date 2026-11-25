import type { RegistrationMember } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { importableRows, importHeader, parseRegistrationsCsv, registrationsCsvTemplate, registrationsToCsv, toCsv, UTF8_BOM, type RegistrationExportRow } from './csv';

const member = (nickname: string, confirmed = true): RegistrationMember => ({ userId: `u_${nickname}`, nickname, avatarUrl: null, isCaptain: false, isSub: false, confirmedAt: confirmed ? '2026-11-10T12:00:00.000Z' : null, hasGameAccount: true });

const row = (patch: Partial<RegistrationExportRow>): RegistrationExportRow => ({
  displayName: 'Squad Alfa',
  tag: 'ALFA',
  teamId: 't_alfa',
  userId: null,
  status: 'CONFIRMED',
  members: [member('Lucas'), member('Kaue'), member('Thiago', false)],
  requiredMembers: 4,
  waitlistPosition: null,
  statusReason: null,
  createdAt: '2026-11-10T23:30:00.000Z',
  ...patch,
});

describe('geração do CSV', () => {
  it('começa com BOM, separa por ponto e vírgula e termina as linhas com CRLF', () => {
    const csv = toCsv(['a', 'b'], [['1', '2']]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('a;b\r\n1;2\r\n');
  });

  it('põe entre aspas o que tem separador, aspas ou quebra de linha', () => {
    const csv = toCsv(['nome'], [['Squad; "Alfa"'], ['duas\nlinhas']]);
    expect(csv).toContain('"Squad; ""Alfa"""');
    expect(csv).toContain('"duas\nlinhas"');
  });

  it('neutraliza células que o Excel leria como fórmula', () => {
    const csv = toCsv(['nome'], [['=HYPERLINK("http://x")'], ['+55 11 90000'], ['-1'], ['@cmd'], [7]]);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(lines[2]).toBe("'+55 11 90000");
    expect(lines[3]).toBe("'-1");
    expect(lines[4]).toBe("'@cmd");
    expect(lines[5]).toBe('7');
  });

  it('exporta os inscritos com status em português e data no horário de Brasília', () => {
    const csv = registrationsToCsv([
      row({}),
      row({ displayName: 'NinaX10', tag: null, teamId: null, userId: 'u_p10', members: [member('NinaX10')], requiredMembers: 1, status: 'WAITLIST', waitlistPosition: 2 }),
      row({ displayName: 'Time Importado', tag: 'IMP', teamId: null, userId: null, members: [], status: 'REJECTED', statusReason: 'Fora do prazo; sem contato', contact: 'a@b.com', gameAccountId: '123' }),
    ]);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('Nome;Tag;Tipo;Status;Membros confirmados;Membros;Posição na lista de espera;Motivo;Inscrição em;Contato;ID no jogo');
    expect(lines[1]).toBe('Squad Alfa;ALFA;Squad;Confirmada;2/4;Lucas, Kaue, Thiago;;;10/11/2026 20:30;;');
    expect(lines[2]).toBe('NinaX10;;Solo;Lista de espera;;NinaX10;2;;10/11/2026 20:30;;');
    expect(lines[3]).toBe('Time Importado;IMP;Importada;Recusada;;;;"Fora do prazo; sem contato";10/11/2026 20:30;a@b.com;123');
    // Elenco sem conta (RN-18): os jogadores saem na coluna de membros, com a reserva marcada.
    const withGuests = registrationsToCsv([row({ displayName: 'Squad Manual', tag: null, teamId: null, members: [], guests: [{ id: 'g1', name: 'Ana', gameId: '1', isSub: false }, { id: 'g2', name: 'Bia', gameId: null, isSub: true }] })]);
    expect(withGuests.slice(1).trim().split('\r\n')[1]).toBe('Squad Manual;;Importada;Confirmada;;Ana, Bia (reserva);;;10/11/2026 20:30;;');
  });
});

describe('leitura do CSV de importação', () => {
  it('lê o próprio modelo de CSV sem erros', () => {
    const parsed = parseRegistrationsCsv(registrationsCsvTemplate(true));
    expect(parsed.fatal).toBeNull();
    expect(parsed.lines.map((l) => [l.line, l.values.name, l.values.tag, l.errors])).toEqual([
      [2, 'Squad Exemplo', 'EXEM', []],
      [3, 'Squad Modelo', 'MODE', []],
    ]);
    expect(importableRows(parsed).rows[0]).toEqual({ name: 'Squad Exemplo', tag: 'EXEM', contact: 'capitao@exemplo.com', gameId: '1234567890' });
  });

  it('aceita vírgula como separador e cabeçalho com acento, maiúsculas e outra ordem', () => {
    const parsed = parseRegistrationsCsv('Tag,Nome,Contato\nABC,Time Um,um@x.com\n,Time Dois,\n');
    expect(parsed.lines.map((l) => l.values)).toEqual([
      { name: 'Time Um', tag: 'ABC', contact: 'um@x.com', gameId: '' },
      { name: 'Time Dois', tag: '', contact: '', gameId: '' },
    ]);
    expect(parseRegistrationsCsv('Equipe;ID do jogo\nTime;999\n').lines[0]?.values).toMatchObject({ name: 'Time', gameId: '999' });
  });

  it('aponta a linha e o motivo de cada erro, sem descartar as linhas boas', () => {
    const parsed = parseRegistrationsCsv('nome;tag\nTime Um;UM\n;SEMNOME\nTime Três;TAGLONGA\n\ntime um;X\n');
    expect(parsed.fatal).toBeNull();
    expect(parsed.lines.map((l) => [l.line, l.errors])).toEqual([
      [2, []],
      [3, ['Falta o nome.', 'A tag pode ter no máximo 5 caracteres.']],
      [4, ['A tag pode ter no máximo 5 caracteres.']],
      [6, ['Nome repetido no arquivo (já aparece na linha 2).']],
    ]);
    const { rows, fileLines } = importableRows(parsed);
    expect(rows).toEqual([{ name: 'Time Um', tag: 'UM' }]);
    expect(fileLines).toEqual([2]);
  });

  it('lê campos entre aspas com separador dentro', () => {
    const parsed = parseRegistrationsCsv('nome;tag\n"Squad; do Zé";ZE\n');
    expect(parsed.lines[0]?.values.name).toBe('Squad; do Zé');
  });

  it('recusa arquivo vazio, só com cabeçalho ou sem a coluna de nome', () => {
    expect(parseRegistrationsCsv('  \n').fatal).toBe('O arquivo está vazio.');
    expect(parseRegistrationsCsv('nome;tag\n').fatal).toContain('só tem o cabeçalho');
    expect(parseRegistrationsCsv('coluna;outra\nx;y\n').fatal).toContain('coluna "nome"');
  });

  it('recusa arquivo com mais de 1.024 linhas', () => {
    const big = `nome\n${Array.from({ length: 1025 }, (_, i) => `Time ${i}`).join('\n')}\n`;
    expect(parseRegistrationsCsv(big).fatal).toContain('1024');
  });

  it('ida e volta: o que é exportado com BOM e ponto e vírgula é lido de volta', () => {
    const csv = toCsv(['nome', 'tag'], [['Squad "Ômega"; o melhor', 'OMG']]);
    expect(parseRegistrationsCsv(csv).lines[0]?.values).toMatchObject({ name: 'Squad "Ômega"; o melhor', tag: 'OMG' });
  });

  describe('elenco na planilha (RN-18, campeonato por squad)', () => {
    const FF_4X4 = { teamSize: 4, maxSubs: 1 };

    it('o modelo do Free Fire 4x4 traz 4 titulares e 1 reserva, com nome e ID, e é lido de volta sem erros', () => {
      const template = registrationsCsvTemplate(true, FF_4X4);
      expect(template.slice(1).split('\r\n')[0]).toBe('nome;tag;contato;id_no_jogo;jogador_1;id_jogador_1;jogador_2;id_jogador_2;jogador_3;id_jogador_3;jogador_4;id_jogador_4;reserva_1;id_reserva_1');
      expect(importHeader(null)).toEqual(['nome', 'tag', 'contato', 'id_no_jogo']);
      const parsed = parseRegistrationsCsv(template, FF_4X4);
      expect(parsed.lines.map((l) => [l.values.name, l.members.length, l.errors])).toEqual([
        ['Squad Exemplo', 5, []],
        ['Squad Modelo', 2, []],
      ]);
      expect(importableRows(parsed).rows[0]?.members).toEqual([
        { name: 'ExemJogador1', gameId: '1000000001' },
        { name: 'ExemJogador2', gameId: '1000000002' },
        { name: 'ExemJogador3', gameId: '1000000003' },
        { name: 'ExemJogador4', gameId: '1000000004' },
        { name: 'ExemReserva1', gameId: '1000000005', isSub: true },
      ]);
    });

    it('aceita variações de cabeçalho, elenco incompleto e colunas fora de ordem', () => {
      const parsed = parseRegistrationsCsv('Squad;Reserva;ID Jogador 2;Jogador 2;Titular 1;Player 3 ID;Player 3\nTime;Banco;22;Bia;Ana;33;Caio\nSó Nome;;;;;;\n', FF_4X4);
      expect(parsed.lines[0]?.errors).toEqual([]);
      expect(parsed.lines[0]?.members).toEqual([
        { name: 'Ana', gameId: '', isSub: false },
        { name: 'Bia', gameId: '22', isSub: false },
        { name: 'Caio', gameId: '33', isSub: false },
        { name: 'Banco', gameId: '', isSub: true },
      ]);
      expect(importableRows(parsed).rows).toEqual([{ name: 'Time', members: [{ name: 'Ana' }, { name: 'Bia', gameId: '22' }, { name: 'Caio', gameId: '33' }, { name: 'Banco', isSub: true }] }, { name: 'Só Nome' }]);
    });

    it('aponta elenco fora do modo, jogador repetido e ID sem nome', () => {
      const header = 'nome;jogador_1;id_jogador_1;jogador_2;id_jogador_2;jogador_3;jogador_4;jogador_5;reserva_1;reserva_2';
      const parsed = parseRegistrationsCsv(`${header}\nCinco;A;;B;;C;D;E;;\nDuas Reservas;A;;;;;;;R1;R2\nRepetido;Ana;1;ana;2;;;;;\nMesmo ID;Ana;7;Bia;7;;;;;\nSem Nome;;9;Bia;;;;;;\n`, FF_4X4);
      expect(parsed.lines.map((l) => l.errors)).toEqual([
        ['Este modo tem 4 titulares por squad: o elenco ficaria com 5.'],
        ['Este modo aceita 1 reserva por squad: o elenco ficaria com 2.'],
        ['O jogador "ana" aparece duas vezes no elenco.'],
        ['O ID no jogo "7" aparece duas vezes no elenco.'],
        ['A coluna "id_jogador_1" tem um ID no jogo, mas falta o nome do jogador.'],
      ]);
      expect(importableRows(parsed).rows).toEqual([]);
    });

    it('em campeonato individual as colunas de elenco são ignoradas (o modelo nem traz)', () => {
      expect(registrationsCsvTemplate(false, FF_4X4).slice(1).split('\r\n')[0]).toBe('nome;tag;contato;id_no_jogo');
      const parsed = parseRegistrationsCsv('nome;jogador_1;id_jogador_1\nZeca;Outro;1\n');
      expect(parsed.lines[0]).toMatchObject({ members: [], errors: [] });
      expect(importableRows(parsed).rows).toEqual([{ name: 'Zeca' }]);
    });
  });
});
