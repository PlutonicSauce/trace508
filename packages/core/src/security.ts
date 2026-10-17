import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { AppError } from './errors';
export const APPROVED_HOST = 'www.w3.org';
export type TargetPolicy = {
  origin: string;
  pathPrefix: string;
  lab?: boolean;
  allowSubmission?: boolean;
  enabled?: boolean;
};
export const labOrigin = () => process.env.LAB_ORIGIN ?? 'http://127.0.0.1:4310';
export function isLabPolicy(t: TargetPolicy) {
  return (
    process.env.ENABLE_LAB === 'true' &&
    t.lab === true &&
    t.origin === labOrigin() &&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(t.origin) &&
    /^\/site\/[a-zA-Z0-9-]+$/.test(t.pathPrefix)
  );
}
export function validateUrl(input: string, asset = false, policy?: TargetPolicy) {
  const u = new URL(input);
  if (u.username || u.password || u.hash)
    throw new AppError(400, 'UNSAFE_TARGET', 'URL credentials and fragments are not permitted.');
  if (policy) {
    if (policy.enabled === false || u.origin !== policy.origin)
      throw new AppError(
        400,
        'UNAPPROVED_TARGET',
        'Destination is outside the permitted target origin.',
      );
    const local = isLabPolicy(policy);
    if (!local && (u.protocol !== 'https:' || u.port || ipaddr.isValid(u.hostname)))
      throw new AppError(
        400,
        'UNSAFE_TARGET',
        'Only approved public HTTPS hostnames are permitted.',
      );
    if (
      !asset &&
      policy.pathPrefix !== '/' &&
      u.pathname !== policy.pathPrefix &&
      !u.pathname.startsWith(policy.pathPrefix.replace(/\/$/, '') + '/')
    )
      throw new AppError(400, 'OUT_OF_SCOPE', 'URL is outside the permitted path scope.');
    return u;
  }
  if (
    u.protocol !== 'https:' ||
    u.hostname !== APPROVED_HOST ||
    u.port ||
    u.search ||
    (!asset &&
      !/^\/WAI\/demos\/bad\/(before|after)\/(home|news|tickets|survey|template)\.html$/.test(
        u.pathname,
      ))
  )
    throw new AppError(
      400,
      'UNAPPROVED_TARGET',
      'Select an approved W3C page or register a permitted target.',
    );
  return u;
}
export function isPublicIp(address: string) {
  try {
    let a = ipaddr.parse(address);
    if (a.kind() === 'ipv6' && (a as ipaddr.IPv6).isIPv4MappedAddress())
      a = (a as ipaddr.IPv6).toIPv4Address();
    return a.range() === 'unicast';
  } catch {
    return false;
  }
}
export async function resolvePublicHost(host = APPROVED_HOST) {
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicIp(a.address)))
    throw new AppError(
      400,
      'PRIVATE_ADDRESS',
      'Destination resolves to a private or reserved address.',
    );
  return addresses;
}
export async function validatePolicy(input: TargetPolicy) {
  const u = new URL(input.origin);
  if (u.origin !== input.origin || u.pathname !== '/' || u.search || u.hash)
    throw new AppError(
      400,
      'INVALID_ORIGIN',
      'Target origin must contain only scheme and hostname.',
    );
  validateUrl(u.origin + input.pathPrefix, false, input);
  if (!isLabPolicy(input)) await resolvePublicHost(u.hostname);
  return input;
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get('origin'),
    allowed = process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000';
  const site = request.headers.get('sec-fetch-site');
  if (
    site === 'cross-site' ||
    (origin && origin !== allowed) ||
    (!origin && request.headers.get('cookie'))
  )
    throw new AppError(403, 'CSRF', 'Cross-origin mutation rejected.');
}
