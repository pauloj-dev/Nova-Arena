'use client';

import { create } from 'zustand';

/**
 * "Caixa de entrada" do protótipo: como a API simulada não manda e-mail de verdade, o link de
 * verificação volta na resposta do cadastro e fica aqui, só em memória, para a tela seguinte mostrar.
 * Some com a API real (a resposta não traz o token).
 */
interface DevMailbox {
  /** E-mail da conta para a qual o link foi gerado: a tela só mostra o link para essa conta. */
  email: string | null;
  verifyToken: string | null;
  setVerifyToken: (email: string, token: string | null | undefined) => void;
}

export const useDevMailbox = create<DevMailbox>((set) => ({
  email: null,
  verifyToken: null,
  setVerifyToken: (email, token) => set({ email: email.toLowerCase(), verifyToken: token ?? null }),
}));
