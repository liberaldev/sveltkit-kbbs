import type {RequestEvent, ResolveOptions} from '@sveltejs/kit';
import type {MaybePromise} from '@sveltejs/kit/types/private';
import _ from 'lodash-es';
import njwt from 'njwt';
import {CookieParser} from './lib/cookie-parser';
import {key} from './lib/auth/user/server';

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({event, resolve}: HandleParameter) {
  try {
    event.locals.user = await getUser(event.request.headers.get('cookie'));
  } catch (e) {
    console.error('[hooks]', e);
  }
  const response = await resolve(event);
  return response;
}

async function getUser(cookie: string | null) {
  if (_.isEmpty(cookie)) {
    return undefined;
  }

  const cookies = (new CookieParser(cookie!)).get();
  if (!cookies.token) {
    return undefined;
  }

  const jwt = njwt.verify(cookies.token, key);
  if (!jwt) {
    return undefined;
  }

  if (jwt.isExpired()) {
    const refresh = njwt.verify(cookies.refresh ?? '');
    if (refresh?.isExpired() === false) {
      // todo: sign again
    }
  }

  const body = jwt.body.toJSON();
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace App {
    interface Locals {
      user: any
    }
  }
}

interface HandleParameter {
  event: RequestEvent,
  resolve: (event: RequestEvent, opts?: ResolveOptions) => MaybePromise<Response>
}