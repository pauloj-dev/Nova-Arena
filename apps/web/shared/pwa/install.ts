/**
 * Estado da instalação do PWA (issue #105), num store externo para o `useSyncExternalStore`.
 *
 * - Android/Chrome/Edge: o navegador dispara `beforeinstallprompt`; guardamos o evento e mostramos o nosso botão
 *   "Instalar app" (o aviso automático do navegador fica para depois, por `preventDefault`).
 * - iOS/iPadOS (Safari): não existe esse evento; o botão abre o passo a passo "Compartilhar → Adicionar à Tela de Início".
 * - Já instalado (aberto como app): não mostra nada.
 *
 * Os ouvintes entram quando o módulo carrega no navegador, para não perder um evento que chegue antes da hidratação.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export type InstallMode = 'hidden' | 'prompt' | 'ios';

export interface InstallState {
  mode: InstallMode;
}

const HIDDEN: InstallState = { mode: 'hidden' };

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let snapshot: InstallState = HIDDEN;
const listeners = new Set<() => void>();

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const media = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return media || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS se apresenta como Mac: a tela de toque denuncia.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function compute(): InstallState {
  if (installed || isStandalone()) return HIDDEN;
  if (deferred) return { mode: 'prompt' };
  if (isIos()) return { mode: 'ios' };
  return HIDDEN;
}

function refresh(): void {
  const next = compute();
  if (next.mode !== snapshot.mode) snapshot = next;
}

function emit(): void {
  refresh();
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  // Primeira leitura no navegador (o snapshot do servidor é sempre "escondido"); o React relê o snapshot depois de assinar.
  refresh();
  return () => {
    listeners.delete(listener);
  };
}

export function getInstallSnapshot(): InstallState {
  return snapshot;
}

export function getServerInstallSnapshot(): InstallState {
  return HIDDEN;
}

/** Abre o aviso de instalação do navegador. Devolve se a pessoa aceitou. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  // O evento só pode ser usado uma vez.
  deferred = null;
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === 'accepted') installed = true;
  emit();
  return choice.outcome === 'accepted';
}

/** Só para testes: volta ao estado inicial. */
export function resetInstallStateForTests(): void {
  deferred = null;
  installed = false;
  snapshot = HIDDEN;
}
