import type { RegistrationMember } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { importableRows, parseRegistrationsCsv, registrationsCsvTemplate, registrationsToCsv, toCsv, UTF8_BOM, type RegistrationExportRow } from './csv';

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
});
