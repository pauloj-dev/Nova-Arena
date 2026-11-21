/**
 * Bot do Discord (issue 121).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../../context';

export const discord = new Hono<AppEnv>();
