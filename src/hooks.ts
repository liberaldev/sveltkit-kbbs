import type {RequestEvent, ResolveOptions} from '@sveltejs/kit';
import type {MaybePromise} from '@sveltejs/kit/types/private';
import _ from 'lodash-es';
import njwt from 'njwt';
import {CookieParser} from '$lib/cookie-parser';
import {key} from '$lib/auth/user/shared';
import type {EUserRanks} from '$lib/types/user-ranks';
import {atob, btoa} from 'js-base64';
import {User} from './lib/auth/user/server';
import HttpStatus from 'http-status-codes';

global.atob = atob;
global.btoa = btoa;

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({event, resolve}: HandleParameter) {
  let result: GetUserReturn | undefined;
  try {
    result = await getUser(event.request.headers.get('cookie'));
    if (!result) {
      return await resolve(event);
    }
    event.locals.user = result.user;
  } catch (e) {
    console.error('[hooks]', e);
  }

  const response = await resolve(event);

  try {
    if (result?.newToken) {
      response.headers.set('set-cookie', result.newToken);
    }
  } catch {
    console.trace('error');
  }

  return response;
}

type GetUserReturn = { user: Rec<any>, newToken?: string };
async function getUser(cookie: string | null): Promise<GetUserReturn | undefined> {
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
      const {uid, rank} = jwt.body.toJSON();
      const user = new User(<string>uid);
      const newToken = await user.token('user', {uid, rank});
      return { newToken: newToken.compact(), user: newToken.body.toJSON() };
    }
  }

  return { user: jwt.body.toJSON() as Rec<any> };
  // console.log(body)
}

/** @type {import('@sveltejs/kit').GetSession} */
export function getSession(event: RequestEvent) {
  return event.locals.user;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace App {
    interface Locals {
      user: any;
    }

    interface Session {
      uid: string;
      rank: EUserRanks;
    }
  }
}

interface HandleParameter {
  event: RequestEvent,
  resolve: (event: RequestEvent, opts?: ResolveOptions) => MaybePromise<Response>
}