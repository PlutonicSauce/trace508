import path from 'node:path';
export const root =
  process.env.TRACE508_ROOT ??
  (process.cwd().endsWith(`${path.sep}apps${path.sep}web`)
    ? path.resolve(process.cwd(), '../..')
    : process.cwd());
export const localPath = (...parts: string[]) => path.join(root, '.local', ...parts);
