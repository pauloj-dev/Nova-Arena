/** Navegador mínimo para os testes: guarda os cookies que a API manda, respeitando o `Path` (como em `auth.integration`). */
import type { App } from '../../src';

export const ORIGIN = 'http://localhost';

export class Browser {
  private jar = new Map<string, { value: string; path: string }>();
  constructor(private app: App) {}

  async request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const fullPath = `/api/v1${path}`;
    const cookie = [...this.jar.entries()].filter(([, c]) => fullPath.startsWith(c.path)).map(([k, c]) => `${k}=${c.value}`).join('; ');
    const res = await this.app.request(fullPath, {
      method: init.method ?? 'GET',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim());
      const [name, value = ''] = (pair ?? '').split('=');
      const path = attrs.find((a) => a.toLowerCase().startsWith('path='))?.slice(5) ?? '/';
      if (!name) continue;
      if (value === '' || attrs.some((a) => a.toLowerCase() === 'max-age=0')) this.jar.delete(name);
      else this.jar.set(name, { value, path });
    }
    const text = await res.text();
    return { status: res.status, data: text ? (JSON.parse(text) as unknown) : null, headers: res.headers };
  }

  cookie(name: string) {
    return this.jar.get(name)?.value;
  }
}
