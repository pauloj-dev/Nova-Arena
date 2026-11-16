/**
 * Código e senha da sala cifrados com AES-256-GCM (issue #83, PRD §16.5). A chave (32 bytes em base64) fica na
 * variável sensível `LOBBY_ENCRYPTION_KEY`; o banco guarda só o texto cifrado (`matches.lobbyCodeEnc`).
 *
 * Formato: `v1.<iv>.<tag>.<texto cifrado>` (base64url). O identificador da partida entra como dado autenticado:
 * um texto cifrado copiado para outra partida não abre.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../env';
import { HttpProblem } from '../errors';

export interface LobbySecret {
  code: string;
  password: string | null;
}

function keyOf(env: Env): Buffer {
  const raw = env.LOBBY_ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, 'base64') : null;
  if (!key || key.length !== 32) throw new HttpProblem(503, 'A sala não pode ser guardada agora. Avise o suporte.', 'LOBBY_UNAVAILABLE');
  return key;
}

export function encryptLobby(env: Env, matchId: string, secret: LobbySecret): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(env), iv);
  cipher.setAAD(Buffer.from(matchId));
  const data = Buffer.concat([cipher.update(JSON.stringify(secret), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptLobby(env: Env, matchId: string, value: string): LobbySecret {
  const [version, iv, tag, data] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new HttpProblem(500, 'Sala com formato desconhecido.', 'LOBBY_CORRUPTED');
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyOf(env), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(matchId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    return JSON.parse(plain) as LobbySecret;
  } catch (error) {
    if (error instanceof HttpProblem) throw error;
    // Chave trocada ou dado adulterado: nunca devolve lixo como se fosse o código.
    throw new HttpProblem(500, 'Não foi possível abrir a sala. Peça para a organização informar de novo.', 'LOBBY_CORRUPTED');
  }
}
