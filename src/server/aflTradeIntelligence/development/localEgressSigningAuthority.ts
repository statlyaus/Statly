import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  type KeyObject,
} from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

import { createAflTradeEd25519EgressExecutionVerifier } from '../source/fitzRoyHttpEgressExecutor';

const SIGNING_KEY_ID = 'local-current-valuation-evidence-capture';
const SIGNING_KEY_FILENAME = 'egress-signing-key.pem';

function createKeyFile(keyPath: string): void {
  const privateKeyPem = generateKeyPairSync('ed25519').privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });
  const temporaryPath = `${keyPath}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporaryPath, 'wx', 0o600);
  try {
    writeFileSync(descriptor, privateKeyPem);
  } finally {
    closeSync(descriptor);
  }
  try {
    linkSync(temporaryPath, keyPath);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  } finally {
    unlinkSync(temporaryPath);
  }
}

function assertPrivateKeyFile(pathStats: Stats): void {
  if (!pathStats.isFile() || pathStats.nlink !== 1) {
    throw new TypeError('The retained local egress signing key must be one regular file.');
  }
  if ((pathStats.mode & 0o777) !== 0o600) {
    throw new TypeError('The retained local egress signing key must have mode 0600.');
  }
  if (typeof process.getuid === 'function' && pathStats.uid !== process.getuid()) {
    throw new TypeError(
      'The retained local egress signing key must be owned by this process user.'
    );
  }
}

function readPrivateKeyFile(keyPath: string): Buffer {
  const pathStats = lstatSync(keyPath);
  assertPrivateKeyFile(pathStats);
  const descriptor = openSync(keyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const openedStats = fstatSync(descriptor);
    assertPrivateKeyFile(openedStats);
    if (openedStats.dev !== pathStats.dev || openedStats.ino !== pathStats.ino) {
      throw new TypeError('The retained local egress signing key changed while opening it.');
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function loadPrivateKey(keyPath: string): KeyObject {
  let keyBytes: Buffer;
  try {
    keyBytes = readPrivateKeyFile(keyPath);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    createKeyFile(keyPath);
    keyBytes = readPrivateKeyFile(keyPath);
  }
  const privateKey = createPrivateKey(keyBytes);
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('The retained local egress signing key is not an Ed25519 private key.');
  }
  return privateKey;
}

export function createLocalAflTradeEgressSigningAuthority(input: {
  readonly artifactRoot: string;
}) {
  if (!isAbsolute(input.artifactRoot)) {
    throw new TypeError('The local egress signing authority requires an absolute artifact root.');
  }
  const directory = resolve(input.artifactRoot, 'current-valuation-evidence');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStats = lstatSync(directory);
  if (!directoryStats.isDirectory() || (directoryStats.mode & 0o077) !== 0) {
    throw new TypeError('The local egress signing directory must be a private regular directory.');
  }
  const privateKey = loadPrivateKey(resolve(directory, SIGNING_KEY_FILENAME));
  const publicKeyPem = createPublicKey(privateKey)
    .export({ type: 'spki', format: 'pem' })
    .toString();
  return {
    signingKey: { keyId: SIGNING_KEY_ID, privateKey },
    verifier: createAflTradeEd25519EgressExecutionVerifier({
      [SIGNING_KEY_ID]: publicKeyPem,
    }),
  };
}
