/** Módulo `games` da API simulada: leitura pública do catálogo. */
import { http } from 'msw';
import { db } from '../db';
import { currentUser, handle, isAdmin, json, notFound, param, query, url } from '../http';

export const moduleName = 'games';

export const handlers = [
  http.get(
    url('/games'),
    handle(({ request }) => {
      const user = currentUser();
      // Jogos desativados só aparecem para o Admin (e com `all=1`).
      const includeInactive = query(request).get('all') === '1' && user !== null && isAdmin(user);
      const games = db().games.filter((g) => includeInactive || g.active);
      return json(games);
    }),
  ),
  http.get(
    url('/games/:slug'),
    handle(({ params }) => {
      const slug = param(params, 'slug');
      const game = db().games.find((g) => g.slug === slug || g.id === slug);
      if (!game) throw notFound('Jogo');
      return json(game);
    }),
  ),
];
