/** Aparelhos conectados (issue #69): descrição legível e IP parcial, iguais na API real e na simulada. */
/** "Chrome no Android", "Safari no iPhone"… sem biblioteca: só o suficiente para reconhecer o aparelho. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Aparelho desconhecido';
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Navegador';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null;
  return os ? `${browser} no ${os}` : browser;
}

/** IP sem o último pedaço: dá para reconhecer a rede sem expor o endereço inteiro. */
export function maskIp(ip: string | null): string | null {
  if (!ip || ip === 'unknown') return null;
  if (ip.includes('.')) return ip.replace(/\.\d+$/, '.x');
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}:…`;
  return null;
}
