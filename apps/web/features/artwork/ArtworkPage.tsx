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
import { formatDate } from '@/shared/lib/datetime';
import { CertificateArt, certificateTitle } from './CertificateArt';
import { ChampionsArt } from './ChampionsArt';
import { nodeToPng } from './exportPng';
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
      success('Imagem pronta', `${fileName} foi baixada.`);
    } catch (e) {
      error('Não foi possível gerar a imagem', e instanceof Error ? e.message : 'Tente de novo em outro navegador.');
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
          Baixar PNG ({width} × {height})
        </Button>
      </div>
    </div>
  );
}

/** `/c/[slug]/arte` — arte de campeões e certificados de um campeonato finalizado (ORG-12, pública). */
export function ArtworkPage({ slug }: { slug: string }) {
  const tournament = useTournament(slug);
  const t = tournament.data;
  const finished = t?.status === 'FINISHED' || t?.status === 'ARCHIVED';
  const podium = usePodium(finished ? t?.id : undefined);
  const registrations = useTournamentRegistrations(finished ? t?.id : undefined);
  const [format, setFormat] = useState<ArtFormat>('landscape');
  const [participantId, setParticipantId] = useState('');
  // Na tela a arte usa os tokens direto; depois de montar, troca pelos valores finais (os mesmos que vão para o PNG).
  const [theme, setTheme] = useState<ArtTheme>(CSS_THEME);
  useEffect(() => {
    const id = requestAnimationFrame(() => setTheme(resolveTheme()));
    return () => cancelAnimationFrame(id);
  }, []);

  const shell = (content: ReactNode) => <main id="conteudo" className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-6 md:px-6 md:py-8">{content}</main>;

  if (!t) {
    if (tournament.error instanceof ApiError && tournament.error.status === 404) {
      return shell(<EmptyState icon={<ImageOff className="size-7" />} title="Campeonato não encontrado" description="O endereço pode estar errado." action={<Button asChild><Link href="/campeonatos">Ver campeonatos</Link></Button>} />);
    }
    if (tournament.error) return shell(<ErrorState description={errorMessage(tournament.error)} onRetry={() => void tournament.refetch()} />);
    return shell(
      <div className="flex flex-col gap-4" role="status" aria-label="Carregando a arte">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="aspect-[1200/630] w-full" />
      </div>,
    );
  }

  const back = (
    <Link href={`/c/${t.slug}`} className="flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-text underline-offset-2 hover:underline">
      <ArrowLeft className="size-4" aria-hidden />
      Voltar para {t.name}
    </Link>
  );

  if (!finished) {
    return shell(
      <>
        {back}
        <h1 className="text-xl md:text-2xl">Arte de resultado</h1>
        <EmptyState icon={<ImageOff className="size-7" />} title="A arte fica pronta quando o campeonato termina" description="Assim que a organização encerrar o campeonato e definir o pódio, a arte de campeões e os certificados aparecem aqui." />
      </>,
    );
  }

  if (!podium.data) {
    return shell(
      <>
        {back}
        <h1 className="text-xl md:text-2xl">Arte de resultado</h1>
        {podium.error ? <ErrorState description={errorMessage(podium.error)} onRetry={() => void podium.refetch()} /> : podium.isPending ? <Skeleton className="aspect-[1200/630] w-full" /> : <EmptyState icon={<ImageOff className="size-7" />} title="Este campeonato terminou sem pódio definido" />}
      </>,
    );
  }

  const dateLabel = formatDate(podium.data.finishedAt);
  const siteLabel = `${typeof window === 'undefined' ? '' : window.location.host}/c/${t.slug}`;
  const places = podium.data.places.map((p) => ({ place: p.place, name: p.name, tag: p.tag }));
  const common = { tournamentName: t.name, gameName: t.gameName, gameIcon: t.gameIcon, dateLabel, siteLabel, format, theme };
  const champion = places.find((p) => p.place === 1);

  const participants = (registrations.data ?? []).filter((r) => r.status === 'CONFIRMED').sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
  const selected = participants.find((r) => r.id === participantId) ?? participants.find((r) => podium.data?.places.some((p) => p.place === 1 && p.registrationId === r.id)) ?? participants[0];
  const selectedPlace = selected ? (podium.data.places.find((p) => p.registrationId === selected.id)?.place ?? null) : null;

  return shell(
    <>
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl">Arte de resultado</h1>
          <p className="mt-1 text-sm text-muted">
            {t.name} · encerrado em {dateLabel}
            {champion ? ` · campeão: ${champion.name}` : ''}
          </p>
        </div>
        <ShareButton title={`Resultado de ${t.name}`} text={champion ? `${champion.name} é campeão de ${t.name}!` : undefined} url={`/c/${t.slug}/arte`} />
      </div>

      <Select className="max-w-xs" label="Formato da imagem" value={format} onChange={(e) => setFormat(e.target.value as ArtFormat)} options={(Object.keys(ART_SIZES) as ArtFormat[]).map((value) => ({ value, label: ART_SIZES[value].label }))} />

      <Tabs
        label="Tipo de arte"
        items={[
          {
            value: 'campeoes',
            label: 'Campeões',
            content: (
              <Card className="flex flex-col gap-3">
                <h2 className="text-lg">Arte de campeões</h2>
                <ArtPreview key={format} format={format} fileName={`campeoes-${t.slug}-${format === 'square' ? '1080x1080' : '1200x630'}.png`} label={`Arte de campeões de ${t.name}: ${places.map((p) => `${p.place}º ${p.name}`).join(', ')}`}>
                  <ChampionsArt {...common} places={places} />
                </ArtPreview>
              </Card>
            ),
          },
          {
            value: 'certificado',
            label: 'Certificado',
            content: (
              <Card className="flex flex-col gap-3">
                <h2 className="text-lg">Certificado por participante</h2>
                {registrations.isPending ? (
                  <Skeleton className="aspect-[1200/630] w-full" />
                ) : !selected ? (
                  <EmptyState title="Nenhum participante confirmado" />
                ) : (
                  <>
                    <Select className="max-w-md" label="Participante" value={selected.id} onChange={(e) => setParticipantId(e.target.value)} options={participants.map((r) => ({ value: r.id, label: r.displayName }))} />
                    <ArtPreview key={`${format}-${selected.id}`} format={format} fileName={`certificado-${slugify(selected.displayName)}-${t.slug}.png`} label={`${certificateTitle(selectedPlace)} de ${selected.displayName} em ${t.name}`}>
                      <CertificateArt {...common} participantName={selected.displayName} place={selectedPlace} organizerName={t.organizerNickname} />
                    </ArtPreview>
                  </>
                )}
              </Card>
            ),
          },
        ]}
      />
      <p className="text-xs text-muted">As imagens são geradas no seu navegador. Nomes de jogos são usados só para identificação; a Nova Arena não é afiliada às desenvolvedoras.</p>
    </>,
  );
}
