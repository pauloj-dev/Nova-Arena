export type EngineErrorCode =
  | 'INVALID_ENTRANTS'
  | 'INVALID_CONFIG'
  | 'MATCH_NOT_FOUND'
  | 'MATCH_NOT_READY'
  | 'INVALID_RESULT'
  | 'DRAW_NOT_ALLOWED'
  | 'RESULT_LOCKED'
  | 'STAGE_STARTED'
  | 'STAGE_INCOMPLETE'
  | 'ENTRANT_NOT_FOUND'
  | 'SWISS_PAIRING_IMPOSSIBLE'
  | 'INVALID_QUALIFICATION';

/** Erro de regra do motor. `message` vem em pt-BR, pronta para exibir. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}
