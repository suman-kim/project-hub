import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const PREFIX = 'v1:';

/**
 * 내 업무 문서의 키 값 암호화(AES-256-GCM).
 * 암호 키는 DB 밖 파일(~/.hub/secret.key, 0600)에 둔다. DB나 DB 백업만으로는 값을 읽을 수 없고,
 * 이 파일을 잃으면 저장한 값도 되살릴 수 없다.
 */
export class SecretBox {
  private key: Buffer | null = null;

  constructor(private readonly keyFile: string) {}

  /** 키 파일을 읽는다. 없으면 create일 때만 새로 만든다 */
  private loadKey(create: boolean): Buffer {
    if (this.key) return this.key;
    if (!existsSync(this.keyFile)) {
      if (!create) throw new Error(`암호 키 파일 ${this.keyFile}가 없어 저장한 값을 풀 수 없다`);
      mkdirSync(dirname(this.keyFile), { recursive: true });
      writeFileSync(this.keyFile, randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' });
    }
    chmodSync(this.keyFile, 0o600);
    const key = Buffer.from(readFileSync(this.keyFile, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error(`암호 키 파일 ${this.keyFile}가 32바이트 키가 아니다`);
    this.key = key;
    return key;
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.loadKey(true), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${PREFIX}${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
  }

  open(sealed: string): string {
    if (!sealed.startsWith(PREFIX)) throw new Error('알 수 없는 암호문 형식이다');
    const [iv, tag, enc] = sealed.slice(PREFIX.length).split('.').map((p) => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.loadKey(false), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}
