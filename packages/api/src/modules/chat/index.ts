/**
 * Chat por partida (issue 125).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../../context';

export const chat = new Hono<AppEnv>();
