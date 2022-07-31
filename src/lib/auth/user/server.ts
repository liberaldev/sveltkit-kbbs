import argon2 from 'argon2';
import db from '$lib/database/instance';
import {aql} from 'arangojs';
import njwt from 'njwt';
import {EUserRanks} from '$lib/types/user-ranks';
import {key} from './shared';
import type {IUser} from '$lib/types/user';
import {isStringInteger} from '$lib/util';
import type {IArangoDocumentIdentifier} from '$lib/database';

type UnsafeUser = IUser & { password: string };

export class User {
  constructor(readonly id: string) {
  }

  private stored: UnsafeUser | undefined;

  get data(): Promise<UnsafeUser> {
    // console.trace('1');
    return new Promise<UnsafeUser>(async (resolve, reject) => {
      if (!await this.exists) {
        return reject('user not exists');
      }

      db.query(aql`
        for user in users
          filter user.id == ${this.id}
            return user`)
        .then(async (cursor) => {
          if (!cursor.hasNext) {
            return reject('no user found');
          }
          resolve(await cursor.next());
        })
        .catch(reject);
    });
  }

  get safeData(): Promise<IUser> {
    return new Promise<IUser>((resolve, reject) => {
      this.loadUserData()
        .then((data) => {
          const {_key, _id, _rev, rank, id, profile, avatar} = data;
          resolve({_key, _id, _rev, rank, id, profile, avatar});
        })
        .catch(reject);
    });

  }

  private async loadUserData(): Promise<UnsafeUser> {
    if (!this.stored) {
      this.stored = await this.data;
    }
    return this.stored;
  }

  get uid(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.loadUserData()
        .then((user) => resolve(user._key))
        .catch(reject);
    });
  }

  get rank(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.loadUserData()
        .then((user) => resolve(user.rank))
        .catch(reject);
    });
  }

  get exists(): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      // console.trace('user exists check:', this.id)
      db.query(aql`
        for user in users
          filter user.id == ${this.id}
            return user`)
        .then(async (r) => {
          // console.log(r)
          resolve(r.hasNext);
        })
        .catch(reject);
    });
  }

  static async findByUniqueId(uid?: string): Promise<User | null> {
    // console.trace('3');
    if (!uid) {
      return null;
    }
    if (!isStringInteger(uid)) {
      return null;
    }
    const cursor = await db.query(
      aql`for user in users filter user._key == ${uid} return user.id`,
    );
    if (!cursor.hasNext) {
      return null;
    }
    const id: string = await cursor.next();
    return new User(id);
  }

  static async getByUniqueId(uid?: string): Promise<UnsafeUser | null> {
    if (!uid) {
      return null;
    }
    try {
      // console.trace('4');
      const cursor = await db.query(aql`
      for user in users
        filter user._key == ${uid}
          return user`);
      return await cursor.next();
    } catch {
      return null;
    }
  }

  async register(password: string) {
    if (await this.exists) {
      throw Error('user exists already');
    }

    if (this.id.length < 3) {
      throw new Error('id invalid ( is that shorten than 3');
    }

    if (!password || password.length < 6) {
      throw Error('password invalid (is that shorten than 6)');
    }

    const hashed = await argon2.hash(password);

    await db.query(aql`
      insert ${{id: this.id, password: hashed, rank: EUserRanks.User, createdAt: new Date}} into users`);
  }

  /**
   *
   * @param password 비밀번호 평문
   */
  async verify(password: string): Promise<boolean> {
    try {
      const user = await this.loadUserData();
      return await argon2.verify(user.password, password);
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  token(type: 'user' | 'refresh', payload: Rec<unknown> = {}): njwt.Jwt {
    return njwt.create({
      iss: 'https://ru.hn/',
      sub: `user/${this.id}`,
      scope: type,
      ...payload,
    }, key);
  }

  async blockUser(key: string, reason: string) {
    await db.query(aql`
      for user in users
        filter user.id == ${this.id}
          let blockedUsers = unique(append(is_array(user.blockedUsers) ? user.blockedUsers : [], ${{key, reason}}))
          update user with {blockedUsers: blockedUsers} in users`);
  }

  async removeBlockedUsers(userIds: string[]) {
    await db.query(aql`
      for user in users
        filter user.id == ${this.id}
          let newBlockedUsers = (
            for blockedUser in user.blockedUsers
              filter blockedUser.key not in ${userIds}
                return blockedUser)
          update user with {blockedUsers: newBlockedUsers} in users`);
  }

  async getBlockedUsers(): Promise<string[]> {
    const cursor = await db.query(aql`
      for user in users
        filter user.id == ${this.id}
          return is_array(user.blockedUsers) ? user.blockedUsers : []`);
    return await cursor.next();
  }

  async blockTags(tagNames: string[]) {
    await db.query(aql`
      for user in users
        filter user.id == ${this.id}
          let blockedTags = unique(append(is_array(user.blockedTags) ? user.blockedTags : [], ${tagNames}))
          update user with {blockedTags: blockedTags} in users`);
  }

  async removeBlockedTags(tagNames: string[]) {
    await db.query(aql`
      for user in users
        filter user.id == ${this.id}
          let newBlockedTags = (
            for blockedTag in user.blockedTags
              filter blockedTag not in ${tagNames}
                return blockedTag)
          update user with {blockedTags: newBlockedTags} in users`);
  }

  async getBlockedTags(): Promise<string[]> {
    const cursor = await db.query(aql`
      for user in users
        filter user.id == ${this.id}
          return is_array(user.blockedTags) ? user.blockedTags : []`);
    return await cursor.next();
  }

  /**
   * 많이 쓴 순서대로 태그를 반환합니다.
   */
  async getUsersTags(): Promise<string[]> {
    const cursor = await db.query(aql`
      for tag in tags
        filter tag.user == ${await this.uid} && !regex_test(tag.name, "^_") && tag.pub
          limit 20
          return tag.name`);
    const list = await cursor.all();
    const tags: Record<string, number> = {};
    for (const tag of list) {
      if (tags[tag]) {
        tags[tag] += 1;
      } else {
        tags[tag] = 1;
      }
    }
    return Object.keys(tags).sort((a, b) => {
      return tags[b] - tags[a];
    });
  }

  /**
   *
   * @param src 이미지 링크입니다.
   * @param name 이미지 이름입니다. 최대 16자까지만 와야 합니다. `/`를 이용해서 분류 할 수 있습니다.
   * @param size 이미지의 고정 크기입니다. 이 크기보다 크게 렌더링 되지 않도록 해줍니다.
   */
  async addFavoriteImage(src: string, name: string, size: {x: number, y: number}) {
    const uid = await this.uid;
    await db.query(aql`
      let same = (
        for fav in favorites
          filter fav.type == 'image' && fav.user == ${uid} && fav.src == ${src}
            return fav)
      filter length(same) <= 0
        insert ${{type: 'image', src, name, user: uid, size}} into favorites return NEW`)
  }

  async getFavoriteImages(): Promise<Record<string, { src: string, size: Size }>> {
    const cursor = await db.query(aql`
      for fav in favorites
        filter fav.user == ${await this.uid}
          return unset(fav, "_rev", "_id")`)
    const all = await cursor.all() as Favorite[];
    const result: Record<string, { src: string, size: Size }> = {};
    for (const {src, name, _key, size} of all) {
      result[`${_key}:${name}`] = {src, size};
    }
    return result;
  }
}

type Size = {x: number, y: number};
type Favorite = IArangoDocumentIdentifier & {type: 'image', src: string, name: string, size: Size };
