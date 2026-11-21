'use client';

import { Button, Card, EmptyState, ErrorState, Select, Skeleton, Tabs, useToast } from '@nova/ui';
import { ArrowLeft, Download, ImageOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { downloadFile } from '@/features/organizer/lib/download';
import { ShareButton } from '@/features/tournaments/ShareButton';
import { ApiError, errorMessage } from '@/shared/api/client';
import { usePodium } from '@/shared/api/hooks/competition';
import { useTournament, useTournamentRegistrations } from '@/shared/api/hooks/tournaments';
import { useT } from '@/shared/i18n/react';
import { formatDate } from '@/shared/lib/datetime';
import { CertificateArt, certificateTitle } from './CertificateArt';
import { ChampionsArt } from './ChampionsArt';
import { nodeToPng } from './exportPng';
import { messages } from './messages';
import { ART_SIZES, CSS_THEME, resolveTheme, type ArtFormat, type ArtTheme } from './theme';

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Prévia de uma arte: ela é montada no tamanho real (1200×630 ou 1080×1080) e reduzida para caber
 * na tela. "Baixar" gera o PNG no tamanho real, no próprio navegador.
 */
function ArtPreview({ format, fileName, label, children }: { format: ArtFormat; fileName: string; label: string; children: ReactNode }) {
  const t = useT(messages, 'ArtPreview');
  const { width, height } = ART_SIZES[format];
  const frame = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [busy, setBusy] = useState(false);
  const { success, error } = useToast();

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / width);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  async function download() {
    const node = art.current?.firstElementChild;
    if (!(node instanceof HTMLElement)) return;
    setBusy(true);
    try {
      downloadFile(await nodeToPng(node, width, height), fileName, 'image/png');
      success(t('pronta'), t('baixada', { arquivo: fileName }));
    } catch (e) {
      error(t('erro'), e instanceof Error ? e.message : t('erroDica'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div ref={frame} className="w-full overflow-hidden rounded-lg border border-border" style={{ height: scale > 0 ? height * scale : undefined, aspectRatio: scale > 0 ? undefined : `${width} / ${height}` }} role="img" aria-label={label} data-testid="art-preview" data-format={format}>
        <div ref={art} style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left', visibility: scale > 0 ? 'visible' : 'hidden' }} aria-hidden>
          {children}
        </div>
      </div>
      <div>
        <Button loading={busy} iconLeft={<Download className="size-4" aria-hidden />} onClick={() => void download()}>
          {t('baixar', { largura: String(width), altura: String(height) })}
        </Button>
      </div>
    </div>
  );
}

/** `/c/[slug]/arte` — arte de campeões e certificados de um campeonato finalizado (ORG-12, pública). */
export function ArtworkPage({ slug }: { slug: string }) {
  const t = useT(messages, 'ArtworkPage');
  const tournament = useTournament(slug);
  const info = tournament.data;
  const finished = info?.status === 'FINISHED' || info?.status === 'ARCHIVED';
  const podium = usePodium(finished ? info?.id : undefined);
  const registrations = useTournamentRegistrations(finished ? info?.id : undefined);
  const [format, setFormat] = useState<ArtFormat>('landscape');
  const [participantId, setParticipantId] = useState('');
  // Na tela a arte usa os tokens direto; depois de montar, troca pelos valores finais (os mesmos que vão para o PNG).
  const [theme, setTheme] = useState<ArtTheme>(CSS_THEME);
  useEffect(() => {
    const id = requestAnimationFrame(() => setTheme(resolveTheme()));
    return () => cancelAnimationFrame(id);
  }, []);

  const shell = (content: ReactNode) => <main id="conteudo" className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-6 md:px-6 md:py-8">{content}</main>;

  if (!info) {
    if (tournament.error instanceof ApiError && tournament.error.status === 404) {
      return shell(<EmptyState icon={<ImageOff className="size-7" />} title={t('naoEncontrado')} description={t('naoEncontradoDescricao')} action={<Button asChild><Link href="/campeonatos">{t('verCampeonatos')}</Link></Button>} />);
    }
    if (tournament.error) return shell(<ErrorState description={errorMessage(tournament.error)} onRetry={() => void tournament.refetch()} />);
    return shell(
      <div className="flex flex-col gap-4" role="status" aria-label={t('carregando')}>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="aspect-[1200/630] w-full" />
      </div>,
    );
  }

  const back = (
    <Link href={`/c/${info.slug}`} className="flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-text underline-offset-2 hover:underline">
      <ArrowLeft className="size-4" aria-hidden />
      {t('voltar', { nome: info.name })}
    </Link>
  );

  if (!finished) {
    return shell(
      <>
        {back}
        <h1 className="text-xl md:text-2xl">{t('titulo')}</h1>
        <EmptyState icon={<ImageOff className="size-7" />} title={t('aguardando')} description={t('aguardandoDescricao')} />
      </>,
    );
  }

  if (!podium.data) {
    return shell(
      <>
        {back}
        <h1 className="text-xl md:text-2xl">{t('titulo')}</h1>
        {podium.error ? <ErrorState description={errorMessage(podium.error)} onRetry={() => void podium.refetch()} /> : podium.isPending ? <Skeleton className="aspect-[1200/630] w-full" /> : <EmptyState icon={<ImageOff className="size-7" />} title={t('semPodio')} />}
      </>,
    );
  }

  const dateLabel = formatDate(podium.data.finishedAt);
  const siteLabel = `${typeof window === 'undefined' ? '' : window.location.host}/c/${info.slug}`;
  const places = podium.data.places.map((p) => ({ place: p.place, name: p.name, tag: p.tag }));
  const common = { tournamentName: info.name, gameName: info.gameName, gameIcon: info.gameIcon, dateLabel, siteLabel, format, theme };
  const champion = places.find((p) => p.place === 1);

  const participants = (registrations.data ?? []).filter((r) => r.status === 'CONFIRMED').sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
  const selected = participants.find((r) => r.id === participantId) ?? participants.find((r) => podium.data?.places.some((p) => p.place === 1 && p.registrationId === r.id)) ?? participants[0];
  const selectedPlace = selected ? (podium.data.places.find((p) => p.registrationId === selected.id)?.place ?? null) : null;

  return shell(
    <>
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl">{t('titulo')}</h1>
          <p className="mt-1 text-sm text-muted">
            {t('resumo', { nome: info.name, data: dateLabel, temCampeao: champion ? 'sim' : 'nao', campeao: champion?.name ?? '' })}
          </p>
        </div>
        <ShareButton title={t('compartilharTitulo', { nome: info.name })} text={champion ? t('compartilharTexto', { campeao: champion.name, nome: info.name }) : undefined} url={`/c/${info.slug}/arte`} />
      </div>

      <Select className="max-w-xs" label={t('formato')} value={format} onChange={(e) => setFormat(e.target.value as ArtFormat)} options={(Object.keys(ART_SIZES) as ArtFormat[]).map((value) => ({ value, label: ART_SIZES[value].label }))} />

      <Tabs
        label={t('tipoDeArte')}
        items={[
          {
            value: 'campeoes',
            label: t('abaCampeoes'),
            content: (
              <Card className="flex flex-col gap-3">
                <h2 className="text-lg">{t('arteDeCampeoes')}</h2>
                <ArtPreview key={format} format={format} fileName={`campeoes-${info.slug}-${format === 'square' ? '1080x1080' : '1200x630'}.png`} label={t('arteDeCampeoesRotulo', { nome: info.name, podio: places.map((p) => t('itemPodio', { colocacao: String(p.place), nome: p.name })).join(', ') })}>
                  <ChampionsArt {...common} places={places} />
                </ArtPreview>
              </Card>
            ),
          },
          {
            value: 'certificado',
            label: t('abaCertificado'),
            content: (
              <Card className="flex flex-col gap-3">
                <h2 className="text-lg">{t('certificadoPorParticipante')}</h2>
                {registrations.isPending ? (
                  <Skeleton className="aspect-[1200/630] w-full" />
                ) : !selected ? (
                  <EmptyState title={t('semParticipantes')} />
                ) : (
                  <>
                    <Select className="max-w-md" label={t('participante')} value={selected.id} onChange={(e) => setParticipantId(e.target.value)} options={participants.map((r) => ({ value: r.id, label: r.displayName }))} />
                    <ArtPreview key={`${format}-${selected.id}`} format={format} fileName={`certificado-${slugify(selected.displayName)}-${info.slug}.png`} label={t('certificadoRotulo', { titulo: certificateTitle(selectedPlace), nome: selected.displayName, campeonato: info.name })}>
                      <CertificateArt {...common} participantName={selected.displayName} place={selectedPlace} organizerName={info.organizerNickname} />
                    </ArtPreview>
                  </>
                )}
              </Card>
            ),
          },
        ]}
      />
      <p className="text-xs text-muted">{t('aviso')}</p>
    </>,
  );
}
